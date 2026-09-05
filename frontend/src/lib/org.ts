import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  branchId: string;
  isDefault?: boolean;
}

export function useBranchOptions() {
  return useQuery({
    queryKey: ["branches", "options"],
    queryFn: () => api.get<{ items: Array<{ id: string; code: string; name: string }> }>("/api/branches"),
  });
}

export function useWarehouses() {
  const { user } = useAuth();
  const branchQ = useBranchOptions();
  const branchId = user?.branchId ?? branchQ.data?.items?.[0]?.id ?? null;
  const q = useQuery({
    queryKey: ["warehouses", branchId ?? "none"],
    queryFn: () => api.get<{ items: WarehouseRow[] }>(`/api/branches/${branchId}/warehouses`),
    enabled: Boolean(branchId),
  });
  return { ...q, branchId, branchOptions: branchQ.data?.items ?? [] };
}

export interface ProductOption {
  id: string;
  sku: string;
  name: string;
}

export function useProductOptions() {
  return useQuery({
    queryKey: ["products", "options"],
    queryFn: () => api.get<{ items: ProductOption[] }>("/api/products", { page: 1, pageSize: 500 }),
  });
}