import { createClient } from "@/lib/supabase/server";
import { getDashboardRole } from "./access";

export async function requireCatalogAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (getDashboardRole(user) !== "admin") {
    throw new Error("No autorizado.");
  }

  return { supabase, user };
}
