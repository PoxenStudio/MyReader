import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import NoteEditor from '@/app/reader/components/notebook/NoteEditor';
import { useNotebookStore } from '@/store/notebookStore';
import { BookNote } from '@/types/book';

/**
 * The "apply to every occurrence in the book" toggle previously only existed
 * on the highlight-color popup (HighlightOptions), so a note added without
 * first picking a highlight color/style had no way to opt into book-wide
 * matching. NoteEditor — used for both creating and editing a note — must
 * expose the same toggle and report its value to the caller.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

afterEach(() => {
  cleanup();
  useNotebookStore.setState({
    notebookNewAnnotation: null,
    notebookEditAnnotation: null,
    notebookAnnotationDrafts: {},
  });
});

const annotation = (overrides: Partial<BookNote>): BookNote => ({
  id: 'note-1',
  type: 'annotation',
  cfi: 'some-cfi',
  note: 'existing note',
  text: '张三',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('NoteEditor global toggle', () => {
  it('defaults to off for a new note and reports true once toggled on', () => {
    useNotebookStore.setState({
      notebookNewAnnotation: {
        key: 'book-1',
        text: '张三',
        range: {} as Range,
        index: 0,
      } as never,
    });

    const onSave = vi.fn();
    render(<NoteEditor onSave={onSave} onEdit={vi.fn()} />);

    const toggle = screen.getByLabelText('Apply to every occurrence in the book');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    const textarea = screen.getByPlaceholderText('Add your notes here...');
    fireEvent.change(textarea, { target: { value: 'a person name' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ text: '张三' }),
      'a person name',
      true,
    );
  });

  it('seeds the toggle from an existing note being edited and reports the change', () => {
    const existing = annotation({ global: true });
    useNotebookStore.setState({ notebookEditAnnotation: existing });

    const onEdit = vi.fn();
    render(<NoteEditor onSave={vi.fn()} onEdit={onEdit} />);

    const toggle = screen.getByLabelText('Apply to every occurrence in the book');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByText('Save'));

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ global: false }));
  });
});
