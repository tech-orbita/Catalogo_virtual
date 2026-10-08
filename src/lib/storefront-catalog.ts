import type { CategoryWithChildren, ProductWithRelations } from "@/lib/types";

interface CatalogProductSortItem {
  id: string;
  name: string;
}

const HIDDEN_STOREFRONT_CATEGORY_SLUGS = new Set(["puntos-organic"]);
const COLOR_GEL_SLUG = "color-gel";
const COLOR_GEL_COLLECTION_PATTERN = /\b(?:pastel\s+show|xpectrum|espectro)\b/i;

const catalogNameCollator = new Intl.Collator("es-CO", {
  ignorePunctuation: true,
  numeric: true,
  sensitivity: "base",
});

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO")
    .trim();
}

export function filterStorefrontProducts(
  products: ProductWithRelations[],
  search: string
): ProductWithRelations[] {
  const searchTerms = normalizeSearchValue(search).split(/\s+/).filter(Boolean);
  if (searchTerms.length === 0) return products;

  return products.filter((product) => {
    const searchableText = normalizeSearchValue(
      [
        product.name,
        product.sku,
        product.description,
        ...product.variants.flatMap((variant) => [
          variant.variant_name,
          variant.option_value,
          variant.sku,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
    );

    return searchTerms.every((term) => searchableText.includes(term));
  });
}

export function getVisibleStorefrontCategories(
  categories: CategoryWithChildren[]
): CategoryWithChildren[] {
  return categories.filter(
    (category) => !HIDDEN_STOREFRONT_CATEGORY_SLUGS.has(category.slug)
  );
}

export function isColorGelCategory(
  categories: CategoryWithChildren[],
  categorySlug?: string
): boolean {
  if (!categorySlug) return false;

  const colorGel = categories.find((category) => category.slug === COLOR_GEL_SLUG);
  return (
    colorGel?.slug === categorySlug ||
    colorGel?.children.some((subcategory) => subcategory.slug === categorySlug) === true
  );
}

function compareByName(
  a: CatalogProductSortItem,
  b: CatalogProductSortItem
): number {
  return catalogNameCollator.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

function getColorGelReferenceNumber(name: string): number | null {
  const match = name.match(
    /^\s*(?:color\s+gel\s+org(?:anic)?\s+)?(\d+)(?=\s|$)/i
  );
  return match ? Number.parseInt(match[1], 10) : null;
}

function isColorGelCollection(name: string): boolean {
  return COLOR_GEL_COLLECTION_PATTERN.test(name);
}

function compareColorGelProducts(
  a: CatalogProductSortItem,
  b: CatalogProductSortItem
): number {
  const aNumber = getColorGelReferenceNumber(a.name);
  const bNumber = getColorGelReferenceNumber(b.name);
  const aGroup = aNumber !== null ? 0 : isColorGelCollection(a.name) ? 2 : 1;
  const bGroup = bNumber !== null ? 0 : isColorGelCollection(b.name) ? 2 : 1;

  if (aGroup !== bGroup) return aGroup - bGroup;
  if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
    return aNumber - bNumber;
  }

  return compareByName(a, b);
}

export function sortCatalogProducts<T extends CatalogProductSortItem>(
  products: T[],
  options?: { colorGel?: boolean }
): T[] {
  return [...products].sort(options?.colorGel ? compareColorGelProducts : compareByName);
}
