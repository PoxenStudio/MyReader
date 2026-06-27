import { supabase } from '@/utils/supabase';
import {
  DEFAULT_DAILY_TRANSLATION_QUOTA_CHARS,
  DEFAULT_STORAGE_QUOTA_BYTES,
} from '@/services/constants';
import { isWebAppPlatform } from '@/services/environment';
import { getRuntimeConfig } from '@/services/runtimeConfig';

export const STORAGE_QUOTA_GRACE_BYTES = 10 * 1024 * 1024; // 10 MB grace

export const getStoragePlanData = () => {
  const usage = 1024 * 1024 * 500;
  const purchasedQuota = 1024 * 1024 * 1024 * 10;
  const runtimeConfig = getRuntimeConfig();
  const fixedQuota =
    runtimeConfig?.storageFixedQuota ?? parseInt(process.env['STORAGE_FIXED_QUOTA'] ?? '0');
  const quota = (fixedQuota || DEFAULT_STORAGE_QUOTA_BYTES) + purchasedQuota;

  return {
    usage,
    quota,
  };
};

export const getTranslationQuota = (): number => {
  const runtimeConfig = getRuntimeConfig();
  const fixedQuota =
    runtimeConfig?.translationFixedQuota ?? parseInt(process.env['TRANSLATION_FIXED_QUOTA'] ?? '0');
  return fixedQuota || DEFAULT_DAILY_TRANSLATION_QUOTA_CHARS;
};

export const getDailyTranslationPlanData = () => {
  return { quota: getTranslationQuota() };
};

export const getAccessToken = async (): Promise<string | null> => {
  // In browser context there might be two instances of supabase one in the app route
  // and the other in the pages route, and they might have different sessions
  // making the access token invalid for API calls. In that case we should use localStorage.
  if (isWebAppPlatform()) {
    return localStorage.getItem('token') ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
};

export const getUserID = async (): Promise<string | null> => {
  if (isWebAppPlatform()) {
    const user = localStorage.getItem('user') ?? '{}';
    return JSON.parse(user).id ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
};

export const validateUserAndToken = async (authHeader: string | null | undefined) => {
  if (!authHeader) return {};

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return {};
  return { user, token };
};
