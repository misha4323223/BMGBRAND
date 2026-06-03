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

export interface ProductFilters {
  minPrice?: number;
  maxPrice?: number;
  size?: string;
  sort?: string;
  artistSlug?: string;
}

export function usePaginatedProducts(
  limit: number = 24, 
  category?: string, 
  subcategory?: string,
  sale?: boolean,
  search?: string,
  filters?: ProductFilters
) {
  const queryParams = new URLSearchParams();
  if (category) queryParams.set("category", category);
  if (subcategory) queryParams.set("subcategory", subcategory);
  if (sale && !category) queryParams.set("sale", "true");
  if (search) queryParams.set("search", search);
  if (filters?.minPrice !== undefined) queryParams.set("minPrice", String(filters.minPrice));
  if (filters?.maxPrice !== undefined) queryParams.set("maxPrice", String(filters.maxPrice));
  if (filters?.size) queryParams.set("size", filters.size);
  if (filters?.sort) queryParams.set("sort", filters.sort);
  if (filters?.artistSlug) queryParams.set("artistSlug", filters.artistSlug);
  const filterKey = queryParams.toString();
  
  return useInfiniteQuery({
    queryKey: [api.products.list.path, 'paginated', limit, filterKey],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      params.set("page", String(pageParam));
      params.set("limit", String(limit));
      if (category) params.set("category", category);
      if (subcategory) params.set("subcategory", subcategory);
      if (sale && !category) params.set("sale", "true");
      if (search) params.set("search", search);
      if (filters?.minPrice !== undefined) params.set("minPrice", String(filters.minPrice));
      if (filters?.maxPrice !== undefined) params.set("maxPrice", String(filters.maxPrice));
      if (filters?.size) params.set("size", filters.size);
      if (filters?.sort) params.set("sort", filters.sort);
      if (filters?.artistSlug) params.set("artistSlug", filters.artistSlug);
      
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

export function useProductBySlug(slug: string) {
  return useQuery({
    queryKey: ['/api/products/by-slug', slug],
    queryFn: async () => {
      // If slug is purely numeric (it's a product ID) — skip the expensive by-slug YDB scan
      if (/^\d+$/.test(slug)) {
        const fallback = await fetch(`/api/products/${slug}`);
        if (fallback.ok) return fallback.json() as Promise<Product>;
        return null;
      }
      const res = await fetch(`/api/products/by-slug/${slug}`);
      if (res.ok) return res.json() as Promise<Product>;
      return null;
    },
    enabled: !!slug,
  });
}

export function usePrefetchProduct() {
  const queryClient = useQueryClient();
  
  return (id: number) => {
    queryClient.prefetchQuery({
      queryKey: [api.products.get.path, id],
      queryFn: async () => {
        const url = buildUrl(api.products.get.path, { id });
        const res = await fetch(url);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("Failed to fetch product");
        return api.products.get.responses[200].parse(await res.json());
      },
      staleTime: 1000 * 60 * 5,
    });
  };
}

// Get color variants for a product (same SKU, different colors)
export interface ColorVariant {
  id: number;
  slug: string;
  color: string;
  name: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  price: number;
  stock: number;
  sizeRange: string | null;
}

export function useColorVariants(productId: number, enabled: boolean = true) {
  return useQuery({
    queryKey: ['/api/products', productId, 'variants'],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/variants`);
      if (!res.ok) throw new Error("Failed to fetch variants");
      return res.json() as Promise<ColorVariant[]>;
    },
    enabled: !!productId && enabled,
    staleTime: 5 * 60 * 1000,
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
