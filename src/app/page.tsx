import { getCategoryTree, getProducts, getStoreSettings } from "@/lib/data/queries";
import { Header } from "@/components/storefront/Header";
import { CategoryChips } from "@/components/storefront/CategoryChips";
import { ProductGrid } from "@/components/storefront/ProductGrid";
import { Search, X } from "lucide-react";
import {
  filterStorefrontProducts,
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
    filterStorefrontProducts(
      await getProducts({ categorySlug: categoryFilter }),
      searchQuery
    ),
    { colorGel: isColorGelCategory(categoryTree, requestedCategory) }
  );
  const clearSearchHref = categoria
    ? `/?categoria=${encodeURIComponent(categoria)}`
    : "/";

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
        <form action="/" role="search" className="mx-auto max-w-2xl">
          {categoria && <input type="hidden" name="categoria" value={categoria} />}
          <label htmlFor="catalog-search" className="sr-only">
            Buscar productos
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand"
            />
            <input
              id="catalog-search"
              name="buscar"
              type="search"
              defaultValue={searchQuery}
              maxLength={80}
              placeholder="Buscar productos..."
              className="h-12 w-full rounded-full border border-brand/20 bg-white pl-12 pr-28 text-sm text-slate-700 shadow-[0_8px_28px_rgba(214,51,108,.10)] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-light sm:h-14 sm:text-base"
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {searchQuery && (
                <a
                  href={clearSearchHref}
                  aria-label="Limpiar búsqueda"
                  title="Limpiar búsqueda"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-brand-light hover:text-brand"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </a>
              )}
              <button
                type="submit"
                className="h-9 rounded-full bg-brand px-4 text-xs font-bold text-white shadow-sm transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:px-5 sm:text-sm"
              >
                Buscar
              </button>
            </div>
          </div>
        </form>

        <div className="mt-7">
          <CategoryChips
            categories={topLevelCategories}
            activeSlug={requestedCategory}
            logoUrl={settings.logo_url}
          />
        </div>

        <section className="mt-6" aria-labelledby="products-heading">
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                Catálogo
              </p>
              <h2
                id="products-heading"
                className="mt-1 text-xl font-bold text-orbita-navy sm:text-2xl"
              >
                {searchQuery ? `Resultados para “${searchQuery}”` : "Productos para ti"}
              </h2>
            </div>
            <span className="text-xs font-medium text-slate-500">
              {products.length} {products.length === 1 ? "producto" : "productos"}
            </span>
          </div>
          {searchQuery && products.length === 0 ? (
            <div className="rounded-3xl border border-brand/15 bg-white px-5 py-14 text-center shadow-sm">
              <Search aria-hidden="true" className="mx-auto h-8 w-8 text-brand/55" />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                No encontramos productos con “{searchQuery}”.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Prueba con otro nombre o menos palabras.
              </p>
            </div>
          ) : (
            <ProductGrid products={products} />
          )}
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-7 text-center text-xs text-slate-500">
        {settings.store_name} · Catálogo impulsado por Órbita IA
      </footer>
    </div>
  );
}
