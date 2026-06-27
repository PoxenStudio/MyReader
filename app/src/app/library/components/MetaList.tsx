'use client';

import clsx from 'clsx';
import { useState, useEffect, useCallback } from 'react';
import { MdStar, MdChevronRight } from 'react-icons/md';

export interface MetaItem {
  id: string;
  name: string;
  count: number;
  pinned?: boolean;
}

export interface MetaListProps {
  type: 'author' | 'tag' | 'publisher' | 'series' | 'language' | 'rating' | 'categories';
  items: MetaItem[];
  pins?: MetaItem[];
  total: number;
  loading: boolean;
  onSelectItem: (name: string) => void;
  currentItem?: string;
  onShowMore?: () => void;
  showAll?: boolean;
}

const MAX_ITEMS = 100;

const MetaList: React.FC<MetaListProps> = ({
  type,
  items,
  pins = [],
  total,
  loading,
  onSelectItem,
  currentItem,
  onShowMore,
  showAll = false,
}) => {
  const [displayItems, setDisplayItems] = useState<MetaItem[]>([]);

  useEffect(() => {
    // Combine pins and items, with pins first
    const combined = [...pins, ...items.filter((item) => !pins.some((pin) => pin.id === item.id))];
    setDisplayItems(showAll ? combined : combined.slice(0, MAX_ITEMS));
  }, [items, pins, showAll]);

  const handleItemClick = useCallback(
    (item: MetaItem) => {
      onSelectItem(item.name);
    },
    [onSelectItem],
  );

  const renderBadge = (item: MetaItem) => {
    const isActive = currentItem === item.name;

    if (type === 'rating') {
      // Special display for rating - show stars
      const rating = parseInt(item.name) || 0;
      return (
        <button
          key={item.id}
          onClick={() => handleItemClick(item)}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors',
            isActive
              ? 'bg-primary text-primary-content'
              : 'bg-base-200 hover:bg-base-300 text-base-content',
          )}
        >
          <div className='flex'>
            {[1, 2, 3, 4, 5].map((star) => (
              <MdStar
                key={star}
                size={14}
                className={clsx(
                  star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400',
                )}
              />
            ))}
          </div>
          <span className='text-xs opacity-70'>{item.count}</span>
        </button>
      );
    }

    // Default chip display for other types
    return (
      <button
        key={item.id}
        onClick={() => handleItemClick(item)}
        className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors',
          isActive
            ? 'bg-primary text-primary-content'
            : 'bg-base-200 hover:bg-base-300 text-base-content',
        )}
      >
        <span className='truncate max-w-[120px]'>{item.name}</span>
        <span className='text-xs opacity-70'>{item.count}</span>
      </button>
    );
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center py-8'>
        <div className='w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin' />
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-3'>
      {/* Display items */}
      <div className='flex flex-wrap gap-2'>{displayItems.map(renderBadge)}</div>

      {/* Show more button */}
      {total > MAX_ITEMS && !showAll && onShowMore && (
        <button
          onClick={onShowMore}
          className='flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors self-start'
        >
          <span>Show all ({total})</span>
          <MdChevronRight size={16} />
        </button>
      )}

      {/* Empty state */}
      {!loading && displayItems.length === 0 && (
        <div className='text-center text-base-content/60 py-4'>
          <p>No {type} found</p>
        </div>
      )}
    </div>
  );
};

export default MetaList;
