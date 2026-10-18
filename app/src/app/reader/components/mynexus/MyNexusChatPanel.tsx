'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IoCheckmark, IoCopyOutline, IoArrowUp } from 'react-icons/io5';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { EMPTY_MYNEXUS_SESSION, useMyNexusStore } from '@/store/myNexusStore';
import { openMindmapWindow } from '@/helpers/mindmapWindow';
import { writeTextToClipboard } from '@/utils/clipboard';
import { getLocale } from '@/utils/misc';
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
  const book = bookKey ? getBookData(bookKey)?.book : null;
  const bookId = book?.bookId;
  const bookTitle = book?.title;

  const session =
    useMyNexusStore((state) => (bookId ? state.sessions[bookId] : undefined)) ??
    EMPTY_MYNEXUS_SESSION;
  const { messages, loading, error } = session;

  const [question, setQuestion] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

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
    void useMyNexusStore.getState().ensureSession(bookId, bookTitle);
  }, [bookId, bookTitle]);

  const send = useCallback(
    (text: string) => {
      if (!bookId) return;
      setQuestion('');
      void useMyNexusStore.getState().send(bookId, text);
    },
    [bookId],
  );

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
      <div ref={listRef} className='min-h-0 flex-1 overflow-y-auto px-3 py-3'>
        <div className='flex flex-col gap-3'>
          {messages.map((message, index) => (
            <div
              key={index}
              className={clsx(
                'max-w-[92%] rounded-xl px-3 py-2',
                message.role === 'user' ? 'bg-primary/15 self-end' : 'bg-base-300/40 self-start',
              )}
            >
              <div className='text-base-content/60 mb-1 text-xs font-semibold'>
                {message.role === 'user' ? _('You') : '✴'}
              </div>
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
                <div className='break-words whitespace-pre-wrap'>{message.content}</div>
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
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(question);
              }
            }}
            rows={2}
            placeholder={_('Ask a question to start reading with this book')}
            className='textarea textarea-sm textarea-bordered max-h-32 w-full resize-none pr-11'
            disabled={loading}
          />
          <button
            type='button'
            className='btn btn-primary btn-sm absolute right-1.5 bottom-2.5 h-7 w-7 min-h-7 rounded-full p-0'
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
