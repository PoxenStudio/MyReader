import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stopActiveMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/tts', () => ({
  ttsSessionManager: { stopActive: (...a: unknown[]) => stopActiveMock(...a) },
}));

// Avoids pulling in the real store's transitive chain (utils/access ->
// utils/supabase, which decodes an env-configured base64 URL that isn't set
// up for this unit test's runner environment).
vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksStatusStore: { getState: () => ({ currentUserId: null }) },
}));

import {
  AudiobookSessionManager,
  type AudioElementLike,
} from '@/services/audiobook/audiobookSessionManager';
import type { AudioTrack, AudioBookDetail } from '@/services/audiobook/audiobookService';

// A minimal fake standing in for HTMLAudioElement: tracks src/currentTime/
// duration/playbackRate/paused and lets the test fire the events the manager
// listens for ('loadedmetadata', 'timeupdate', 'ended', 'play', 'pause').
class FakeAudioElement extends EventTarget implements AudioElementLike {
  src = '';
  currentTime = 0;
  duration = 0;
  playbackRate = 1;
  paused = true;

  play = vi.fn(() => {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  load = vi.fn(() => {
    // Simulate the browser resolving metadata asynchronously.
    queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
  });
}

const track = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  filename: 'ch1',
  url: 'https://mybooks.local/api/audio/5/ch1.mp3',
  size: 1000,
  ...overrides,
});

const detail = (audios: AudioTrack[]): AudioBookDetail => ({
  audios,
  total_files: audios.length,
  is_paid: true,
});

describe('AudiobookSessionManager', () => {
  let audio: FakeAudioElement;
  let manager: AudiobookSessionManager;
  let fetchAudioDetail: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    stopActiveMock.mockClear();
    audio = new FakeAudioElement();
    fetchAudioDetail = vi.fn();
    manager = new AudiobookSessionManager({
      createAudioElement: () => audio,
      fetchAudioDetail,
    });
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  it('opens a book, loads the first track, and starts a session', async () => {
    fetchAudioDetail.mockResolvedValue(detail([track()]));

    await manager.openBook(5, { title: 'Dune' });

    const session = manager.getActiveSession();
    expect(session?.bookId).toBe(5);
    expect(session?.currentTrackIndex).toBe(0);
    expect(audio.src).toBe(track().url);
  });

  it('restores a saved trackIndex/currentTime from localStorage', async () => {
    localStorage.setItem(
      'audiobook_progress_guest_5',
      JSON.stringify({ trackIndex: 1, currentTime: 42, timestamp: Date.now() }),
    );
    fetchAudioDetail.mockResolvedValue(
      detail([
        track({ filename: 'ch1' }),
        track({ filename: 'ch2', url: 'https://mybooks.local/api/audio/5/ch2.mp3' }),
      ]),
    );

    await manager.openBook(5, { title: 'Dune' });

    expect(manager.getActiveSession()?.currentTrackIndex).toBe(1);
    expect(audio.currentTime).toBe(42);
  });

  it('play() asks ttsSessionManager to stop any active TTS session first', async () => {
    fetchAudioDetail.mockResolvedValue(detail([track()]));
    await manager.openBook(5, { title: 'Dune' });

    manager.play();
    // Mutual exclusion is fire-and-forget (a dynamic import()); flush the
    // macrotask queue so its .then() has had a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stopActiveMock).toHaveBeenCalledWith('audiobook');
    expect(audio.play).toHaveBeenCalled();
  });

  it('emits audiobook-playback-state on play/pause', async () => {
    fetchAudioDetail.mockResolvedValue(detail([track()]));
    await manager.openBook(5, { title: 'Dune' });

    const states: string[] = [];
    manager.addEventListener('audiobook-playback-state', (e) => {
      states.push((e as CustomEvent<{ state: string }>).detail.state);
    });

    manager.play();
    await Promise.resolve();
    manager.pause();

    expect(states).toEqual(['playing', 'paused']);
  });

  it('m4b virtual tracks sharing the same url only seek, without reloading src', async () => {
    const shared = 'https://mybooks.local/api/audio/5/book.m4b';
    fetchAudioDetail.mockResolvedValue(
      detail([
        track({ filename: 'Chapter 1', url: shared, start_time: 0, end_time: 100 }),
        track({ filename: 'Chapter 2', url: shared, start_time: 100, end_time: 200 }),
      ]),
    );
    await manager.openBook(5, { title: 'Dune' });
    audio.load.mockClear();

    manager.selectTrack(1);

    expect(audio.load).not.toHaveBeenCalled();
    expect(audio.currentTime).toBe(100);
    expect(manager.getPlaybackInfo()?.duration).toBe(100);
  });

  it('seekTo() offsets by the track start_time and clamps to the track window', async () => {
    fetchAudioDetail.mockResolvedValue(detail([track({ start_time: 50, end_time: 80 })]));
    await manager.openBook(5, { title: 'Dune' });

    manager.seekTo(10);
    expect(audio.currentTime).toBe(60);

    manager.seekTo(-5);
    expect(audio.currentTime).toBe(50);

    manager.seekTo(1000);
    expect(audio.currentTime).toBe(80);
  });

  it('auto-advances to the next track when a virtual track reaches its end_time', async () => {
    const shared = 'https://mybooks.local/api/audio/5/book.m4b';
    fetchAudioDetail.mockResolvedValue(
      detail([
        track({ filename: 'Chapter 1', url: shared, start_time: 0, end_time: 10 }),
        track({ filename: 'Chapter 2', url: shared, start_time: 10, end_time: 20 }),
      ]),
    );
    await manager.openBook(5, { title: 'Dune' });
    manager.play();
    await Promise.resolve();

    audio.currentTime = 10;
    audio.dispatchEvent(new Event('timeupdate'));

    expect(manager.getActiveSession()?.currentTrackIndex).toBe(1);
    expect(audio.currentTime).toBe(10);
  });

  it('stop() clears the active session and pauses playback', async () => {
    fetchAudioDetail.mockResolvedValue(detail([track()]));
    await manager.openBook(5, { title: 'Dune' });
    manager.play();
    await Promise.resolve();

    manager.stop();

    expect(manager.getActiveSession()).toBeNull();
    expect(audio.pause).toHaveBeenCalled();
  });

  it('saves playback position to localStorage on pause', async () => {
    fetchAudioDetail.mockResolvedValue(detail([track()]));
    await manager.openBook(5, { title: 'Dune' });
    manager.play();
    await Promise.resolve();
    audio.currentTime = 12;

    manager.pause();

    const saved = JSON.parse(localStorage.getItem('audiobook_progress_guest_5')!);
    expect(saved).toMatchObject({ trackIndex: 0, currentTime: 12 });
  });

  it('prefers a locally resolved source over the remote track url when available', async () => {
    fetchAudioDetail.mockResolvedValue(detail([track()]));
    const localManager = new AudiobookSessionManager({
      createAudioElement: () => audio,
      fetchAudioDetail,
      resolvePlaybackUrl: async () => 'blob://local/ch1.mp3',
    });

    await localManager.openBook(5, { title: 'Dune' });

    expect(audio.src).toBe('blob://local/ch1.mp3');
    localManager.stop();
  });
});
