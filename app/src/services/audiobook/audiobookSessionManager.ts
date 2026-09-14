// Single-slot, global singleton audiobook playback session.
//
// Mirrors TTSSessionManager's shape (a per-webview singleton EventTarget
// that outlives whatever React UI is mounted) but drives one shared
// HTMLAudioElement instead of the TTS synthesis pipeline: audiobook tracks
// are plain remote (or, once step 4/5 wire up local downloads, local) media
// files, so there is no need for TTS's chunked WebAudio/native player.
//
// m4b files with embedded chapters arrive from the backend as several
// virtual tracks sharing one physical `url`, distinguished by `start_time`/
// `end_time` (see webserver/handlers/audio.py's _extract_m4b_chapters).
// loadTrack() only reloads `src` when the physical file actually changes;
// switching between virtual tracks of the same file is a plain seek.
//
// See document/MyReader_Audiobook_Feature_Design.md §5.3/§5.7/§5.8.

import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import {
  getAudioBookDetail,
  resolveAudioTrackUrl,
  type AudioBookDetail,
  type AudioTrack,
} from './audiobookService';
import { findActiveCueIndex, parseSubtitle, type SubtitleCue } from './audioSubtitle';

export interface AudiobookSessionMeta {
  title: string;
  author?: string;
  coverImageUrl?: string | null;
}

export interface AudiobookSession {
  bookId: number;
  meta: AudiobookSessionMeta;
  tracks: AudioTrack[];
  currentTrackIndex: number;
}

export interface AudiobookPlaybackInfo {
  trackIndex: number;
  position: number; // seconds, relative to the current track's own start
  duration: number; // seconds
  isPlaying: boolean;
  rate: number;
  currentSubtitle: string | null;
}

// The subset of HTMLAudioElement the manager depends on — narrow enough that
// tests can supply a plain EventTarget-based fake instead of a real element
// (jsdom's <audio> doesn't actually decode/play media).
export interface AudioElementLike extends EventTarget {
  src: string;
  currentTime: number;
  duration: number;
  playbackRate: number;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  load(): void;
}

interface SavedProgress {
  trackIndex: number;
  currentTime: number;
  timestamp: number;
}

export interface AudiobookSessionManagerDeps {
  createAudioElement?: () => AudioElementLike;
  fetchAudioDetail?: (bookId: number) => Promise<AudioBookDetail>;
  // Local-first playback source resolution hook (wired up to the on-device
  // download cache in a later step — see §5.11). Falls back to the track's
  // remote `url` when it resolves to null/undefined, or isn't provided.
  resolvePlaybackUrl?: (
    bookId: number,
    track: AudioTrack,
  ) => Promise<string | null> | string | null;
  now?: () => number;
  // Injectable so tests don't depend on a real network fetch; defaults to a
  // credentialed fetch of the (already host-resolved) subtitle URL.
  fetchSubtitle?: (url: string) => Promise<string>;
}

const PROGRESS_SAVE_INTERVAL_MS = 5000;

const trackDuration = (track: AudioTrack, fallback: number): number =>
  track.start_time !== undefined && track.end_time !== undefined
    ? track.end_time - track.start_time
    : fallback;

export class AudiobookSessionManager extends EventTarget {
  #createAudioElement: () => AudioElementLike;
  #fetchAudioDetail: (bookId: number) => Promise<AudioBookDetail>;
  #resolvePlaybackUrl?: AudiobookSessionManagerDeps['resolvePlaybackUrl'];
  #fetchSubtitle: (url: string) => Promise<string>;
  #now: () => number;

  #audio: AudioElementLike | null = null;
  #session: AudiobookSession | null = null;
  #loadedUrl: string | null = null;
  #rate = 1;
  #saveTimer: ReturnType<typeof setInterval> | null = null;
  #openGeneration = 0;
  #subtitleCache = new Map<string, SubtitleCue[]>();
  #subtitleCues: SubtitleCue[] = [];
  #subtitleUrl: string | null = null;
  #subtitleGeneration = 0;

  #onTimeUpdate = () => this.#handleTimeUpdate();
  #onEnded = () => this.#handleTrackEnded();
  #onPlay = () => this.#emitPlaybackState('playing');
  #onPause = () => {
    this.#emitPlaybackState('paused');
    this.#savePosition();
  };

  constructor(deps: AudiobookSessionManagerDeps = {}) {
    super();
    this.#createAudioElement =
      deps.createAudioElement ?? (() => new Audio() as unknown as AudioElementLike);
    this.#fetchAudioDetail = deps.fetchAudioDetail ?? getAudioBookDetail;
    this.#resolvePlaybackUrl = deps.resolvePlaybackUrl;
    this.#fetchSubtitle =
      deps.fetchSubtitle ??
      (async (url) => {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`Failed to fetch subtitle: ${res.status}`);
        return res.text();
      });
    this.#now = deps.now ?? Date.now;
  }

  getActiveSession(): AudiobookSession | null {
    return this.#session;
  }

  getPlaybackInfo(): AudiobookPlaybackInfo | null {
    const session = this.#session;
    const audio = this.#audio;
    if (!session || !audio) return null;
    const track = session.tracks[session.currentTrackIndex];
    if (!track) return null;
    const position = Math.max(0, audio.currentTime - (track.start_time ?? 0));
    const cueIndex = findActiveCueIndex(this.#subtitleCues, audio.currentTime);
    return {
      trackIndex: session.currentTrackIndex,
      position,
      duration: trackDuration(track, audio.duration || 0),
      isPlaying: !audio.paused,
      rate: this.#rate,
      currentSubtitle: cueIndex >= 0 ? this.#subtitleCues[cueIndex]!.text : null,
    };
  }

  async openBook(bookId: number, meta: AudiobookSessionMeta): Promise<void> {
    this.stop();
    const generation = ++this.#openGeneration;

    const detail = await this.#fetchAudioDetail(bookId);
    if (generation !== this.#openGeneration) return; // superseded by a later openBook/stop
    if (!detail.audios.length) {
      throw new Error(`No audio tracks found for book ${bookId}`);
    }

    const audio = this.#createAudioElement();
    audio.addEventListener('timeupdate', this.#onTimeUpdate);
    audio.addEventListener('ended', this.#onEnded);
    audio.addEventListener('play', this.#onPlay);
    audio.addEventListener('pause', this.#onPause);
    this.#audio = audio;
    this.#loadedUrl = null;

    this.#session = { bookId, meta, tracks: detail.audios, currentTrackIndex: 0 };

    const saved = this.#readSavedProgress(bookId);
    const startIndex =
      saved && saved.trackIndex >= 0 && saved.trackIndex < detail.audios.length
        ? saved.trackIndex
        : 0;
    await this.#loadTrack(startIndex, saved?.trackIndex === startIndex ? saved.currentTime : 0);

    this.#emitSessionChanged();
  }

  play(): void {
    if (!this.#audio) return;
    // Only one system media-session slot exists; audiobook and TTS playback
    // are mutually exclusive (design doc §5.7/§6.1). Best-effort and
    // fire-and-forget — a failure to stop TTS must not block playback.
    void import('@/services/tts')
      .then(({ ttsSessionManager }) => ttsSessionManager.stopActive('audiobook'))
      .catch(() => {});
    void this.#audio.play();
    this.#startSaveTimer();
  }

  pause(): void {
    this.#audio?.pause();
    this.#stopSaveTimer();
  }

  togglePlay(): void {
    if (!this.#audio) return;
    if (this.#audio.paused) this.play();
    else this.pause();
  }

  selectTrack(index: number): void {
    const session = this.#session;
    if (!session) return;
    if (index === session.currentTrackIndex) {
      this.togglePlay();
      return;
    }
    const wasPlaying = !!this.#audio && !this.#audio.paused;
    this.#savePosition();
    void this.#loadTrack(index, 0).then(() => {
      if (wasPlaying) this.play();
    });
  }

  next(forcePlay = false): void {
    const session = this.#session;
    if (!session || session.currentTrackIndex >= session.tracks.length - 1) return;
    const wasPlaying = forcePlay || (!!this.#audio && !this.#audio.paused);
    this.#savePosition();
    void this.#loadTrack(session.currentTrackIndex + 1, 0).then(() => {
      if (wasPlaying) this.play();
    });
  }

  previous(): void {
    const session = this.#session;
    if (!session || session.currentTrackIndex <= 0) return;
    const wasPlaying = !!this.#audio && !this.#audio.paused;
    this.#savePosition();
    void this.#loadTrack(session.currentTrackIndex - 1, 0).then(() => {
      if (wasPlaying) this.play();
    });
  }

  seekTo(seconds: number): void {
    const session = this.#session;
    const audio = this.#audio;
    if (!session || !audio) return;
    const track = session.tracks[session.currentTrackIndex];
    if (!track) return;
    const start = track.start_time ?? 0;
    const end = track.end_time ?? start + (audio.duration || Infinity);
    audio.currentTime = Math.min(Math.max(seconds + start, start), end);
  }

  setRate(rate: number): void {
    this.#rate = rate;
    if (this.#audio) this.#audio.playbackRate = rate;
  }

  stop(): void {
    this.#openGeneration++; // invalidate any in-flight openBook
    this.#stopSaveTimer();
    this.#savePosition();
    const audio = this.#audio;
    if (audio) {
      audio.pause();
      audio.removeEventListener('timeupdate', this.#onTimeUpdate);
      audio.removeEventListener('ended', this.#onEnded);
      audio.removeEventListener('play', this.#onPlay);
      audio.removeEventListener('pause', this.#onPause);
    }
    this.#audio = null;
    this.#session = null;
    this.#loadedUrl = null;
    this.#subtitleCues = [];
    this.#subtitleUrl = null;
    this.#subtitleGeneration++;
    this.dispatchEvent(new CustomEvent('session-changed', { detail: { active: false } }));
  }

  // ---------------------------------------------------------------------

  async #loadTrack(index: number, initialTime: number): Promise<void> {
    const session = this.#session;
    const audio = this.#audio;
    if (!session || !audio) return;
    const track = session.tracks[index];
    if (!track) return;
    session.currentTrackIndex = index;

    const targetTime = initialTime + (track.start_time ?? 0);
    const sameFile = this.#loadedUrl === track.url;

    if (sameFile) {
      audio.currentTime = targetTime;
    } else {
      const resolved = await this.#resolvePlaybackUrl?.(session.bookId, track);
      const src = resolved || resolveAudioTrackUrl(track.url);
      audio.src = src;
      this.#loadedUrl = track.url;
      audio.playbackRate = this.#rate;
      await new Promise<void>((resolve) => {
        const onReady = () => {
          audio.removeEventListener('loadedmetadata', onReady);
          audio.currentTime = targetTime;
          resolve();
        };
        audio.addEventListener('loadedmetadata', onReady);
        audio.load();
      });
    }
    void this.#loadSubtitle(track.subtitle);
    this.dispatchEvent(new CustomEvent('session-changed', { detail: { active: true } }));
  }

  // Subtitle cues are keyed by the raw (unresolved) subtitle URL so the
  // cache survives host reconfiguration between loads. A generation guard
  // discards a slow fetch that resolves after the user has already skipped
  // to a track with a different (or no) subtitle.
  async #loadSubtitle(url: string | undefined): Promise<void> {
    const generation = ++this.#subtitleGeneration;
    this.#subtitleUrl = url ?? null;
    if (!url) {
      this.#subtitleCues = [];
      return;
    }
    const cached = this.#subtitleCache.get(url);
    if (cached) {
      this.#subtitleCues = cached;
      return;
    }
    try {
      const content = await this.#fetchSubtitle(resolveAudioTrackUrl(url));
      const cues = parseSubtitle(content);
      this.#subtitleCache.set(url, cues);
      if (generation === this.#subtitleGeneration && this.#subtitleUrl === url) {
        this.#subtitleCues = cues;
      }
    } catch {
      // Subtitle is a nice-to-have; a fetch failure must not affect playback.
      if (generation === this.#subtitleGeneration && this.#subtitleUrl === url) {
        this.#subtitleCues = [];
      }
    }
  }

  #handleTimeUpdate(): void {
    const session = this.#session;
    const audio = this.#audio;
    if (!session || !audio) return;
    const track = session.tracks[session.currentTrackIndex];
    if (track?.end_time !== undefined && audio.currentTime >= track.end_time) {
      this.#handleTrackEnded();
    }
  }

  #handleTrackEnded(): void {
    const session = this.#session;
    if (!session) return;
    this.#savePosition();
    if (session.currentTrackIndex < session.tracks.length - 1) {
      this.next(true);
    } else {
      this.pause();
    }
  }

  #emitPlaybackState(state: 'playing' | 'paused'): void {
    this.dispatchEvent(new CustomEvent('audiobook-playback-state', { detail: { state } }));
  }

  #emitSessionChanged(): void {
    this.dispatchEvent(new CustomEvent('session-changed', { detail: { active: true } }));
  }

  #startSaveTimer(): void {
    this.#stopSaveTimer();
    this.#saveTimer = setInterval(() => this.#savePosition(), PROGRESS_SAVE_INTERVAL_MS);
  }

  #stopSaveTimer(): void {
    if (this.#saveTimer !== null) {
      clearInterval(this.#saveTimer);
      this.#saveTimer = null;
    }
  }

  #storageKey(bookId: number): string {
    const uid = useMyBooksStatusStore.getState().currentUserId ?? 'guest';
    return `audiobook_progress_${uid}_${bookId}`;
  }

  #savePosition(): void {
    const session = this.#session;
    const audio = this.#audio;
    if (!session || !audio || typeof window === 'undefined') return;
    const track = session.tracks[session.currentTrackIndex];
    if (!track) return;
    const currentTime = Math.max(0, audio.currentTime - (track.start_time ?? 0));
    const payload: SavedProgress = {
      trackIndex: session.currentTrackIndex,
      currentTime,
      timestamp: this.#now(),
    };
    try {
      localStorage.setItem(this.#storageKey(session.bookId), JSON.stringify(payload));
    } catch {
      // Best-effort; a full/blocked localStorage must not break playback.
    }
  }

  #readSavedProgress(bookId: number): SavedProgress | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(this.#storageKey(bookId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SavedProgress>;
      if (typeof parsed.trackIndex !== 'number' || typeof parsed.currentTime !== 'number') {
        return null;
      }
      return {
        trackIndex: parsed.trackIndex,
        currentTime: parsed.currentTime,
        timestamp: parsed.timestamp ?? 0,
      };
    } catch {
      return null;
    }
  }
}

export const audiobookSessionManager = new AudiobookSessionManager();
