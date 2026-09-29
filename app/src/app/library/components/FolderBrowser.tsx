'use client';

import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';
import { MdChevronRight, MdFolder, MdHome } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { getFolderTree, type MyBooksFolderNode } from '@/services/mybooksService';

interface FolderBrowserProps {
  path: string;
  hasBooks: boolean;
  onNavigate: (path: string) => void;
}

const FolderBrowser: React.FC<FolderBrowserProps> = ({ path, hasBooks, onNavigate }) => {
  const _ = useTranslation();
  const [tree, setTree] = useState<MyBooksFolderNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFolderTree()
      .then(setTree)
      .catch((error) => console.error('Failed to load folders:', error))
      .finally(() => setLoading(false));
  }, []);

  const segments = useMemo(() => (path ? path.split('.') : []), [path]);
  const subFolders = useMemo(
    () =>
      segments.reduce<MyBooksFolderNode[]>(
        (nodes, name) => nodes.find((n) => n.name === name)?.children || [],
        tree,
      ),
    [segments, tree],
  );

  const chipClass = (active: boolean) =>
    clsx(
      'flex items-center gap-1 px-3 py-1.5 rounded-full text-sm transition-colors',
      active
        ? 'bg-primary text-primary-content'
        : 'bg-base-200 hover:bg-base-300 text-base-content',
    );

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-1'>
        <button className={chipClass(!path)} onClick={() => onNavigate('')} title={_('Folders')}>
          <MdHome size={16} />
        </button>
        {segments.map((name, idx) => (
          <React.Fragment key={idx}>
            <MdChevronRight size={16} className='opacity-60' />
            <button
              className={chipClass(idx === segments.length - 1)}
              onClick={() => onNavigate(segments.slice(0, idx + 1).join('.'))}
            >
              <span className='truncate max-w-[160px]'>{name}</span>
            </button>
          </React.Fragment>
        ))}
      </div>

      {loading ? (
        <div className='flex items-center justify-center py-4'>
          <div className='w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin' />
        </div>
      ) : subFolders.length > 0 ? (
        <div className='flex flex-wrap gap-2'>
          {subFolders.map((item) => (
            <button
              key={item.name}
              onClick={() => onNavigate(path ? `${path}.${item.name}` : item.name)}
              className='flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors bg-base-200 hover:bg-base-300 text-base-content'
            >
              <MdFolder size={16} className='text-amber-600' />
              <span className='truncate max-w-[160px]'>{item.name}</span>
              <span className='text-xs opacity-70'>{item.count}</span>
            </button>
          ))}
        </div>
      ) : (
        !hasBooks && (
          <div className='text-center text-base-content/60 py-4'>{_('This folder is empty')}</div>
        )
      )}
    </div>
  );
};

export default FolderBrowser;
