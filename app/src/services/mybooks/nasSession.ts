import { NasDeviceSettings } from '@/types/settings';

/**
 * How far ahead of the configured expiry we treat the NAS session as stale,
 * so the login webview (or its prompt) has time to run before the NAS side
 * actually cuts the cookie off.
 */
export const NAS_EXPIRY_LEAD_MINUTES = 2;

/**
 * A NAS session with no recorded login is always expired. Otherwise expired
 * once `now` is within `NAS_EXPIRY_LEAD_MINUTES` of `lastLoginAt + expiryMinutes`.
 */
export function isNasSessionExpired(
  lastLoginAt: number | null,
  expiryMinutes: number,
  now: number = Date.now(),
): boolean {
  if (lastLoginAt == null) return true;
  const thresholdMs = Math.max(0, expiryMinutes - NAS_EXPIRY_LEAD_MINUTES) * 60_000;
  return now - lastLoginAt >= thresholdMs;
}

/**
 * Whether an expired NAS session should auto-open the login webview, per the
 * "在过期时自动弹出设备登录窗口" toggle. When this is false the session can
 * still be expired — the user just has to refresh it manually (LoginDialog /
 * UserSettingsDialog icon) rather than being interrupted.
 */
export function shouldAutoPromptNasLogin(
  nas: NasDeviceSettings,
  now: number = Date.now(),
): boolean {
  if (!nas.enabled || !nas.autoPromptOnExpiry) return false;
  return isNasSessionExpired(nas.lastLoginAt, nas.expiryMinutes, now);
}
