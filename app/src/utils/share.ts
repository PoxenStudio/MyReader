import { writeTextToClipboard } from '@/utils/clipboard';

export interface SharePosition {
  x: number;
  y: number;
  preferredEdge?: 'top' | 'bottom' | 'left' | 'right';
}

/** Minimal slice of AppService needed to decide the native-share path. */
interface ShareCapableService {
  isMobileApp?: boolean;
  isMacOSApp?: boolean;
}

/**
 * Whether the selected text can be shared by ANY method on this platform —
 * native sharekit (mobile/macOS) or the Web Share API. Used to gate the Share
 * tool's visibility in the selection toolbar and its customizer. Kept next to
 * `shareSelectedText` so the two stay in sync.
 */
export const canShareText = (appService?: ShareCapableService | null): boolean =>
  !!appService?.isMobileApp ||
  !!appService?.isMacOSApp ||
  (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

/**
 * Open the OS share sheet for `text`, with graceful fallbacks.
 *
 * Ladder:
 *  1. Native sharekit on mobile + macOS only. Windows/Linux are excluded: the
 *     plugin's share UI can freeze the app on Windows (issue #4343) and is not
 *     functional on Linux — `nativeAppService` gates `shareFile` the same way.
 *  2. `navigator.share` (web / PWA). A rejection means the user dismissed the
 *     sheet — respect it, don't silently copy.
 *  3. Clipboard, as a last resort when no share method exists.
 */
export const shareSelectedText = async (
  text: string,
  position?: SharePosition,
  appService?: ShareCapableService | null,
): Promise<void> => {
  if (!text) return;

  if (appService?.isMobileApp || appService?.isMacOSApp) {
    try {
      const { shareText } = await import('@choochmeque/tauri-plugin-sharekit-api');
      await shareText(text, { position });
      return;
    } catch (err) {
      console.error('shareText failed; falling back:', err);
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      // Only respect a user cancel (AbortError). Other failures — e.g.
      // NotAllowedError when a quick action fires without a user gesture —
      // fall through to the clipboard so the user still gets the text.
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }

  await writeTextToClipboard(text);
};
