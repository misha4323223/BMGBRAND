import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useCallback, useEffect, useRef } from "react";

const LOCAL_STORAGE_KEY = "guest_favorites";
const LOCAL_QUERY_KEY = ["local_favorites"];

function getLocalFavorites(): number[] {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed.filter((id: any) => typeof id === "number" && id > 0);
    }
  } catch {}
  return [];
}

function setLocalFavorites(ids: number[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(ids));
  queryClient.setQueryData<number[]>(LOCAL_QUERY_KEY, ids);
}

export function useFavorites() {
  const { data: authData } = useAuth();
  const isLoggedIn = !!authData?.user;
  const syncedRef = useRef(false);

  const { data: serverFavorites = [], isLoading: serverLoading } = useQuery<number[]>({
    queryKey: ["/api/auth/favorites"],
    enabled: isLoggedIn,
    staleTime: 1000 * 60 * 5,
  });

  const { data: localFavorites = [] } = useQuery<number[]>({
    queryKey: LOCAL_QUERY_KEY,
    queryFn: () => getLocalFavorites(),
    enabled: !isLoggedIn,
    staleTime: Infinity,
  });

  const favoriteIds = isLoggedIn ? serverFavorites : localFavorites;
  const isLoading = isLoggedIn ? serverLoading : false;

  useEffect(() => {
    if (!isLoggedIn) {
      syncedRef.current = false;
      queryClient.setQueryData<number[]>(LOCAL_QUERY_KEY, getLocalFavorites());
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn || syncedRef.current || serverLoading) return;
    const pending = getLocalFavorites();
    if (pending.length === 0) return;

    syncedRef.current = true;
    let mounted = true;
    const sync = async () => {
      try {
        for (const id of pending) {
          if (!serverFavorites.includes(id)) {
            await apiRequest("POST", `/api/auth/favorites/${id}`);
          }
        }
        if (mounted) {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          queryClient.setQueryData<number[]>(LOCAL_QUERY_KEY, []);
          queryClient.invalidateQueries({ queryKey: ["/api/auth/favorites"] });
        }
      } catch (err) {
        console.error("[Favorites] Sync error:", err);
        syncedRef.current = false;
      }
    };
    sync();
    return () => { mounted = false; };
  }, [isLoggedIn, serverLoading, serverFavorites]);

  const addMutation = useMutation({
    mutationFn: async (productId: number) => {
      if (isLoggedIn) {
        await apiRequest("POST", `/api/auth/favorites/${productId}`);
      }
    },
    onMutate: async (productId: number) => {
      if (isLoggedIn) {
        await queryClient.cancelQueries({ queryKey: ["/api/auth/favorites"] });
        const prev = queryClient.getQueryData<number[]>(["/api/auth/favorites"]) || [];
        queryClient.setQueryData<number[]>(["/api/auth/favorites"], [...prev, productId]);
        return { prev };
      } else {
        const current = getLocalFavorites();
        if (!current.includes(productId)) {
          const next = [...current, productId];
          setLocalFavorites(next);
        }
      }
    },
    onError: (_err, _productId, context) => {
      if (isLoggedIn && context?.prev) {
        queryClient.setQueryData(["/api/auth/favorites"], context.prev);
      }
    },
    onSuccess: () => {
      if (isLoggedIn) {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/favorites"] });
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (productId: number) => {
      if (isLoggedIn) {
        await apiRequest("DELETE", `/api/auth/favorites/${productId}`);
      }
    },
    onMutate: async (productId: number) => {
      if (isLoggedIn) {
        await queryClient.cancelQueries({ queryKey: ["/api/auth/favorites"] });
        const prev = queryClient.getQueryData<number[]>(["/api/auth/favorites"]) || [];
        queryClient.setQueryData<number[]>(["/api/auth/favorites"], prev.filter(id => id !== productId));
        return { prev };
      } else {
        const current = getLocalFavorites();
        const next = current.filter(id => id !== productId);
        setLocalFavorites(next);
      }
    },
    onError: (_err, _productId, context) => {
      if (isLoggedIn && context?.prev) {
        queryClient.setQueryData(["/api/auth/favorites"], context.prev);
      }
    },
    onSuccess: () => {
      if (isLoggedIn) {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/favorites"] });
      }
    },
  });

  const isFavorite = useCallback((productId: number) => {
    return favoriteIds.includes(productId);
  }, [favoriteIds]);

  const toggleFavorite = useCallback((productId: number) => {
    if (isFavorite(productId)) {
      removeMutation.mutate(productId);
    } else {
      addMutation.mutate(productId);
    }
    return true;
  }, [isFavorite, removeMutation, addMutation]);

  return {
    favoriteIds,
    isLoading,
    isLoggedIn,
    isFavorite,
    toggleFavorite,
    favoritesCount: favoriteIds.length,
  };
}
