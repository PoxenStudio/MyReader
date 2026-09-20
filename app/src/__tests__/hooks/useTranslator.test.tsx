/**
 * useTranslator falls back to an available provider — a persisted/hardcoded
 * `provider` name that no longer exists in the registry (e.g. a provider
 * that was since removed, like the retired 'azure' translator) must not
 * throw. Regression test for "No translator found for provider: azure".
 *
 * The real bug only reproduces when a *sibling* effect calls `translate()`
 * on mount (exactly like `TranslatorPopup`'s fetch-on-mount effect): React
 * flushes every passive effect for a commit — including `useTranslator`'s
 * own provider-correction effect — before processing the state update that
 * correction schedules. So the sibling effect still runs with the translate
 * closure captured during the *first* render, whose `selectedProvider` is
 * still the stale, no-longer-registered name. A test that calls
 * `result.current.translate(...)` by hand *after* `renderHook` settles does
 * not hit this: RTL's `act()` has already flushed the correction by then.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

const h = vi.hoisted(() => ({
  edgeTranslate: vi.fn(async (texts: string[]) => texts.map((t) => `edge:${t}`)),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: null }),
}));

const mockTranslatorList = [
  { name: 'edge', label: 'Edge Translator', translate: h.edgeTranslate },
  { name: 'disabled-provider', label: 'Disabled Provider', disabled: true, translate: vi.fn() },
];

vi.mock('@/services/translators', () => ({
  getTranslators: () => mockTranslatorList,
  getTranslator: (name: string) => mockTranslatorList.find((t) => t.name === name),
  isTranslatorAvailable: (t: { disabled?: boolean; authRequired?: boolean }, hasToken: boolean) => {
    if (t.disabled) return false;
    if (t.authRequired && !hasToken) return false;
    return true;
  },
  getFromCache: vi.fn(async () => null),
  storeInCache: vi.fn(async () => undefined),
  preprocess: (texts: string[]) => texts,
  polish: (texts: string[]) => texts,
}));

import { useTranslator } from '@/hooks/useTranslator';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Mirrors TranslatorPopup: calls `translate` from its own effect on mount. */
function Harness({
  provider,
  onSettled,
}: {
  provider: string;
  onSettled: (result: string[] | Error) => void;
}) {
  const { translate } = useTranslator({
    provider: provider as never,
    sourceLang: 'AUTO',
    targetLang: 'fr',
  });

  useEffect(() => {
    translate(['Hello']).then(onSettled).catch(onSettled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translate]);

  return null;
}

describe('useTranslator provider resolution', () => {
  test('does not throw when `provider` names a translator that no longer exists', async () => {
    const onSettled = vi.fn();
    render(<Harness provider='azure' onSettled={onSettled} />);

    await waitFor(() => expect(onSettled).toHaveBeenCalled());

    const result = onSettled.mock.calls[0]![0];
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual(['edge:Hello']);
  });

  test('uses the requested provider directly when it is available', async () => {
    const onSettled = vi.fn();
    render(<Harness provider='edge' onSettled={onSettled} />);

    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(onSettled).toHaveBeenCalledWith(['edge:Hello']);
  });
});
