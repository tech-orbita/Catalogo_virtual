import { getCategoryTree, getProducts, getStoreSettings } from "@/lib/data/queries";
import { Header } from "@/components/storefront/Header";
import { CategoryChips } from "@/components/storefront/CategoryChips";
import { CatalogSearch } from "@/components/storefront/CatalogSearch";
import {
  getVisibleStorefrontCategories,
  isColorGelCategory,
  sortCatalogProducts,
} from "@/lib/storefront-catalog";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; buscar?: string }>;
}) {
  const { categoria, buscar } = await searchParams;
  const searchQuery = buscar?.trim().slice(0, 80) ?? "";
  const [settings, categoryTree] = await Promise.all([
    getStoreSettings(),
    getCategoryTree(),
  ]);
  const topLevelCategories = getVisibleStorefrontCategories(categoryTree);

  const requestedCategory =
    categoria ?? (searchQuery ? "todo" : topLevelCategories[0]?.slug);
  const categoryFilter = requestedCategory === "todo" ? undefined : requestedCategory;
  const products = sortCatalogProducts(
    await getProducts({ categorySlug: categoryFilter }),
    { colorGel: isColorGelCategory(categoryTree, requestedCategory) }
  );

  return (
    <div className="storefront-shell min-h-screen bg-storefront-canvas">
      <Header
        storeName={settings.store_name}
        logoUrl={settings.logo_url}
        bannerUrl={settings.banner_url}
        description={settings.description}
        whatsappNumber={settings.whatsapp_number}
      />

      <main className="mx-auto w-full max-w-7xl px-3 pb-32 pt-5 sm:px-5 sm:pt-7">
        <CatalogSearch
          key={`${requestedCategory ?? "todo"}:${searchQuery}`}
          products={products}
          initialQuery={searchQuery}
          activeCategory={requestedCategory ?? "todo"}
        >
          <CategoryChips
            categories={topLevelCategories}
            activeSlug={requestedCategory}
            logoUrl={settings.logo_url}
          />
        </CatalogSearch>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-7 text-center text-xs text-slate-500">
        {settings.store_name} · Catálogo impulsado por Órbita IA
      </footer>
    </div>
  );
}
