"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uploadImageAsset } from "@/lib/media";
import { requireCatalogAdmin } from "@/lib/auth/server-access";

export async function updateStoreSettings(input: {
  storeName: string;
  description: string | null;
  whatsappNumber: string | null;
}) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .update({
      store_name: input.storeName,
      description: input.description,
      whatsapp_number: input.whatsappNumber,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) return { error: error.message };
  revalidatePath("/admin/home");
  revalidatePath("/admin/configuraciones");
  revalidatePath("/");
  return { success: true };
}

async function uploadStoreAsset(field: "logo_url" | "banner_url", formData: FormData) {
  await requireCatalogAdmin();
  const file = formData.get("file") as File | null;
  if (!file) return { error: "No se recibió el archivo." };

  const entityType = field === "logo_url" ? "store_logo" : "store_banner";
  const result = await uploadImageAsset("store", file, entityType, null);
  if ("error" in result) return result;

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("store_settings")
    .update({ [field]: result.url, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (updateError) return { error: updateError.message };

  revalidatePath("/admin/home");
  revalidatePath("/");
  return { success: true, url: result.url };
}

export async function uploadStoreLogo(formData: FormData) {
  return uploadStoreAsset("logo_url", formData);
}

export async function uploadStoreBanner(formData: FormData) {
  return uploadStoreAsset("banner_url", formData);
}
