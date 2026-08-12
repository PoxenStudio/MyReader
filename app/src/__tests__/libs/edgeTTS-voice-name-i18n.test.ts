import { describe, test, expect, vi } from 'vitest';

// Stub the Supabase client so importing edgeTTS.ts (transitively via
// @/utils/fetch -> @/utils/access) does not instantiate a real GoTrueClient.
vi.mock('@/utils/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  createSupabaseClient: () => ({}),
  createSupabaseAdminClient: () => ({}),
}));

import { EdgeSpeechTTS, EDGE_TTS_VOICE_NAME_KEYS } from '@/libs/edgeTTS';

// Voice persona names (e.g. "Xiaoxiao", "Yunxi") are shown to users via
// `_(voice.name)` in TTSPlayerSheet, but they're computed at runtime from
// EDGE_TTS_VOICES ids so the i18next scanner can't discover them by walking
// genVoiceList(). EDGE_TTS_VOICE_NAME_KEYS registers every literal name so
// `pnpm i18n:extract` emits a translatable key for each one. This test
// guards against a voice/locale being added without its name being
// registered for translation.
describe('EDGE_TTS_VOICE_NAME_KEYS', () => {
  test('covers every distinct voice persona name', () => {
    const namesInUse = new Set(EdgeSpeechTTS.voices.map((voice) => voice.name));
    const registeredNames = new Set(EDGE_TTS_VOICE_NAME_KEYS);

    const missing = [...namesInUse].filter((name) => !registeredNames.has(name));
    expect(missing).toEqual([]);
  });
});
