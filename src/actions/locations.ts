"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCatalogAdmin } from "@/lib/auth/server-access";

export interface StoreLocationInput {
  name: string;
  address: string;
  city: string;
  department: string;
  whatsappNumber: string;
  active: boolean;
}

function validateLocation(input: StoreLocationInput) {
  const whatsappNumber = input.whatsappNumber.replace(/\D/g, "");
  if (!input.name.trim()) return { error: "El nombre de la sede es obligatorio." };
  if (!input.address.trim()) return { error: "La dirección de la sede es obligatoria." };
  if (whatsappNumber.length < 10 || whatsappNumber.length > 15) {
    return { error: "Escribe el WhatsApp en formato internacional, entre 10 y 15 dígitos." };
  }

  return {
    value: {
      name: input.name.trim(),
      address: input.address.trim(),
      city: input.city.trim() || null,
      department: input.department.trim() || null,
      whatsapp_number: whatsappNumber,
      active: input.active,
      updated_at: new Date().toISOString(),
    },
  };
}

function revalidateLocationViews() {
  revalidatePath("/admin/sedes");
  revalidatePath("/checkout");
}

export async function createStoreLocation(input: StoreLocationInput) {
  await requireCatalogAdmin();
  const parsed = validateLocation(input);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();
  const { count } = await supabase
    .from("store_locations")
    .select("id", { count: "exact", head: true });
  const { error } = await supabase.from("store_locations").insert({
    ...parsed.value,
    sort_order: count ?? 0,
  });

  if (error) return { error: error.message };
  revalidateLocationViews();
  return { success: true };
}

export async function updateStoreLocation(id: string, input: StoreLocationInput) {
  await requireCatalogAdmin();
  const parsed = validateLocation(input);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();
  const { error } = await supabase.from("store_locations").update(parsed.value).eq("id", id);
  if (error) return { error: error.message };
  revalidateLocationViews();
  return { success: true };
}

export async function setStoreLocationActive(id: string, active: boolean) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_locations")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateLocationViews();
  return { success: true };
}

export async function deleteStoreLocation(id: string) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("store_locations").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateLocationViews();
  return { success: true };
}
