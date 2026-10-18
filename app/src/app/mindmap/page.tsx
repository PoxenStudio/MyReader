'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { listen } from '@tauri-apps/api/event';

import Spinner from '@/components/Spinner';
import { useTheme } from '@/hooks/useTheme';
import { isTauriAppPlatform } from '@/services/environment';
import { MINDMAP_CONTENT_EVENT, MindmapContent, readMindmapContent } from '@/helpers/mindmapWindow';
import MyNexusMindmap from '../reader/components/mynexus/MyNexusMindmap';

const MindmapViewer = () => {
  const searchParams = useSearchParams();
  const bookId = Number(searchParams?.get('id') ?? '');
  const [content, setContent] = useState<MindmapContent | null>(null);

  useEffect(() => {
    if (!bookId) return;
    const initial = readMindmapContent(bookId);
    console.log(
      `[MyNexus] mindmap viewer book=${bookId} loaded=${initial ? initial.markdown.length : 0}`,
    );
    setContent(initial);

    if (!isTauriAppPlatform()) return;
    let unlisten: (() => void) | undefined;
    void listen<MindmapContent>(MINDMAP_CONTENT_EVENT, (event) => {
      console.log(
        `[MyNexus] mindmap viewer book=${bookId} updated=${event.payload.markdown.length}`,
      );
      setContent(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [bookId]);

  return (
    <div className='bg-base-100 fixed inset-0 flex flex-col overflow-hidden p-2'>
      {content ? (
        <MyNexusMindmap
          markdown={content.markdown}
          title={content.title}
          fill
          hideTitle
          showExpand={false}
        />
      ) : (
        <div className='flex flex-1 items-center justify-center'>
          <Spinner loading />
        </div>
      )}
    </div>
  );
};

const MindmapPage = () => {
  useTheme();

  return (
    <Suspense
      fallback={
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      }
    >
      <MindmapViewer />
    </Suspense>
  );
};

export default MindmapPage;
