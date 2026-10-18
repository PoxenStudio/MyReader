'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IoSend } from 'react-icons/io5';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import {
  getMyNexusSession,
  streamMyNexusChat,
  MyNexusChatMessage,
} from '@/services/mybooksService';
import MyNexusMarkdown from './MyNexusMarkdown';

interface MyNexusChatPanelProps {
  bookKey: string | null;
}

const MyNexusChatPanel: React.FC<MyNexusChatPanelProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const book = bookKey ? getBookData(bookKey)?.book : null;
  const bookId = book?.bookId;
  const bookTitle = book?.title;

  const [messages, setMessages] = useState<MyNexusChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const messagesRef = useRef<MyNexusChatMessage[]>([]);
  messagesRef.current = messages;
  const sendingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const send = useCallback(
    async (text: string, base?: MyNexusChatMessage[]) => {
      const content = text.trim();
      if (!content || !bookId || sendingRef.current) return;
      const prior = base ?? messagesRef.current;
      const requestMessages: MyNexusChatMessage[] = [...prior, { role: 'user', content }];
      sendingRef.current = true;
      setMessages([...requestMessages, { role: 'assistant', content: '', citations: [] }]);
      setQuestion('');
      setError('');
      setLoading(true);
      scrollToBottom();
      console.log(`[MyNexus] send book=${bookId} messages=${requestMessages.length}`);
      try {
        await streamMyNexusChat(bookId, requestMessages, {
          onDelta: (delta) => {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = { ...last, content: last.content + delta };
              }
              return next;
            });
            scrollToBottom();
          },
          onCitations: (citations) => {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = { ...last, citations };
              }
              return next;
            });
          },
        });
        console.log(`[MyNexus] send done book=${bookId}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[MyNexus] send failed book=${bookId}: ${message}`);
        setMessages((prev) => prev.slice(0, Math.max(0, prev.length - 2)));
        setError(message || _('AI Companion request failed'));
      } finally {
        sendingRef.current = false;
        setLoading(false);
      }
    },
    [bookId, _, scrollToBottom],
  );

  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    setError('');
    setMessages([]);
    console.log(`[MyNexus] load session book=${bookId}`);
    void (async () => {
      try {
        const { sessionId, messages: history } = await getMyNexusSession(bookId);
        if (cancelled) return;
        console.log(
          `[MyNexus] session book=${bookId} id=${sessionId ?? 'none'} messages=${history.length}`,
        );
        setMessages(history);
        if (history.length === 0 && bookTitle) {
          void sendRef.current(`现在我们开始伴读《${bookTitle}》这本书`, []);
        }
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[MyNexus] session failed book=${bookId}: ${message}`);
        setError(message || _('AI Companion request failed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, bookTitle, _]);

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
              loading &&
              index === messages.length - 1 ? (
                <span className='thinking-dots'>
                  <span />
                  <span />
                  <span />
                </span>
              ) : message.role === 'assistant' ? (
                <MyNexusMarkdown content={message.content} />
              ) : (
                <div className='break-words whitespace-pre-wrap'>{message.content}</div>
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
        <div className='flex items-end gap-2'>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(question);
              }
            }}
            rows={2}
            placeholder={_('Ask a question to start reading with this book')}
            className='textarea textarea-sm textarea-bordered max-h-32 w-full resize-none'
            disabled={loading}
          />
          <button
            type='button'
            className='btn btn-primary btn-sm h-9 min-h-9'
            title={_('Send')}
            onClick={() => void send(question)}
            disabled={loading || !question.trim()}
          >
            {loading ? (
              <span className='loading loading-spinner loading-xs' />
            ) : (
              <IoSend size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MyNexusChatPanel;
