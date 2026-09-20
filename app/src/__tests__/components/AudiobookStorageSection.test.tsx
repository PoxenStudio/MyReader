import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    if (!params) return key;
    return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), key);
  },
}));

const askMock = vi.fn().mockResolvedValue(true);
// A stable object identity across renders — like the real EnvContext's
// memoized value — so the component's `refresh` useCallback (which depends
// on `appService`) doesn't get a new identity every render and re-trigger
// its effect in a loop.
const mockAppService = { ask: (...a: unknown[]) => askMock(...a) };
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: mockAppService }),
}));

let library: Array<{ bookId?: number; title: string }> = [];
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: (selector: (s: unknown) => unknown) => selector({ library }),
}));

const deleteLocalAudiobookMock = vi.fn().mockResolvedValue(undefined);
const getAllLocalAudiobooksMock = vi.fn();
vi.mock('@/services/audiobook/audiobookDownloader', () => ({
  deleteLocalAudiobook: (...a: unknown[]) => deleteLocalAudiobookMock(...a),
  getAllLocalAudiobooks: (...a: unknown[]) => getAllLocalAudiobooksMock(...a),
}));

import AudiobookStorageSection from '@/components/user/AudiobookStorageSection';

describe('AudiobookStorageSection', () => {
  beforeEach(() => {
    library = [{ bookId: 5, title: 'Dune' }];
    vi.clearAllMocks();
    askMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing while nothing is downloaded', async () => {
    getAllLocalAudiobooksMock.mockResolvedValue([]);
    const { container } = await act(async () => render(<AudiobookStorageSection />));
    expect(container.firstChild).toBeNull();
  });

  it('lists downloaded audiobooks with title (from the library) and size, plus a total', async () => {
    getAllLocalAudiobooksMock.mockResolvedValue([
      { bookId: 5, sizeBytes: 1024 * 1024 },
      { bookId: 9, sizeBytes: 512 * 1024 },
    ]);
    await act(async () => render(<AudiobookStorageSection />));

    expect(screen.getByText('Dune')).toBeTruthy();
    // bookId 9 has no matching library entry -> falls back to a placeholder.
    expect(screen.getByText('Book #9')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
  });

  it('deletes a single audiobook and refreshes the list', async () => {
    getAllLocalAudiobooksMock
      .mockResolvedValueOnce([{ bookId: 5, sizeBytes: 1024 }])
      .mockResolvedValueOnce([]);
    await act(async () => render(<AudiobookStorageSection />));

    await act(async () => fireEvent.click(screen.getByTitle('Delete')));

    expect(deleteLocalAudiobookMock).toHaveBeenCalledWith(expect.anything(), 5);
    expect(getAllLocalAudiobooksMock).toHaveBeenCalledTimes(2);
  });

  it('asks for confirmation before clearing all, and does nothing if declined', async () => {
    getAllLocalAudiobooksMock.mockResolvedValue([{ bookId: 5, sizeBytes: 1024 }]);
    askMock.mockResolvedValueOnce(false);
    await act(async () => render(<AudiobookStorageSection />));

    await act(async () => fireEvent.click(screen.getByText('Clear all')));

    expect(askMock).toHaveBeenCalled();
    expect(deleteLocalAudiobookMock).not.toHaveBeenCalled();
  });

  it('clears all downloads once confirmed', async () => {
    getAllLocalAudiobooksMock
      .mockResolvedValueOnce([
        { bookId: 5, sizeBytes: 1024 },
        { bookId: 9, sizeBytes: 2048 },
      ])
      .mockResolvedValueOnce([]);
    await act(async () => render(<AudiobookStorageSection />));

    await act(async () => fireEvent.click(screen.getByText('Clear all')));

    expect(deleteLocalAudiobookMock).toHaveBeenCalledWith(expect.anything(), 5);
    expect(deleteLocalAudiobookMock).toHaveBeenCalledWith(expect.anything(), 9);
  });
});
