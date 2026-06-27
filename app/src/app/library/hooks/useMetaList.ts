'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getCategories,
  getAuthors,
  getTags,
  getPublishers,
  getSeries,
  getLanguages,
  getRatings,
  type MyBooksMetaItem,
} from '@/services/mybooksService';
import type { MetaItem } from '../components/MetaList';

export type MetaType =
  | 'author'
  | 'tag'
  | 'publisher'
  | 'series'
  | 'language'
  | 'rating'
  | 'categories';

interface UseMetaListReturn {
  items: MetaItem[];
  pins: MetaItem[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// Convert MyBooksMetaItem to MetaItem (add id property)
const convertMetaItems = (items: MyBooksMetaItem[]): MetaItem[] => {
  return items.map((item, index) => ({
    id: item.name || `item-${index}`,
    name: item.name,
    count: item.count,
  }));
};

export const useMetaList = (type: MetaType): UseMetaListReturn => {
  const [items, setItems] = useState<MetaItem[]>([]);
  const [pins, setPins] = useState<MetaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    let apiFn;

    switch (type) {
      case 'author':
        apiFn = getAuthors;
        break;
      case 'tag':
        apiFn = getTags;
        break;
      case 'publisher':
        apiFn = getPublishers;
        break;
      case 'series':
        apiFn = getSeries;
        break;
      case 'language':
        apiFn = getLanguages;
        break;
      case 'rating':
        apiFn = getRatings;
        break;
      case 'categories':
        apiFn = getCategories;
        break;
      default:
        setError(`Unsupported meta type: ${type}`);
        return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await apiFn();
      setItems(convertMetaItems(result.items || []));
      setPins(convertMetaItems(result.pins || []));
      setTotal(result.total || 0);
    } catch (err) {
      // Can't reach MyBooks (offline, etc.) — degrade to an empty list
      // rather than showing an error; the offline indicator in the
      // header covers connectivity status.
      console.error(`Failed to fetch ${type} list:`, err);
      setItems([]);
      setPins([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);

  const refresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  return {
    items,
    pins,
    total,
    loading,
    error,
    refresh,
  };
};
