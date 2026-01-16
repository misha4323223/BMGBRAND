import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { InsertCartItem } from "@shared/schema";
import { useSession } from "./use-session";
import { useToast } from "@/hooks/use-toast";

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

export function useAddToCart() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sessionId = useSession();

  return useMutation({
    mutationFn: async (data: Omit<InsertCartItem, 'sessionId'>) => {
      if (!sessionId) throw new Error("No session");
      
      const payload: InsertCartItem = { ...data, sessionId };
      const res = await fetch(api.cart.addItem.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) throw new Error("Failed to add to cart");
      return api.cart.addItem.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.cart.list.path] });
      toast({
        title: "ADDED TO CART",
        description: "Item successfully added.",
        className: "bg-black text-white border-primary",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "ERROR",
        description: "Could not add item.",
      });
    }
  });
}

interface RemoveCartItemParams {
  id: number;
  sessionId: string;
  productId: number;
  size: string | null;
  color: string | null;
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.cart.list.path] });
      toast({
        title: "REMOVED",
        description: "Item removed from cart.",
        className: "bg-black text-white border-primary",
      });
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
