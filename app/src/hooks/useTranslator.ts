import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getTranslators, isTranslatorAvailable } from '@/services/translators';
import { getFromCache, storeInCache, UseTranslatorOptions } from '@/services/translators';
import { polish, preprocess } from '@/services/translators';
import { getLocale } from '@/utils/misc';

export function useTranslator({
  provider = 'edge',
  sourceLang = 'AUTO',
  targetLang = 'EN',
  enablePolishing = true,
  enablePreprocessing = true,
}: UseTranslatorOptions = {}) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [translators] = useState(() => getTranslators());

  useEffect(() => {
    setLoading(false);
  }, [provider, sourceLang, targetLang]);

  const translate = useCallback(
    async (
      input: string[],
      options?: { source?: string; target?: string; useCache?: boolean },
    ): Promise<string[]> => {
      const sourceLanguage = options?.source || sourceLang;
      const targetLanguage = options?.target || targetLang || getLocale();
      const useCache = options?.useCache ?? false;
      const textsToTranslate = enablePreprocessing ? preprocess(input) : input;

      if (textsToTranslate.length === 0 || textsToTranslate.every((t) => !t?.trim())) {
        return textsToTranslate;
      }

      // Resolve the active translator fresh on every call instead of reading
      // it back from state a prior effect corrected asynchronously. `provider`
      // may name a translator that is unavailable or no longer registered at
      // all (e.g. a persisted setting pointing at a provider that was since
      // removed) — always fall back to the first available one rather than
      // trusting it blindly.
      const availableTranslators = translators.filter((t) => isTranslatorAvailable(t, !!token));
      const activeTranslator =
        availableTranslators.find((t) => t.name === provider) || availableTranslators[0];
      if (!activeTranslator) {
        throw new Error('No translation provider is available');
      }
      const activeProvider = activeTranslator.name;

      const textsNeedingTranslation: string[] = [];
      const indicesNeedingTranslation: number[] = [];

      await Promise.all(
        textsToTranslate.map(async (text, index) => {
          if (!text?.trim()) return;

          const cachedTranslation = await getFromCache(
            text,
            sourceLanguage,
            targetLanguage,
            activeProvider,
          );
          if (cachedTranslation) return;

          textsNeedingTranslation.push(text);
          indicesNeedingTranslation.push(index);
        }),
      );

      if (textsNeedingTranslation.length === 0) {
        const results = await Promise.all(
          textsToTranslate.map((text) =>
            getFromCache(text, sourceLanguage, targetLanguage, activeProvider).then(
              (cached) => cached || text,
            ),
          ),
        );

        return enablePolishing ? polish(results, targetLanguage) : results;
      }

      setLoading(true);

      try {
        const translatedTexts = await activeTranslator.translate(
          textsNeedingTranslation,
          sourceLanguage,
          targetLanguage,
          token,
          useCache,
        );

        await Promise.all(
          textsNeedingTranslation.map(async (text, index) => {
            return storeInCache(
              text,
              translatedTexts[index] || '',
              sourceLanguage,
              targetLanguage,
              activeProvider,
            );
          }),
        );

        const results = [...textsToTranslate];
        indicesNeedingTranslation.forEach((originalIndex, translationIndex) => {
          results[originalIndex] = translatedTexts[translationIndex] || '';
        });

        await Promise.all(
          results.map(async (_, index) => {
            if (!indicesNeedingTranslation.includes(index)) {
              const originalText = textsToTranslate[index];
              if (!originalText?.trim()) return;

              const cachedTranslation = await getFromCache(
                originalText,
                sourceLanguage,
                targetLanguage,
                activeProvider,
              );

              if (cachedTranslation) {
                results[index] = cachedTranslation;
              }
            }
          }),
        );

        setLoading(false);
        return enablePolishing ? polish(results, targetLanguage) : results;
      } catch (err) {
        setLoading(false);
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    [provider, sourceLang, targetLang, translators, token, enablePolishing, enablePreprocessing],
  );

  return {
    translate,
    translators,
    loading,
  };
}
