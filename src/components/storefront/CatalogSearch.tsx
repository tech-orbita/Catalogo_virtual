"use client";

import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Search, X } from "lucide-react";
import { ProductGrid } from "./ProductGrid";
import { filterStorefrontProducts } from "@/lib/storefront-catalog";
import type { ProductWithRelations } from "@/lib/types";

export function CatalogSearch({
  products,
  initialQuery,
  activeCategory,
  children,
}: {
  products: ProductWithRelations[];
  initialQuery: string;
  activeCategory: string;
  children: ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = deferredQuery.trim();
  const filteredProducts = useMemo(
    () => filterStorefrontProducts(products, normalizedQuery),
    [products, normalizedQuery]
  );

  function updateUrl(nextQuery: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("categoria", activeCategory);

    const trimmedQuery = nextQuery.trim();
    if (trimmedQuery) {
      url.searchParams.set("buscar", trimmedQuery);
    } else {
      url.searchParams.delete("buscar");
    }

    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }

  function handleQueryChange(nextQuery: string) {
    const limitedQuery = nextQuery.slice(0, 80);
    setQuery(limitedQuery);
    updateUrl(limitedQuery);
  }

  function clearQuery() {
    handleQueryChange("");
    inputRef.current?.focus();
  }

  return (
    <>
      <form
        role="search"
        className="mx-auto max-w-2xl"
        onSubmit={(event) => event.preventDefault()}
      >
        <label htmlFor="catalog-search" className="sr-only">
          Buscar productos
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand"
          />
          <input
            ref={inputRef}
            id="catalog-search"
            name="buscar"
            type="text"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            maxLength={80}
            autoComplete="off"
            placeholder="Buscar productos..."
            className="h-12 w-full rounded-full border border-brand/20 bg-white pl-12 pr-14 text-sm text-slate-700 shadow-[0_8px_28px_rgba(214,51,108,.10)] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-light sm:h-14 sm:text-base"
          />
          {query ? (
            <button
              type="button"
              onClick={clearQuery}
              aria-label="Limpiar búsqueda"
              title="Limpiar búsqueda"
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-brand-light hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </form>

      <div className="mt-7">{children}</div>

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
              {normalizedQuery
                ? `Resultados para “${normalizedQuery}”`
                : "Productos para ti"}
            </h2>
          </div>
          <span
            aria-live="polite"
            className="text-xs font-medium text-slate-500"
          >
            {filteredProducts.length}{" "}
            {filteredProducts.length === 1 ? "producto" : "productos"}
          </span>
        </div>

        {normalizedQuery && filteredProducts.length === 0 ? (
          <div className="rounded-3xl border border-brand/15 bg-white px-5 py-14 text-center shadow-sm">
            <Search aria-hidden="true" className="mx-auto h-8 w-8 text-brand/55" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              No encontramos productos con “{normalizedQuery}”.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Prueba con otro nombre o menos palabras.
            </p>
          </div>
        ) : (
          <ProductGrid products={filteredProducts} />
        )}
      </section>
    </>
  );
}
