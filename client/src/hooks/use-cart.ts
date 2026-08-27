import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { InsertCartItem } from "@shared/schema";
import { useSession } from "./use-session";
import { useToast } from "@/hooks/use-toast";
import { useCartDrawer } from "@/components/CartDrawer";
import { pushEcommerce, type EcommerceProductInput } from "@/lib/ecommerce";

export function useCart() {
  const sessionId = useSession();
  
  return useQuery({
    queryKey: [api.cart.list.path, sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const url = buildUrl(api.cart.list.path, { sessionId });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch cart");
      return api.cart.list.responses[200].parse(await res.json());
    },
    enabled: !!sessionId,
  });
}

type AddToCartInput = Omit<InsertCartItem, 'sessionId'> & { ecommerce?: EcommerceProductInput };

export function useAddToCart() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sessionId = useSession();
  const { openDrawer } = useCartDrawer();

  return useMutation({
    mutationFn: async (data: AddToCartInput) => {
      if (!sessionId) throw new Error("No session");
      
      const { ecommerce: _ecommerce, ...rest } = data;
      const payload: InsertCartItem = { ...rest, sessionId };
      const res = await fetch(api.cart.addItem.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const err = new Error(errorData.message || "Failed to add to cart") as any;
        err.code = errorData.code;
        err.availableStock = errorData.availableStock;
        throw err;
      }
      const result = await res.json();
      return { ...result, stockLimited: result.stockLimited, stockMessage: result.message };
    },
    onSuccess: (result: any, variables: AddToCartInput) => {
      if (variables.ecommerce) {
        pushEcommerce("add", [{ ...variables.ecommerce, quantity: variables.quantity }]);
      }
      queryClient.invalidateQueries({ queryKey: [api.cart.list.path] });
      openDrawer();
      if (result?.stockLimited) {
        toast({
          title: "ОГРАНИЧЕНИЕ",
          description: result.stockMessage || "Добавлено максимально доступное количество",
        });
      }
    },
    onError: (error: any) => {
      if (error.code === "STOCK_LIMIT") {
        toast({
          variant: "destructive",
          title: "НЕТ В НАЛИЧИИ",
          description: error.message || "Товар уже в корзине в максимальном количестве",
        });
      } else {
        toast({
          variant: "destructive",
          title: "ОШИБКА",
          description: error.message || "Не удалось добавить товар.",
        });
      }
    }
  });
}

interface CartItemIdentifier {
  id: number;
  sessionId: string;
  productId: number;
  size: string | null;
  color: string | null;
}

export function useUpdateCartQuantity() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CartItemIdentifier & { quantity: number }) => {
      const params = new URLSearchParams({
        sessionId: data.sessionId,
        productId: String(data.productId),
        size: data.size || "One Size",
        color: data.color || "Default",
      });
      const url = `${buildUrl(api.cart.updateQuantity.path, { id: data.id })}?${params.toString()}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: data.quantity }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const err = new Error(errorData.message || "Failed to update quantity") as any;
        err.code = errorData.code;
        err.availableStock = errorData.availableStock;
        throw err;
      }
      return res.json();
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: [api.cart.list.path] });
      const previousCart = queryClient.getQueriesData({ queryKey: [api.cart.list.path] });
      queryClient.setQueriesData({ queryKey: [api.cart.list.path] }, (old: any) => {
        if (!old || !Array.isArray(old)) return old;
        return old.map((item: any) =>
          item.productId === data.productId &&
          (item.size || "One Size") === (data.size || "One Size") &&
          (item.color || "Default") === (data.color || "Default")
            ? { ...item, quantity: data.quantity }
            : item
        );
      });
      return { previousCart };
    },
    onError: (err: any, _data, context) => {
      if (context?.previousCart) {
        context.previousCart.forEach(([key, value]: [any, any]) => {
          queryClient.setQueryData(key, value);
        });
      }
      if (err.code === "STOCK_LIMIT") {
        toast({
          variant: "destructive",
          title: "ОГРАНИЧЕНИЕ",
          description: err.message || "Достигнут максимум на складе",
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [api.cart.list.path] });
    },
  });
}

interface RemoveCartItemParams {
  id: number;
  sessionId: string;
  productId: number;
  size: string | null;
  color: string | null;
  productName?: string;
  /** Метаданные для Яндекс.Метрики (e-commerce remove) */
  ecommerce?: EcommerceProductInput;
}

export function useRemoveFromCart() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (item: RemoveCartItemParams) => {
      const baseUrl = buildUrl(api.cart.removeItem.path, { id: item.id });
      const params = new URLSearchParams({
        sessionId: item.sessionId,
        productId: String(item.productId),
        size: item.size || "One Size",
        color: item.color || "Default",
      });
      const url = `${baseUrl}?${params.toString()}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove item");
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: [api.cart.list.path] });
      const previousCart = queryClient.getQueriesData({ queryKey: [api.cart.list.path] });
      queryClient.setQueriesData({ queryKey: [api.cart.list.path] }, (old: any) => {
        if (!old || !Array.isArray(old)) return old;
        return old.filter((item: any) =>
          !(item.productId === data.productId &&
            (item.size || "One Size") === (data.size || "One Size") &&
            (item.color || "Default") === (data.color || "Default"))
        );
      });
      return { previousCart };
    },
    onError: (_err, _data, context) => {
      if (context?.previousCart) {
        context.previousCart.forEach(([key, value]: [any, any]) => {
          queryClient.setQueryData(key, value);
        });
      }
    },
    onSuccess: (_data: void, _variables: RemoveCartItemParams) => {
      if (_variables.ecommerce) {
        pushEcommerce("remove", [_variables.ecommerce]);
      }
      toast({
        title: "УДАЛЕНО",
        description: "Товар удален из корзины.",
        className: "bg-black text-white border-primary",
      });
      window.dispatchEvent(new CustomEvent('cart-item-removed', { detail: { productName: _variables?.productName || '' } }));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [api.cart.list.path] });
    },
  });
}

export function useClearCart() {
  const queryClient = useQueryClient();
  const sessionId = useSession();

  return useMutation({
    mutationFn: async () => {
      if (!sessionId) return;
      const url = buildUrl(api.cart.clear.path, { sessionId });
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear cart");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.cart.list.path] });
    },
  });
}
