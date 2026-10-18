'use client';

import React, { useMemo } from 'react';
import { marked } from 'marked';

import { sanitizeHtml } from '@/utils/sanitize';

interface MyNexusMarkdownProps {
  content: string;
}

const MyNexusMarkdown: React.FC<MyNexusMarkdownProps> = ({ content }) => {
  const html = useMemo(
    () => sanitizeHtml(marked.parse(content || '', { breaks: true, gfm: true }) as string),
    [content],
  );

  return (
    <div className='mynexus-markdown'>
      <style jsx>{`
        .mynexus-markdown {
          overflow-wrap: anywhere;
          line-height: 1.6;
        }
        .mynexus-markdown :global(> :first-child) {
          margin-top: 0;
        }
        .mynexus-markdown :global(> :last-child) {
          margin-bottom: 0;
        }
        .mynexus-markdown :global(h1),
        .mynexus-markdown :global(h2),
        .mynexus-markdown :global(h3),
        .mynexus-markdown :global(h4) {
          margin: 1rem 0 0.5rem;
          line-height: 1.3;
        }
        .mynexus-markdown :global(p) {
          margin: 0.6rem 0;
        }
        .mynexus-markdown :global(ul),
        .mynexus-markdown :global(ol) {
          margin: 0.6rem 0;
          padding-inline-start: 1.4rem;
        }
        .mynexus-markdown :global(ul) {
          list-style: disc;
        }
        .mynexus-markdown :global(ol) {
          list-style: decimal;
        }
        .mynexus-markdown :global(pre),
        .mynexus-markdown :global(table) {
          max-width: 100%;
          overflow-x: auto;
        }
        .mynexus-markdown :global(pre) {
          padding: 0.6rem 0.8rem;
          border-radius: 8px;
          background: rgba(128, 128, 128, 0.12);
        }
        .mynexus-markdown :global(code) {
          padding: 0.1rem 0.3rem;
          border-radius: 4px;
          background: rgba(128, 128, 128, 0.12);
          font-size: 0.9em;
        }
        .mynexus-markdown :global(th),
        .mynexus-markdown :global(td) {
          border: 1px solid currentColor;
          padding: 0.2em 0.5em;
        }
        .mynexus-markdown :global(table) {
          border-collapse: collapse;
        }
      `}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};

export default MyNexusMarkdown;
