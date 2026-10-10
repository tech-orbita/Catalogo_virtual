import type { User } from "@supabase/supabase-js";

export type DashboardRole = "admin" | "operator";

export function getDashboardRole(user: User | null): DashboardRole | null {
  const role = user?.app_metadata?.role;
  return role === "admin" || role === "operator" ? role : null;
}

export function canAccessOrders(role: DashboardRole | null): role is DashboardRole {
  return role === "admin" || role === "operator";
}

export function canManageCatalog(role: DashboardRole | null): role is "admin" {
  return role === "admin";
}
