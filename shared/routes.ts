import { z } from 'zod';
import { insertProductSchema, insertCartItemSchema, insertOrderSchema, products, cartItems, orders } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  products: {
    list: {
      method: 'GET' as const,
      path: '/api/products',
      responses: {
        200: z.array(z.custom<typeof products.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/products/:id',
      responses: {
        200: z.custom<typeof products.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    // Admin routes for later, simple for now
    create: {
      method: 'POST' as const,
      path: '/api/products',
      input: insertProductSchema,
      responses: {
        201: z.custom<typeof products.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
  cart: {
    list: {
      method: 'GET' as const,
      path: '/api/cart/:sessionId',
      responses: {
        200: z.array(z.custom<typeof cartItems.$inferSelect & { product: typeof products.$inferSelect }>()),
      },
    },
    addItem: {
      method: 'POST' as const,
      path: '/api/cart',
      input: insertCartItemSchema,
      responses: {
        200: z.custom<typeof cartItems.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    updateQuantity: {
      method: 'PATCH' as const,
      path: '/api/cart/:id/quantity',
      input: z.object({ quantity: z.number().int().min(1) }),
      responses: {
        200: z.custom<typeof cartItems.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    removeItem: {
      method: 'DELETE' as const,
      path: '/api/cart/:id',
      responses: {
        200: z.void(),
        404: errorSchemas.notFound,
      },
    },
    clear: {
      method: 'DELETE' as const,
      path: '/api/cart/session/:sessionId',
      responses: {
        200: z.void(),
      },
    },
  },
  orders: {
    create: {
      method: 'POST' as const,
      path: '/api/orders',
      input: insertOrderSchema.extend({
        sessionId: z.string(),
      }),
      responses: {
        201: z.custom<typeof orders.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
