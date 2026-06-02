import { useMutation } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { InsertOrder } from "@shared/schema";
import { useSession } from "./use-session";

export function useCreateOrder() {
  const sessionId = useSession();
  
  return useMutation({
    mutationFn: async (data: Omit<InsertOrder, 'sessionId' | 'items' | 'total'>) => {
      if (!sessionId) throw new Error("No session");
      
      // We send the base data, backend calculates total from current cart state
      // Note: The schema in routes_manifest implies we send full object, 
      // but typically checkout uses session to get cart items. 
      // For this implementation, we will follow the schema strictly 
      // but in a real app backend would finalize from session.
      
      // Since routes manifest expects sessionId in body:
      const payload = {
        ...data,
        sessionId,
      };

      const res = await fetch(api.orders.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        const error = await res.json();
        const err = new Error(error.message || "Failed to create order") as any;
        err.code = error.code;
        err.stockIssues = error.stockIssues;
        throw err;
      }
      return api.orders.create.responses[201].parse(await res.json());
    },
  });
}
