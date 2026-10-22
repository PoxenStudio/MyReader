'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IoCheckmark, IoCopyOutline, IoArrowUp } from 'react-icons/io5';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { EMPTY_MYNEXUS_SESSION, useMyNexusStore } from '@/store/myNexusStore';
import { openMindmapWindow } from '@/helpers/mindmapWindow';
import { writeTextToClipboard } from '@/utils/clipboard';
import { getLocale } from '@/utils/misc';
import { buildMessageContext, buildReadingContext } from '@/utils/mynexusContext';
import { removeAiSelectionMarker } from '../../utils/aiSelectionMarker';
import MyNexusMarkdown from './MyNexusMarkdown';
import MyNexusMindmap from './MyNexusMindmap';

interface MyNexusChatPanelProps {
  bookKey: string | null;
}

const formatMessageTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const MyNexusChatPanel: React.FC<MyNexusChatPanelProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const getView = useReaderStore((state) => state.getView);
  const book = bookKey ? getBookData(bookKey)?.book : null;
  const bookId = book?.bookId;
  const bookTitle = book?.title;

  const session =
    useMyNexusStore((state) => (bookId ? state.sessions[bookId] : undefined)) ??
    EMPTY_MYNEXUS_SESSION;
  const { messages, loading, error } = session;
  const pendingSelection = useMyNexusStore((state) =>
    state.pendingSelection?.bookKey === bookKey ? state.pendingSelection : null,
  );

  const [question, setQuestion] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const copyMessage = useCallback((index: number, text: string) => {
    void writeTextToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopiedIndex(index);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedIndex(null), 1500);
    });
  }, []);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!bookId) return;
    void useMyNexusStore.getState().ensureSession(bookId, bookTitle, buildMessageContext(bookKey));
  }, [bookId, bookTitle, bookKey]);

  const clearStagedQuote = useCallback(() => {
    const pending = useMyNexusStore.getState().pendingSelection;
    if (!pending) return;
    removeAiSelectionMarker(getView(pending.bookKey), pending.bookKey);
    useMyNexusStore.getState().clearPendingSelection();
  }, [getView]);

  const buildContext = useCallback(() => {
    if (!pendingSelection) return buildMessageContext(bookKey);
    return {
      reading: buildReadingContext(bookKey) ?? pendingSelection.reading,
      selection: pendingSelection.selection,
    };
  }, [bookKey, pendingSelection]);

  const send = useCallback(
    (text: string) => {
      if (!bookId) return;
      const context = buildContext();
      const hasStagedQuote = !!pendingSelection;
      setQuestion('');
      void useMyNexusStore.getState().send(bookId, text, context);
      if (hasStagedQuote) {
        clearStagedQuote();
      }
    },
    [bookId, buildContext, pendingSelection, clearStagedQuote],
  );

  useEffect(() => {
    if (pendingSelection) {
      inputRef.current?.focus();
    }
  }, [pendingSelection]);

  const isEmpty = messages.length === 0 && !loading;

  return (
    <div className='flex min-h-0 w-full flex-1 flex-col'>
      <style jsx>{`
        .thinking-dots {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          margin: 0.35rem 0 0;
        }
        .thinking-dots span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          opacity: 0.4;
          animation: thinking-bounce 1s infinite ease-in-out;
        }
        .thinking-dots span:nth-child(2) {
          animation-delay: 0.15s;
        }
        .thinking-dots span:nth-child(3) {
          animation-delay: 0.3s;
        }
        @keyframes thinking-bounce {
          0%,
          80%,
          100% {
            opacity: 0.4;
            transform: translateY(0);
          }
          40% {
            opacity: 1;
            transform: translateY(-3px);
          }
        }
      `}</style>
      {pendingSelection && (
        <div className='border-primary/40 bg-primary/5 border-b px-3 py-2'>
          <div className='text-base-content/60 flex items-center justify-between gap-2 text-[11px]'>
            <span className='truncate'>
              ❝{' '}
              {[
                pendingSelection.selection.chapter_title,
                pendingSelection.selection.progress_fraction
                  ? `${Math.round(pendingSelection.selection.progress_fraction * 100)}%`
                  : '',
                pendingSelection.selection.page ? `p.${pendingSelection.selection.page}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <button
              type='button'
              className='hover:text-base-content cursor-pointer px-1'
              title={_('Cancel')}
              onClick={clearStagedQuote}
            >
              ✕
            </button>
          </div>
          <div className='line-clamp-3 text-xs italic'>{pendingSelection.selection.text}</div>
          <div className='mt-1.5 flex flex-wrap gap-1.5'>
            <button
              type='button'
              className='btn btn-xs'
              onClick={() => {
                setQuestion(_('Explain this passage'));
                inputRef.current?.focus();
              }}
            >
              {_('Explain this passage')}
            </button>
            <button
              type='button'
              className='btn btn-xs'
              onClick={() => {
                setQuestion(_('What is this passage about'));
                inputRef.current?.focus();
              }}
            >
              {_('What is this passage about')}
            </button>
          </div>
        </div>
      )}
      <div ref={listRef} className='min-h-0 flex-1 overflow-y-auto px-3 py-3'>
        <div className='flex flex-col gap-3'>
          {messages.map((message, index) => (
            <div
              key={index}
              className={clsx(
                'rounded-xl px-3 py-2',
                message.role === 'user'
                  ? 'bg-primary/15 max-w-[92%] self-end'
                  : 'bg-base-300/40 w-full',
              )}
            >
              {message.role === 'assistant' && (
                <div className='text-base-content/60 mb-1 text-xs font-semibold'>✴</div>
              )}
              {message.role === 'assistant' &&
              !message.content &&
              !message.mindmap &&
              loading &&
              index === messages.length - 1 ? (
                <span className='thinking-dots'>
                  <span />
                  <span />
                  <span />
                </span>
              ) : message.role === 'assistant' ? (
                <>
                  <MyNexusMarkdown content={message.content} />
                  {message.mindmap && (
                    <MyNexusMindmap
                      markdown={message.mindmap.markdown}
                      title={message.mindmap.title}
                      onExpand={() => {
                        if (!bookId || !message.mindmap) return;
                        console.log(
                          `[MyNexus] mindmap expand book=${bookId} length=${message.mindmap.markdown.length}`,
                        );
                        void openMindmapWindow(bookId, {
                          title: message.mindmap.title || _('Mind Map'),
                          markdown: message.mindmap.markdown,
                        });
                      }}
                    />
                  )}
                </>
              ) : (
                <div>
                  {message.context?.selection?.text && (
                    <details className='border-base-content/20 bg-base-100/50 mb-1.5 border-s-2 px-2 py-1'>
                      <summary className='text-base-content/50 cursor-pointer text-[11px]'>
                        ❝{' '}
                        {[
                          message.context.selection.chapter_title,
                          message.context.selection.progress_fraction
                            ? `${Math.round(message.context.selection.progress_fraction * 100)}%`
                            : '',
                          message.context.selection.page
                            ? `p.${message.context.selection.page}`
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </summary>
                      <div className='mt-1 text-xs break-words whitespace-pre-wrap italic'>
                        {message.context.selection.text}
                      </div>
                    </details>
                  )}
                  <div className='break-words whitespace-pre-wrap'>{message.content}</div>
                </div>
              )}
              {message.role === 'assistant' && message.createdAt && (
                <div className='text-base-content/50 mt-1 text-xs'>
                  {formatMessageTime(message.createdAt)}
                </div>
              )}
              {message.role === 'user' && (
                <div className='text-base-content/50 mt-1 flex items-center justify-end gap-1.5 text-xs'>
                  {message.createdAt && <span>{formatMessageTime(message.createdAt)}</span>}
                  <button
                    type='button'
                    className='hover:text-base-content cursor-pointer'
                    title={_('Copy')}
                    onClick={() => copyMessage(index, message.content)}
                  >
                    {copiedIndex === index ? (
                      <IoCheckmark size={13} />
                    ) : (
                      <IoCopyOutline size={13} />
                    )}
                  </button>
                </div>
              )}
              {(message.citations ?? []).map((citation, citationIndex) => (
                <details key={citationIndex} className='mt-2'>
                  <summary className='cursor-pointer text-xs'>
                    {_('Citation')} {citationIndex + 1}
                  </summary>
                  <div className='mt-1 text-xs break-words whitespace-pre-wrap'>
                    {citation.content}
                  </div>
                </details>
              ))}
            </div>
          ))}
          {error && <div className='text-error text-sm'>{error}</div>}
          {isEmpty && (
            <div className='text-base-content/50 py-8 text-center text-sm'>
              {_('Ask a question to start reading with this book')}
            </div>
          )}
        </div>
      </div>
      <div className='border-base-300 flex-shrink-0 border-t p-2'>
        <div className='relative'>
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(question);
              }
            }}
            rows={2}
            placeholder={
              pendingSelection
                ? _('Ask about the selected text')
                : _('Ask a question to start reading with this book')
            }
            className='textarea textarea-bordered max-h-32 w-full resize-none pr-11 !leading-6 text-sm'
            disabled={loading}
          />
          <button
            type='button'
            className='btn btn-primary btn-sm absolute right-1.5 bottom-2 h-7 w-7 min-h-7 rounded-full p-0'
            title={_('Send')}
            onClick={() => send(question)}
            disabled={loading || !question.trim()}
          >
            {loading ? (
              <span className='loading loading-spinner loading-xs' />
            ) : (
              <IoArrowUp size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MyNexusChatPanel;
