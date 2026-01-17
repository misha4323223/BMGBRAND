import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { InsertProduct, Product } from "@shared/schema";

interface PaginatedResponse {
  products: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export function useProducts() {
  return useQuery({
    queryKey: [api.products.list.path],
    queryFn: async () => {
      const res = await fetch(api.products.list.path);
      if (!res.ok) throw new Error("Failed to fetch products");
      const data: PaginatedResponse = await res.json();
      return data.products;
    },
  });
}

export function usePaginatedProducts(
  limit: number = 24, 
  category?: string, 
  subcategory?: string,
  sale?: boolean
) {
  const queryParams = new URLSearchParams();
  if (category) queryParams.set("category", category);
  if (subcategory) queryParams.set("subcategory", subcategory);
  if (sale) queryParams.set("sale", "true");
  const filterKey = queryParams.toString();
  
  return useInfiniteQuery({
    queryKey: [api.products.list.path, 'paginated', limit, filterKey],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      params.set("page", String(pageParam));
      params.set("limit", String(limit));
      if (category) params.set("category", category);
      if (subcategory) params.set("subcategory", subcategory);
      if (sale) params.set("sale", "true");
      
      const res = await fetch(`${api.products.list.path}?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch products");
      return res.json() as Promise<PaginatedResponse>;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => 
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
  });
}

export function useProduct(id: number) {
  return useQuery({
    queryKey: [api.products.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.products.get.path, { id });
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch product");
      return api.products.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

// Only for admin or seed functionality usually, but included for completeness
export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertProduct) => {
      const res = await fetch(api.products.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create product");
      return api.products.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
    },
  });
}
