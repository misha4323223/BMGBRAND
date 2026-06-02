import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "recently-viewed-products";
const MAX_ITEMS = 12;

export function useRecentlyViewed() {
  const [viewedIds, setViewedIds] = useState<number[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setViewedIds(JSON.parse(stored));
      }
    } catch {}
  }, []);

  const addViewed = useCallback((productId: number) => {
    setViewedIds(prev => {
      const filtered = prev.filter(id => id !== productId);
      const updated = [productId, ...filtered].slice(0, MAX_ITEMS);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  return { viewedIds, addViewed };
}
