import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { TranslationProvider } from '../types';
import { normalizeToFullLang } from '@/utils/lang';

// The Microsoft Edge browser's built-in "translate this page" feature calls
// this free endpoint directly — no API key or bearer token required. (An
// older auth-token-based flow via edge.microsoft.com/translate/auth existed
// previously but has since been retired upstream and now 404s.)
const TRANSLATE_URL = 'https://edge.microsoft.com/translate/translatetext';

// Mirrors the browser Edge sends when calling this endpoint — the free
// service is more likely to reject an unrecognized/default User-Agent.
const EDGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

export const edgeProvider: TranslationProvider = {
  name: 'edge',
  label: _('Edge Translator'),
  translate: async (text: string[], sourceLang: string, targetLang: string): Promise<string[]> => {
    if (!text.length) return [];

    const results = [...text];
    const indices: number[] = [];
    const nonEmptyTexts: string[] = [];
    text.forEach((line, index) => {
      if (line?.trim().length) {
        indices.push(index);
        nonEmptyTexts.push(line);
      }
    });

    if (nonEmptyTexts.length === 0) return results;

    const msSourceLang = sourceLang ? normalizeToFullLang(sourceLang) : '';
    const msTargetLang = normalizeToFullLang(targetLang);

    const params = new URLSearchParams({
      to: msTargetLang,
      isEnterpriseClient: 'false',
    });
    if (msSourceLang && msSourceLang.toLowerCase() !== 'auto') {
      params.append('from', msSourceLang);
    }

    const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
    const response = await fetch(`${TRANSLATE_URL}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': EDGE_USER_AGENT,
      },
      body: JSON.stringify(nonEmptyTexts),
    });

    if (!response.ok) {
      throw new Error(`Translation failed with status ${response.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      indices.forEach((originalIndex, i) => {
        const translation = data[i]?.translations?.[0]?.text;
        if (translation) {
          results[originalIndex] = translation;
        }
      });
    }

    return results;
  },
};
