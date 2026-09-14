import { useEffect, useState } from 'react';
import {
  audiobookSessionManager,
  type AudiobookPlaybackInfo,
  type AudiobookSession,
} from '@/services/audiobook/audiobookSessionManager';

export interface UseAudiobookSessionResult {
  session: AudiobookSession | null;
  isPlaying: boolean;
  playbackInfo: AudiobookPlaybackInfo | null;
}

// Bridges the plain-EventTarget AudiobookSessionManager singleton into React
// state for the player sheet / mini bar. Polls getPlaybackInfo() at 1s
// cadence while a session is active (the manager has no per-tick event of
// its own — <audio>'s native 'timeupdate' fires faster than the UI needs).
export function useAudiobookSession(): UseAudiobookSessionResult {
  const [session, setSession] = useState<AudiobookSession | null>(() =>
    audiobookSessionManager.getActiveSession(),
  );
  const [isPlaying, setIsPlaying] = useState(
    () => audiobookSessionManager.getPlaybackInfo()?.isPlaying ?? false,
  );
  const [playbackInfo, setPlaybackInfo] = useState<AudiobookPlaybackInfo | null>(() =>
    audiobookSessionManager.getPlaybackInfo(),
  );

  useEffect(() => {
    const onSessionChanged = () => {
      setSession(audiobookSessionManager.getActiveSession());
      setPlaybackInfo(audiobookSessionManager.getPlaybackInfo());
    };
    const onPlaybackState = (e: Event) => {
      const { state } = (e as CustomEvent<{ state: string }>).detail;
      setIsPlaying(state === 'playing');
    };
    audiobookSessionManager.addEventListener('session-changed', onSessionChanged);
    audiobookSessionManager.addEventListener('audiobook-playback-state', onPlaybackState);
    return () => {
      audiobookSessionManager.removeEventListener('session-changed', onSessionChanged);
      audiobookSessionManager.removeEventListener('audiobook-playback-state', onPlaybackState);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const tick = () => setPlaybackInfo(audiobookSessionManager.getPlaybackInfo());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session]);

  return { session, isPlaying, playbackInfo };
}
