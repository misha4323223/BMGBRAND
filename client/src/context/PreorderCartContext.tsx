// @refresh reset
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface PreorderCartItem {
  productId: number;
  productName: string;
  price: number;
  imageUrl: string;
  slug?: string;
  selectedSizes: Record<string, number>;
  selectedColor?: string;
  preorderDeadline?: string | null;
  preorderShippingDate?: string | null;
  preorderProductionDate?: string | null;
}

interface PreorderCartContextType {
  items: PreorderCartItem[];
  addOrUpdateItem: (item: PreorderCartItem) => void;
  removeItem: (productId: number) => void;
  updateSizes: (productId: number, sizes: Record<string, number>) => void;
  updateItemPrice: (productId: number, price: number) => void;
  clearCart: () => void;
  totalCount: number;
  totalQuantity: number;
  totalPrice: number;
}

const PreorderCartContext = createContext<PreorderCartContextType | null>(null);

const STORAGE_KEY = "bmg_preorder_cart";

function loadCart(): PreorderCartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(items: PreorderCartItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export function PreorderCartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<PreorderCartItem[]>(() => loadCart());

  useEffect(() => {
    saveCart(items);
  }, [items]);

  const addOrUpdateItem = (newItem: PreorderCartItem) => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.productId === newItem.productId);
      if (idx >= 0) {
        const updated = [...prev];
        const merged = { ...prev[idx].selectedSizes };
        for (const [size, qty] of Object.entries(newItem.selectedSizes)) {
          merged[size] = (merged[size] || 0) + qty;
        }
        updated[idx] = { ...prev[idx], ...newItem, selectedSizes: merged };
        return updated;
      }
      return [...prev, newItem];
    });
  };

  const removeItem = (productId: number) => {
    setItems(prev => prev.filter(i => i.productId !== productId));
  };

  const updateSizes = (productId: number, sizes: Record<string, number>) => {
    setItems(prev =>
      prev.map(i => i.productId === productId ? { ...i, selectedSizes: sizes } : i)
    );
  };

  const updateItemPrice = (productId: number, price: number) => {
    setItems(prev =>
      prev.map(i => i.productId === productId ? { ...i, price } : i)
    );
  };

  const clearCart = () => setItems([]);

  const totalCount = items.length;
  const totalQuantity = items.reduce(
    (s, i) => s + Object.values(i.selectedSizes).reduce((a, b) => a + b, 0),
    0
  );
  const totalPrice = items.reduce((s, i) => {
    const qty = Object.values(i.selectedSizes).reduce((a, b) => a + b, 0);
    return s + i.price * qty;
  }, 0);

  return (
    <PreorderCartContext.Provider
      value={{ items, addOrUpdateItem, removeItem, updateSizes, updateItemPrice, clearCart, totalCount, totalQuantity, totalPrice }}
    >
      {children}
    </PreorderCartContext.Provider>
  );
}

export function usePreorderCart() {
  const ctx = useContext(PreorderCartContext);
  if (!ctx) throw new Error("usePreorderCart must be used inside PreorderCartProvider");
  return ctx;
}
