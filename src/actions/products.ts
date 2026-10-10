"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slugify";
import { parseProductsWorkbook } from "@/lib/products-import";
import { uploadImageAsset, uploadImageBytesAsset, deleteImageAsset } from "@/lib/media";
import { normalizeCatalogName } from "@/lib/catalog-name";
import { requireCatalogAdmin } from "@/lib/auth/server-access";

export interface ProductFormInput {
  name: string;
  sku: string | null;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  active: boolean;
  categoryIds: string[];
}

async function uniqueProductSlug(base: string, excludeId?: string): Promise<string> {
  const supabase = await createClient();
  let slug = slugify(base) || "producto";
  let attempt = 0;

  while (true) {
    const query = supabase.from("products").select("id").eq("slug", slug);
    const { data } = excludeId ? await query.neq("id", excludeId) : await query;
    if (!data || data.length === 0) return slug;
    attempt += 1;
    slug = `${slugify(base)}-${attempt + 1}`;
  }
}

async function setProductCategories(productId: string, categoryIds: string[]) {
  const supabase = await createClient();
  await supabase.from("product_categories").delete().eq("product_id", productId);
  if (categoryIds.length > 0) {
    await supabase
      .from("product_categories")
      .insert(categoryIds.map((category_id) => ({ product_id: productId, category_id })));
  }
}

export async function createProduct(input: ProductFormInput) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const name = normalizeCatalogName(input.name);
  const slug = await uniqueProductSlug(name);

  const { data, error } = await supabase
    .from("products")
    .insert({
      name,
      slug,
      sku: input.sku,
      description: input.description,
      price: input.price,
      compare_at_price: input.compareAtPrice,
      active: input.active,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "No se pudo crear el producto." };

  await setProductCategories(data.id, input.categoryIds);

  revalidatePath("/admin/productos");
  revalidatePath("/");
  return { success: true, id: data.id as string };
}

export async function updateProduct(id: string, input: ProductFormInput) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const name = normalizeCatalogName(input.name);
  const slug = await uniqueProductSlug(name, id);

  const { error } = await supabase
    .from("products")
    .update({
      name,
      slug,
      sku: input.sku,
      description: input.description,
      price: input.price,
      compare_at_price: input.compareAtPrice,
      active: input.active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  await setProductCategories(id, input.categoryIds);

  revalidatePath("/admin/productos");
  revalidatePath("/");
  return { success: true };
}

export async function createDraftProduct() {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const slug = await uniqueProductSlug("nuevo-producto");
  const { data, error } = await supabase
    .from("products")
    .insert({ name: "Nuevo producto", slug, price: 0, active: false })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo crear el producto." };
  revalidatePath("/admin/productos");
  return { success: true, id: data.id as string };
}

export async function deleteProduct(id: string) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/productos");
  revalidatePath("/");
  return { success: true };
}

export async function bulkSetActive(ids: string[], active: boolean) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ active }).in("id", ids);
  if (error) return { error: error.message };
  revalidatePath("/admin/productos");
  revalidatePath("/");
  return { success: true };
}

export async function bulkDeleteProducts(ids: string[]) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().in("id", ids);
  if (error) return { error: error.message };
  revalidatePath("/admin/productos");
  revalidatePath("/");
  return { success: true };
}

// ---- Variantes ----
export async function addVariant(
  productId: string,
  input: { variantName: string; optionValue: string; priceOverride: number | null; sku: string | null }
) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").insert({
    product_id: productId,
    variant_name: input.variantName,
    option_value: input.optionValue,
    price_override: input.priceOverride,
    sku: input.sku,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/");
  return { success: true };
}

export async function updateVariant(
  variantId: string,
  productId: string,
  input: { variantName: string; optionValue: string; priceOverride: number | null; sku: string | null }
) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({
      variant_name: input.variantName,
      option_value: input.optionValue,
      price_override: input.priceOverride,
      sku: input.sku,
    })
    .eq("id", variantId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/");
  return { success: true };
}

export async function deleteVariant(variantId: string, productId: string) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").delete().eq("id", variantId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/");
  return { success: true };
}

// ---- Imágenes (Cloudflare R2) ----
export async function uploadProductImage(productId: string, formData: FormData) {
  await requireCatalogAdmin();
  const file = formData.get("file") as File | null;
  if (!file) return { error: "No se recibió el archivo." };

  const result = await uploadImageAsset("products", file, "product", productId);
  if ("error" in result) return result;

  const supabase = await createClient();
  const { count } = await supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  const { error: insertError } = await supabase.from("product_images").insert({
    product_id: productId,
    url: result.url,
    sort_order: count ?? 0,
  });

  if (insertError) return { error: insertError.message };

  revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/");
  return { success: true, url: result.url };
}

export async function deleteProductImage(imageId: string, productId: string) {
  await requireCatalogAdmin();
  const supabase = await createClient();
  const { data: image } = await supabase
    .from("product_images")
    .select("url")
    .eq("id", imageId)
    .maybeSingle();

  const { error } = await supabase.from("product_images").delete().eq("id", imageId);
  if (error) return { error: error.message };
  if (image?.url) await deleteImageAsset(image.url);

  revalidatePath(`/admin/productos/${productId}`);
  revalidatePath("/");
  return { success: true };
}

// ---- Importar desde Excel ----
export interface ImportSummary {
  productsCreated: number;
  productsUpdated: number;
  categoriesCreated: number;
  errors: string[];
}

async function findOrCreateCategoryPath(
  path: string[],
  cache: Map<string, string>
): Promise<{ id: string; created: boolean }> {
  const supabase = await createClient();
  let parentId: string | null = null;
  let created = false;
  let categoryId = "";

  let cacheKeyPrefix = "";
  for (const levelName of path) {
    const normalizedLevelName = normalizeCatalogName(levelName);
    cacheKeyPrefix += `>${normalizedLevelName.toLocaleLowerCase("es-CO")}`;
    const cached = cache.get(cacheKeyPrefix);
    if (cached) {
      categoryId = cached;
      parentId = cached;
      continue;
    }

    const query = supabase.from("categories").select("id").ilike("name", normalizedLevelName);
    const { data: existingRows } = parentId
      ? await query.eq("parent_id", parentId)
      : await query.is("parent_id", null);

    let id = existingRows?.[0]?.id as string | undefined;

    if (!id) {
      const { count } = await supabase
        .from("categories")
        .select("id", { count: "exact", head: true })
        .is("parent_id", parentId);

      let slug = slugify(normalizedLevelName) || "categoria";
      const { data: slugClash } = await supabase.from("categories").select("id").eq("slug", slug);
      if (slugClash && slugClash.length > 0) slug = `${slug}-${Date.now().toString(36)}`;

      const { data: inserted, error } = await supabase
        .from("categories")
        .insert({ name: normalizedLevelName, slug, parent_id: parentId, sort_order: count ?? 0 })
        .select("id")
        .single();

      if (error || !inserted) throw new Error(error?.message ?? "No se pudo crear la categoría");
      id = inserted.id as string;
      created = true;
    }

    cache.set(cacheKeyPrefix, id);
    categoryId = id;
    parentId = id;
  }

  return { id: categoryId, created };
}

export async function importProductsFromXlsx(formData: FormData): Promise<ImportSummary> {
  await requireCatalogAdmin();
  const file = formData.get("file") as File | null;
  const summary: ImportSummary = {
    productsCreated: 0,
    productsUpdated: 0,
    categoriesCreated: 0,
    errors: [],
  };
  if (!file) {
    summary.errors.push("No se recibió el archivo.");
    return summary;
  }

  const buffer = await file.arrayBuffer();
  const parsed = parseProductsWorkbook(buffer);
  const supabase = await createClient();
  const categoryCache = new Map<string, string>();

  for (const item of parsed) {
    try {
      const productName = normalizeCatalogName(item.name);
      const categoryIds: string[] = [];
      for (const path of item.categoryPaths) {
        const result = await findOrCreateCategoryPath(path, categoryCache);
        categoryIds.push(result.id);
        if (result.created) summary.categoriesCreated += 1;
      }

      let existingId: string | null = null;
      if (item.sku) {
        const { data } = await supabase
          .from("products")
          .select("id")
          .eq("sku", item.sku)
          .maybeSingle();
        existingId = data?.id ?? null;
      }
      if (!existingId) {
        const candidateSlug = slugify(productName);
        const { data } = await supabase
          .from("products")
          .select("id")
          .eq("slug", candidateSlug)
          .maybeSingle();
        existingId = data?.id ?? null;
      }

      const hasVariants = item.variants.length > 0;

      if (existingId) {
        await supabase
          .from("products")
          .update({
            name: productName,
            sku: item.sku,
            description: item.description,
            price: item.price,
            compare_at_price: item.compareAtPrice,
            active: item.active,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingId);

        await setProductCategories(existingId, categoryIds);
        await supabase.from("product_variants").delete().eq("product_id", existingId);

        if (hasVariants) {
          await supabase.from("product_variants").insert(
            item.variants.map((v, idx) => ({
              product_id: existingId,
              variant_name: v.variantName,
              option_value: v.optionValue,
              price_override: v.priceOverride,
              sku: v.sku,
              sort_order: idx,
            }))
          );
        }
        summary.productsUpdated += 1;
      } else {
        const slug = await uniqueProductSlug(productName);
        const { data: inserted, error } = await supabase
          .from("products")
          .insert({
            name: productName,
            slug,
            sku: item.sku,
            description: item.description,
            price: item.price,
            compare_at_price: item.compareAtPrice,
            active: item.active,
          })
          .select("id")
          .single();

        if (error || !inserted) throw new Error(error?.message ?? "No se pudo crear el producto");

        await setProductCategories(inserted.id, categoryIds);

        if (hasVariants) {
          await supabase.from("product_variants").insert(
            item.variants.map((v, idx) => ({
              product_id: inserted.id,
              variant_name: v.variantName,
              option_value: v.optionValue,
              price_override: v.priceOverride,
              sku: v.sku,
              sort_order: idx,
            }))
          );
        }
        summary.productsCreated += 1;
      }
    } catch (err) {
      summary.errors.push(`${item.name}: ${(err as Error).message}`);
    }
  }

  revalidatePath("/admin/productos");
  revalidatePath("/admin/categorias");
  revalidatePath("/");
  return summary;
}

// ---- Subida de imágenes por lote (.zip, una carpeta por SKU) ----
export interface BulkImageSummary {
  imagesUploaded: number;
  productsMatched: number;
  skusNotFound: string[];
  errors: string[];
}

export async function importImagesZip(formData: FormData): Promise<BulkImageSummary> {
  await requireCatalogAdmin();
  const JSZip = (await import("jszip")).default;
  const file = formData.get("file") as File | null;
  const summary: BulkImageSummary = {
    imagesUploaded: 0,
    productsMatched: 0,
    skusNotFound: [],
    errors: [],
  };
  if (!file) {
    summary.errors.push("No se recibió el archivo.");
    return summary;
  }

  const supabase = await createClient();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const bySku = new Map<string, { path: string; data: Uint8Array; name: string }[]>();

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const sku = parts[0].trim();
    const filename = parts[parts.length - 1];
    if (!/\.(jpe?g|png|webp|gif)$/i.test(filename)) continue;
    const data = await entry.async("uint8array");
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku)!.push({ path, data, name: filename });
  }

  for (const [sku, files] of bySku.entries()) {
    const { data: product } = await supabase
      .from("products")
      .select("id")
      .eq("sku", sku)
      .maybeSingle();

    if (!product) {
      summary.skusNotFound.push(sku);
      continue;
    }
    summary.productsMatched += 1;

    const { count } = await supabase
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .eq("product_id", product.id);
    let nextOrder = count ?? 0;

    for (const f of files) {
      try {
        const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
        const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        const result = await uploadImageBytesAsset(
          "products",
          f.name,
          contentType,
          f.data,
          "product",
          product.id
        );
        if ("error" in result) throw new Error(result.error);

        await supabase.from("product_images").insert({
          product_id: product.id,
          url: result.url,
          sort_order: nextOrder++,
        });
        summary.imagesUploaded += 1;
      } catch (err) {
        summary.errors.push(`${sku}/${f.name}: ${(err as Error).message}`);
      }
    }
  }

  revalidatePath("/admin/productos");
  revalidatePath("/");
  return summary;
}
