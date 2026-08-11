import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { getUserInfo, getUserDetailInfo } from '@/services/mybooksService';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';

const user = {
  id: 7,
  username: 'alice',
  nickname: 'Alice',
  email: 'alice@example.com',
  avatar: '/avatars/alice.png',
  is_admin: false,
  is_login: true,
  show_other_annotations: false,
};

describe('mybooksService — syncing show_other_annotations/currentUserId into the store', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
    useMyBooksStatusStore.setState({ showOtherAnnotations: true, currentUserId: null });
  });

  it('getUserInfo mirrors show_other_annotations and id into the store', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', user }),
    } as Response);

    await getUserInfo();

    expect(useMyBooksStatusStore.getState().showOtherAnnotations).toBe(false);
    expect(useMyBooksStatusStore.getState().currentUserId).toBe(7);
  });

  it('getUserDetailInfo mirrors show_other_annotations and id into the store', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', user: { ...user, podcast_token: '' } }),
    } as Response);

    await getUserDetailInfo();

    expect(useMyBooksStatusStore.getState().showOtherAnnotations).toBe(false);
    expect(useMyBooksStatusStore.getState().currentUserId).toBe(7);
  });

  it('leaves the store untouched when the user is not logged in (guest)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', user: { is_login: false, is_guest: true, id: 0 } }),
    } as Response);

    await getUserInfo();

    expect(useMyBooksStatusStore.getState().currentUserId).toBeNull();
    expect(useMyBooksStatusStore.getState().showOtherAnnotations).toBe(true);
  });
});
