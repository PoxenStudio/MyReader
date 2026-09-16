// System media-session (lock screen / Now Playing) integration for
// audiobook playback. Simplified sibling of ttsMediaBridge.ts — no
// sentence-level marks, no CarPlay, no skip-hold: an audiobook chapter is a
// single continuous media item with a real duration, so the browser/native
// session's own position state does the work TTS needed a bridge to fake.
//
// §6.1 (design doc) resolution: iOS never drives the native plugin for
// audiobooks — only navigator.mediaSession. On iOS Tauri, `getMediaSession()`
// returns IOSCompositeMediaSession, which mirrors every call into BOTH the
// native session (TTS's slot) and navigator.mediaSession; using it here would
// let audiobook and TTS fight over the same native client. Since mutual
// exclusion (§5.7) already guarantees only one of them is ever "playing",
// this bridge resolves its own, iOS-only-web session instead of importing
// getMediaSession()'s TTS-oriented resolution as-is.

import { TauriMediaSession } from '@/libs/mediaSession';
import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';
import { fetchImageAsBase64 } from '@/utils/image';
import type { AudiobookSessionManager } from './audiobookSessionManager';

type BridgeMediaSession = TauriMediaSession | MediaSession;

function resolveAudiobookMediaSession(): BridgeMediaSession | null {
  if (getOSPlatform() === 'ios' && isTauriAppPlatform()) {
    return 'mediaSession' in navigator ? navigator.mediaSession : null;
  }
  if (getOSPlatform() === 'android' && isTauriAppPlatform()) {
    return new TauriMediaSession();
  }
  return 'mediaSession' in navigator ? navigator.mediaSession : null;
}

const ACTIONS = ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekto'] as const;

export class AudiobookMediaBridge {
  #resolveMediaSession: () => BridgeMediaSession | null;
  #mediaSession: BridgeMediaSession | null = null;
  #manager: AudiobookSessionManager | null = null;
  #coverArtwork = '/icon.png';
  #lastTrackIndex: number | null = null;
  #positionTimer: ReturnType<typeof setInterval> | null = null;

  #onSessionChanged = () => void this.#refresh();
  #onPlaybackState = () => void this.#updatePlaybackState();

  constructor(resolveMediaSession: () => BridgeMediaSession | null = resolveAudiobookMediaSession) {
    this.#resolveMediaSession = resolveMediaSession;
  }

  get isBound(): boolean {
    return this.#manager !== null;
  }

  bind(manager: AudiobookSessionManager): void {
    if (this.#manager === manager) return;
    this.unbind();
    this.#manager = manager;
    this.#mediaSession = this.#resolveMediaSession();
    if (!this.#mediaSession) return;

    this.#registerActionHandlers();
    manager.addEventListener('session-changed', this.#onSessionChanged);
    manager.addEventListener('audiobook-playback-state', this.#onPlaybackState);
    this.#positionTimer = setInterval(() => void this.#updatePositionState(), 1000);
    void this.#refresh();
  }

  unbind(): void {
    const manager = this.#manager;
    if (manager) {
      manager.removeEventListener('session-changed', this.#onSessionChanged);
      manager.removeEventListener('audiobook-playback-state', this.#onPlaybackState);
    }
    if (this.#positionTimer !== null) {
      clearInterval(this.#positionTimer);
      this.#positionTimer = null;
    }
    const mediaSession = this.#mediaSession;
    if (mediaSession) {
      for (const action of ACTIONS) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // Unsupported on this engine.
        }
      }
      if (mediaSession instanceof TauriMediaSession) {
        void mediaSession.setActive({ active: false });
      } else {
        try {
          mediaSession.metadata = null;
          mediaSession.playbackState = 'none';
        } catch {
          // Best-effort teardown.
        }
      }
    }
    this.#manager = null;
    this.#mediaSession = null;
    this.#lastTrackIndex = null;
  }

  #registerActionHandlers(): void {
    const mediaSession = this.#mediaSession;
    const manager = () => this.#manager;
    if (!mediaSession) return;

    mediaSession.setActionHandler('play', () => manager()?.play());
    mediaSession.setActionHandler('pause', () => manager()?.pause());
    // Long-standing convention (see ttsMediaBridge): 'stop' maps to pause —
    // a hard stop lives in the in-app surfaces (sheet/mini bar), not the
    // lock screen, so an accidental tap there doesn't drop the session.
    mediaSession.setActionHandler('stop', () => manager()?.pause());
    mediaSession.setActionHandler('nexttrack', () => manager()?.next());
    mediaSession.setActionHandler('previoustrack', () => manager()?.previous());
    if (mediaSession instanceof TauriMediaSession) {
      mediaSession.setActionHandler('seekto', ((positionMs: number) => {
        manager()?.seekTo(positionMs / 1000);
      }) as (position: number) => void);
    } else {
      try {
        mediaSession.setActionHandler('seekto', (details: MediaSessionActionDetails) => {
          if (typeof details.seekTime === 'number') manager()?.seekTo(details.seekTime);
        });
      } catch {
        // 'seekto' unsupported on this engine.
      }
    }
  }

  async #refresh(): Promise<void> {
    const manager = this.#manager;
    if (!manager) return;
    const session = manager.getActiveSession();
    if (!session) {
      this.unbind();
      return;
    }
    if (session.currentTrackIndex !== this.#lastTrackIndex) {
      this.#lastTrackIndex = session.currentTrackIndex;
      await this.#updateMetadata();
    }
    await this.#updatePlaybackState();
    await this.#updatePositionState();
  }

  async #updateMetadata(): Promise<void> {
    const mediaSession = this.#mediaSession;
    const manager = this.#manager;
    const session = manager?.getActiveSession();
    if (!mediaSession || !session) return;

    try {
      this.#coverArtwork = await fetchImageAsBase64(session.meta.coverImageUrl || '/icon.png');
    } catch {
      this.#coverArtwork = '/icon.png';
    }
    const track = session.tracks[session.currentTrackIndex];
    const chapterLabel = track ? track.filename.replace(/^\d{4}_/, '') : '';

    if (mediaSession instanceof TauriMediaSession) {
      await mediaSession.setActive({
        active: true,
        bookHash: String(session.bookId),
        bookTitle: session.meta.title,
        bookAuthor: session.meta.author ?? '',
      });
      await mediaSession.updateMetadata({
        title: chapterLabel || session.meta.title,
        artist: session.meta.author ?? '',
        album: session.meta.title,
        artwork: this.#coverArtwork,
      });
    } else {
      try {
        mediaSession.metadata = new MediaMetadata({
          title: chapterLabel || session.meta.title,
          artist: session.meta.author ?? '',
          album: session.meta.title,
          artwork: this.#coverArtwork ? [{ src: this.#coverArtwork }] : [],
        });
      } catch {
        // Best-effort; a malformed artwork data URL must not break playback.
      }
    }
  }

  async #updatePlaybackState(): Promise<void> {
    const mediaSession = this.#mediaSession;
    const manager = this.#manager;
    if (!mediaSession || !manager || !manager.getActiveSession()) return;
    const info = manager.getPlaybackInfo();
    if (mediaSession instanceof TauriMediaSession) {
      await mediaSession.updatePlaybackState({ playing: info?.isPlaying ?? false });
    } else {
      mediaSession.playbackState = info?.isPlaying ? 'playing' : 'paused';
    }
  }

  async #updatePositionState(): Promise<void> {
    const mediaSession = this.#mediaSession;
    const manager = this.#manager;
    if (!mediaSession || !manager || !manager.getActiveSession()) return;
    const info = manager.getPlaybackInfo();
    if (!info || !Number.isFinite(info.duration) || info.duration <= 0) return;
    const position = Math.min(Math.max(info.position, 0), info.duration);
    if (mediaSession instanceof TauriMediaSession) {
      await mediaSession.updatePlaybackState({
        playing: info.isPlaying,
        position: Math.round(position * 1000),
        duration: Math.round(info.duration * 1000),
      });
    } else if ('setPositionState' in mediaSession) {
      try {
        mediaSession.setPositionState({
          duration: info.duration,
          position,
          playbackRate: info.isPlaying ? info.rate : 0,
        });
      } catch {
        // Transiently inconsistent states reject on some engines.
      }
    }
  }
}

export const audiobookMediaBridge = new AudiobookMediaBridge();
