import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { MdLibraryAddCheck } from 'react-icons/md';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { TextSelection } from '@/utils/sel';
import { md5Fingerprint } from '@/utils/md5';
import { BookNote } from '@/types/book';
import useShortcuts from '@/hooks/useShortcuts';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';
import TextButton from '@/components/TextButton';

interface NoteEditorProps {
  onSave: (selection: TextSelection, note: string, global: boolean) => void;
  onEdit: (annotation: BookNote) => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ onSave, onEdit }) => {
  const _ = useTranslation();
  const {
    notebookNewAnnotation,
    notebookEditAnnotation,
    setNotebookNewAnnotation,
    setNotebookEditAnnotation,
    saveNotebookAnnotationDraft,
    getNotebookAnnotationDraft,
  } = useNotebookStore();

  const editorRef = useRef<TextEditorRef>(null);
  const [note, setNote] = useState('');
  // Whether this note should also be shown wherever its selected text
  // recurs elsewhere in the book (see globalAnnotations.ts). Note-only
  // annotations previously had no way to opt into this — only the
  // highlight-color popup exposed the toggle.
  const [isGlobal, setIsGlobal] = useState(false);
  const separatorWidth = useResponsiveSize(3);

  useEffect(() => {
    if (notebookEditAnnotation) {
      const noteText = notebookEditAnnotation.note;
      setNote(noteText);
      setIsGlobal(!!notebookEditAnnotation.global);
      editorRef.current?.setValue(noteText);
      editorRef.current?.focus();
    } else if (notebookNewAnnotation) {
      const noteText = getAnnotationText();
      setIsGlobal(false);
      if (noteText) {
        const draftNote = getNotebookAnnotationDraft(md5Fingerprint(noteText)) || '';
        setNote(draftNote);
        editorRef.current?.setValue(draftNote);
        editorRef.current?.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookNewAnnotation, notebookEditAnnotation]);

  const getAnnotationText = () => {
    return notebookEditAnnotation?.text || notebookNewAnnotation?.text || '';
  };

  const handleNoteChange = (value: string) => {
    setNote(value);
  };

  const handleBlur = () => {
    const currentValue = editorRef.current?.getValue();
    if (currentValue) {
      const noteText = getAnnotationText();
      if (noteText) {
        saveNotebookAnnotationDraft(md5Fingerprint(noteText), currentValue);
      }
    }
  };

  const handleSaveNote = () => {
    const currentValue = editorRef.current?.getValue();
    if (currentValue) {
      if (notebookNewAnnotation) {
        onSave(notebookNewAnnotation, currentValue, isGlobal);
      } else if (notebookEditAnnotation) {
        notebookEditAnnotation.note = currentValue;
        notebookEditAnnotation.global = isGlobal;
        onEdit(notebookEditAnnotation);
      }
    }
  };

  const handleEscape = () => {
    if (notebookNewAnnotation) {
      // Clearing the selection ends the creation flow; Notebook reacts to that
      // and tears down the empty placeholder highlight it created (#4791).
      setNotebookNewAnnotation(null);
    }
    if (notebookEditAnnotation) {
      setNotebookEditAnnotation(null);
    }
  };

  useShortcuts({
    onSaveNote: () => {
      const currentValue = editorRef.current?.getValue();
      if (currentValue) {
        handleSaveNote();
      }
    },
    onEscape: handleEscape,
  });

  const canSave = Boolean(note.trim());

  return (
    <div className='content booknote-item note-editor-container bg-base-100 mt-2 rounded-md p-2'>
      <div className='flex w-full'>
        <TextEditor
          ref={editorRef}
          value={note}
          onChange={handleNoteChange}
          onBlur={handleBlur}
          onSave={handleSaveNote}
          onEscape={handleEscape}
          placeholder={_('Add your notes here...')}
          spellCheck={false}
        />
      </div>

      <div className='flex items-center pt-2'>
        <div
          className='me-2 mt-0.5 min-h-full self-stretch rounded-xl bg-gray-300'
          style={{
            minWidth: `${separatorWidth}px`,
          }}
        ></div>
        <div className='content font-size-sm line-clamp-3'>
          <span className='content font-size-xs text-gray-500'>{getAnnotationText()}</span>
        </div>
      </div>

      <div className='flex items-center justify-between space-x-3 p-2' dir='ltr'>
        <button
          type='button'
          aria-label={_('Apply to every occurrence in the book')}
          aria-pressed={isGlobal}
          title={_('Apply to every occurrence in the book')}
          onClick={() => setIsGlobal((prev) => !prev)}
          className={clsx(
            'eink-bordered flex items-center gap-1 rounded-full p-1',
            isGlobal
              ? 'not-eink:text-blue-400'
              : 'not-eink:text-gray-400 hover:not-eink:text-gray-200',
          )}
        >
          <MdLibraryAddCheck size={16} />
        </button>
        <div className='flex justify-end space-x-3'>
          <TextButton onClick={handleEscape}>{_('Cancel')}</TextButton>
          <TextButton onClick={handleSaveNote} disabled={!canSave}>
            {_('Save')}
          </TextButton>
        </div>
      </div>
    </div>
  );
};

export default NoteEditor;
