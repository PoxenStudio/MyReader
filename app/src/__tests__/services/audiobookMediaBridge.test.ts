import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/image', () => ({
  fetchImageAsBase64: vi.fn().mockResolvedValue('data:image/png;base64,x'),
}));

import { AudiobookMediaBridge } from '@/services/audiobook/audiobookMediaBridge';
import type { AudiobookSessionManager } from '@/services/audiobook/audiobookSessionManager';

interface FakeWebMediaSession {
  metadata: unknown;
  playbackState: string;
  handlers: Map<string, (details: MediaSessionActionDetails) => void>;
  setActionHandler: ReturnType<typeof vi.fn>;
  setPositionState: ReturnType<typeof vi.fn>;
}

const makeFakeMediaSession = (): FakeWebMediaSession => {
  const handlers = new Map<string, (details: MediaSessionActionDetails) => void>();
  return {
    metadata: null,
    playbackState: 'none',
    handlers,
    setActionHandler: vi.fn(
      (action: string, cb: ((d: MediaSessionActionDetails) => void) | null) => {
        if (cb) handlers.set(action, cb);
        else handlers.delete(action);
      },
    ),
    setPositionState: vi.fn(),
  };
};

class FakeMediaMetadata {
  title: string;
  artist: string;
  album: string;
  artwork: unknown;
  constructor(init: { title: string; artist: string; album: string; artwork: unknown }) {
    this.title = init.title;
    this.artist = init.artist;
    this.album = init.album;
    this.artwork = init.artwork;
  }
}
vi.stubGlobal('MediaMetadata', FakeMediaMetadata);

// A minimal stand-in for AudiobookSessionManager: EventTarget + the surface
// the bridge consumes (getActiveSession/getPlaybackInfo/play/pause/next/
// previous/seekTo).
class FakeManager
  extends EventTarget
  implements
    Pick<
      AudiobookSessionManager,
      'getActiveSession' | 'getPlaybackInfo' | 'play' | 'pause' | 'next' | 'previous' | 'seekTo'
    >
{
  session: unknown = {
    bookId: 5,
    meta: { title: 'Dune', author: 'Frank Herbert', coverImageUrl: null },
    tracks: [{ filename: '0001_ch1', url: '/x', size: 1 }],
    currentTrackIndex: 0,
  };
  playbackInfo: unknown = {
    trackIndex: 0,
    position: 10,
    duration: 100,
    isPlaying: true,
    rate: 1,
    currentSubtitle: null,
  };
  play = vi.fn();
  pause = vi.fn();
  next = vi.fn();
  previous = vi.fn();
  seekTo = vi.fn();

  getActiveSession = () => this.session as ReturnType<AudiobookSessionManager['getActiveSession']>;
  getPlaybackInfo = () =>
    this.playbackInfo as ReturnType<AudiobookSessionManager['getPlaybackInfo']>;

  emitSessionChanged() {
    this.dispatchEvent(new CustomEvent('session-changed', { detail: { active: true } }));
  }
  emitPlaybackState(state: 'playing' | 'paused') {
    this.dispatchEvent(new CustomEvent('audiobook-playback-state', { detail: { state } }));
  }
}

describe('AudiobookMediaBridge', () => {
  let manager: FakeManager;
  let fake: FakeWebMediaSession;
  let bridge: AudiobookMediaBridge;

  beforeEach(() => {
    manager = new FakeManager();
    fake = makeFakeMediaSession();
    bridge = new AudiobookMediaBridge(() => fake as unknown as MediaSession);
  });

  afterEach(() => {
    bridge.unbind();
  });

  const bind = () => bridge.bind(manager as unknown as AudiobookSessionManager);

  test('bind registers transport handlers that drive the manager', () => {
    bind();
    expect(fake.handlers.has('play')).toBe(true);
    fake.handlers.get('play')!({} as MediaSessionActionDetails);
    expect(manager.play).toHaveBeenCalled();
    fake.handlers.get('pause')!({} as MediaSessionActionDetails);
    expect(manager.pause).toHaveBeenCalled();
    fake.handlers.get('nexttrack')!({} as MediaSessionActionDetails);
    expect(manager.next).toHaveBeenCalled();
    fake.handlers.get('previoustrack')!({} as MediaSessionActionDetails);
    expect(manager.previous).toHaveBeenCalled();
    fake.handlers.get('seekto')!({ seekTime: 42 } as MediaSessionActionDetails);
    expect(manager.seekTo).toHaveBeenCalledWith(42);
    // 'stop' maps to pause, not a hard teardown (see ttsMediaBridge parity).
    fake.handlers.get('stop')!({} as MediaSessionActionDetails);
    expect(manager.pause).toHaveBeenCalledTimes(2);
  });

  test('bind publishes metadata and position state for the active session', async () => {
    bind();
    await vi.waitFor(() => expect(fake.metadata).not.toBeNull());
    const metadata = fake.metadata as FakeMediaMetadata;
    expect(metadata.title).toBe('ch1');
    expect(metadata.artist).toBe('Frank Herbert');
    expect(metadata.album).toBe('Dune');
    expect(fake.playbackState).toBe('playing');
    expect(fake.setPositionState).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 100, position: 10 }),
    );
  });

  test('reflects playback-state changes from the manager', async () => {
    bind();
    await vi.waitFor(() => expect(fake.metadata).not.toBeNull());
    manager.playbackInfo = { ...(manager.playbackInfo as object), isPlaying: false };
    manager.emitPlaybackState('paused');
    await vi.waitFor(() => expect(fake.playbackState).toBe('paused'));
  });

  test('unbind clears handlers and metadata', async () => {
    bind();
    await vi.waitFor(() => expect(fake.metadata).not.toBeNull());
    bridge.unbind();
    expect(fake.setActionHandler).toHaveBeenCalledWith('play', null);
    expect(fake.metadata).toBeNull();
    expect(fake.playbackState).toBe('none');
    expect(bridge.isBound).toBe(false);
  });

  test('unbinds itself when the session ends', async () => {
    bind();
    await vi.waitFor(() => expect(fake.metadata).not.toBeNull());
    manager.session = null;
    manager.emitSessionChanged();
    await vi.waitFor(() => expect(bridge.isBound).toBe(false));
  });
});
