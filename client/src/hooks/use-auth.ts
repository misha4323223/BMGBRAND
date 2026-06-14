import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

export interface User {
  id: number;
  email: string;
  name: string;
  emailVerified: boolean;
  role?: string;
  companyName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  legalAddress?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  wholesaleApproved?: boolean;
  wholesaleDiscount?: number;
  phone?: string | null;
  yandexId?: string | null;
  yandexLogin?: string | null;
  yandexAvatar?: string | null;
  totalSpent?: number;
  loyaltyDiscount?: number;
  birthday?: string | null;
  gender?: string | null;
  storeName?: string | null;
  storeAddress?: string | null;
  partnerSlug?: string | null;
}

interface AuthResponse {
  user: User;
  token: string;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
}

interface LoginData {
  email: string;
  password: string;
  role?: 'retail' | 'wholesale';
}

export function useAuth() {
  return useQuery<{ user: User | null } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 1000 * 60 * 5,
  });
}

export function useWholesalePrice() {
  const { data: authData } = useAuth();
  const user = authData?.user;
  
  const isWholesale = user?.role === 'wholesale' && user?.wholesaleApproved === true;
  
  // Get wholesale price - only use real price from 1C (no fallback calculation)
  const getWholesalePrice = (retailPrice: number, productWholesalePrice?: number | null) => {
    if (!isWholesale) return null;
    
    // Only return real wholesale price from 1C
    if (productWholesalePrice != null && productWholesalePrice > 0) {
      return productWholesalePrice;
    }
    
    // No fallback - if no 1C price, show retail price
    return null;
  };
  
  return { isWholesale, getWholesalePrice };
}

export function useRegister() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: RegisterData) => {
      const res = await apiRequest("POST", "/api/auth/register", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: LoginData) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json() as Promise<AuthResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      // Привязываем анонимную push-подписку к аккаунту пользователя
      try {
        if ("serviceWorker" in navigator && "PushManager" in window) {
          navigator.serviceWorker.ready.then((reg) =>
            reg.pushManager.getSubscription().then((sub) => {
              if (sub) {
                fetch("/api/push/subscribe", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ subscription: sub.toJSON() }),
                  credentials: "include",
                }).catch(() => {});
              }
            })
          ).catch(() => {});
        }
      } catch {}
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout");
      return res.json();
    },
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["/api/auth/me"], { user: null });
    },
  });
}

export function useVerifyEmail() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (token: string) => {
      const res = await apiRequest("POST", "/api/auth/verify-email", { token });
      return res.json() as Promise<AuthResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (data: { email: string; role?: 'retail' | 'wholesale' }) => {
      const res = await apiRequest("POST", "/api/auth/forgot-password", data);
      return res.json();
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (data: { token: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/reset-password", data);
      return res.json();
    },
  });
}
