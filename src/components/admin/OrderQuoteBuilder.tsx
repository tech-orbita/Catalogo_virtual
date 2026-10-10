"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronDown, MapPin, PackageCheck, Plus, Search, Send, Trash2, UserRound } from "lucide-react";
import clsx from "clsx";
import {
  triggerOrderQuoteWorkflow,
  type QuoteOrderItemInput,
} from "@/actions/orders";
import { useToast } from "@/components/ui/Toast";
import { formatCOP } from "@/lib/currency";
import type { OrderStatus, OrderWithItems } from "@/lib/types";

export interface QuoteCatalogOption {
  key: string;
  productId: string;
  variantId: string | null;
  label: string;
  unitPrice: number;
}

interface DraftQuoteLine {
  id: string;
  kind: "catalog" | "custom";
  optionKey: string;
  customName: string;
  quantity: string;
  unitPrice: string;
  available: boolean;
}

function createEmptyLine(index: number, kind: DraftQuoteLine["kind"] = "catalog"): DraftQuoteLine {
  return {
    id: `new-${Date.now()}-${index}`,
    kind,
    optionKey: "",
    customName: "",
    quantity: "1",
    unitPrice: "",
    available: true,
  };
}

function createInitialLines(order: OrderWithItems): DraftQuoteLine[] {
  if (order.quote_items?.length) {
    return order.quote_items.map((item, index) => ({
      id: `quote-${index}-${item.product_id}-${item.variant_id ?? "base"}`,
      kind: item.product_id ? "catalog" as const : "custom" as const,
      optionKey: item.product_id ? `${item.product_id}:${item.variant_id ?? ""}` : "",
      customName: item.product_id ? "" : item.product_name,
      quantity: String(item.quantity),
      unitPrice: String(item.unit_price),
      available: item.available,
    }));
  }

  return order.items.map((item) => ({
    id: item.id,
    kind: item.product_id ? "catalog" as const : "custom" as const,
    optionKey: item.product_id ? `${item.product_id}:${item.variant_id ?? ""}` : "",
    customName: item.product_id ? "" : item.product_name_snapshot,
    quantity: String(item.quantity),
    unitPrice: String(item.unit_price),
    available: true,
  }));
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO")
    .trim();
}

function SearchableProductSelect({
  lineId,
  labelId,
  optionKey,
  options,
  disabled,
  onSelect,
}: {
  lineId: string;
  labelId: string;
  optionKey: string;
  options: QuoteCatalogOption[];
  disabled: boolean;
  onSelect: (optionKey: string) => void;
}) {
  const selected = options.find((option) => option.key === optionKey);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = normalizeSearch(query);
  const matches = useMemo(() => {
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    return options
      .filter((option) => {
        if (tokens.length === 0) return true;
        const searchableLabel = normalizeSearch(option.label);
        return tokens.every((token) => searchableLabel.includes(token));
      })
      .slice(0, 12);
  }, [normalizedQuery, options]);
  const listboxId = `quote-product-options-${lineId}`;

  function choose(option: QuoteCatalogOption) {
    setQuery(option.label);
    onSelect(option.key);
    setOpen(false);
    setActiveIndex(0);
  }

  return (
    <div className="relative mt-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-labelledby={labelId}
          autoComplete="off"
          placeholder="Escribe el nombre completo"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            if (selected && nextQuery !== selected.label) onSelect("");
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (!open && event.key === "ArrowDown") {
              setOpen(true);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (matches.length > 0) {
                setActiveIndex((current) => Math.min(current + 1, matches.length - 1));
              }
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" && open && matches[activeIndex]) {
              event.preventDefault();
              choose(matches[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          disabled={disabled}
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 outline-none focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10 disabled:bg-slate-100"
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
      </div>
      {open && !disabled ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          {matches.length > 0 ? (
            matches.map((option, index) => (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={option.key === optionKey}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
                className={clsx(
                  "block w-full rounded-lg px-3 py-2.5 text-left text-sm transition focus:outline-none",
                  index === activeIndex ? "bg-orbita-cyan-soft text-orbita-navy" : "text-slate-700"
                )}
              >
                {option.label}
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-slate-500">No encontramos productos con ese nombre.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function OrderQuoteBuilder({
  order,
  catalogOptions,
  canSend,
  onSent,
}: {
  order: OrderWithItems;
  catalogOptions: QuoteCatalogOption[];
  canSend: boolean;
  onSent: (status: OrderStatus) => void;
}) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [lines, setLines] = useState<DraftQuoteLine[]>(() => createInitialLines(order));
  const [quoteNote, setQuoteNote] = useState(
    () => order.quote_items?.find((item) => item.quote_note)?.quote_note ?? ""
  );
  const initialDeliveryFee =
    order.quote_delivery_fee ?? Math.max(Number(order.total) - Number(order.subtotal), 0);
  const [deliveryFee, setDeliveryFee] = useState(String(initialDeliveryFee));
  const [feedback, setFeedback] = useState<{
    kind: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const optionByKey = useMemo(
    () => new Map(catalogOptions.map((option) => [option.key, option])),
    [catalogOptions]
  );
  const totals = useMemo(() => {
    let availableSubtotal = 0;
    let unavailableCount = 0;

    for (const line of lines) {
      if (!line.available) {
        unavailableCount += 1;
        continue;
      }
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      if (Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
        availableSubtotal += quantity * unitPrice;
      }
    }

    const parsedDeliveryFee = order.delivery_method === "domicilio" ? Number(deliveryFee) || 0 : 0;
    return {
      availableSubtotal,
      unavailableCount,
      total: availableSubtotal + parsedDeliveryFee,
    };
  }, [deliveryFee, lines, order.delivery_method]);

  function updateLine(id: string, patch: Partial<DraftQuoteLine>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function selectProduct(lineId: string, optionKey: string) {
    const option = optionByKey.get(optionKey);
    updateLine(lineId, {
      optionKey,
      unitPrice: option ? String(option.unitPrice) : "",
    });
  }

  function removeLine(id: string) {
    setLines((current) => current.filter((line) => line.id !== id));
  }

  function addLine(kind: DraftQuoteLine["kind"]) {
    setLines((current) => [...current, createEmptyLine(current.length, kind)]);
  }

  function buildItems(): QuoteOrderItemInput[] | null {
    if (lines.length === 0) {
      setFeedback({ kind: "error", message: "Agrega al menos un producto a la cotización." });
      return null;
    }

    const items: QuoteOrderItemInput[] = [];
    for (const line of lines) {
      const option = optionByKey.get(line.optionKey);
      const productName = line.kind === "custom" ? line.customName.trim() : option?.label;
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      if (line.kind === "catalog" && !option) {
        setFeedback({ kind: "error", message: "Selecciona un producto válido en cada línea." });
        return null;
      }
      if (line.kind === "custom" && !productName) {
        setFeedback({ kind: "error", message: "Escribe el nombre de cada producto personalizado." });
        return null;
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
        setFeedback({ kind: "error", message: `Revisa la cantidad de ${productName}.` });
        return null;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        setFeedback({ kind: "error", message: `Revisa el precio de ${productName}.` });
        return null;
      }
      items.push({
        productId: option?.productId ?? null,
        variantId: option?.variantId ?? null,
        customName: line.kind === "custom" ? line.customName : undefined,
        quantity,
        unitPrice,
        available: line.available,
      });
    }
    return items;
  }

  function handleSend() {
    const items = buildItems();
    if (!items) return;

    const parsedDeliveryFee = order.delivery_method === "domicilio" ? Number(deliveryFee) : 0;
    if (!Number.isFinite(parsedDeliveryFee) || parsedDeliveryFee < 0) {
      setFeedback({ kind: "error", message: "Ingresa un costo de domicilio válido." });
      return;
    }

    setFeedback(null);
    const toastId = toast.loading("Preparando cotización...");
    startTransition(async () => {
      const result = await triggerOrderQuoteWorkflow(order.id, {
        items,
        deliveryFee: parsedDeliveryFee,
        quoteNote,
      });

      if ("error" in result) {
        setFeedback({ kind: "error", message: result.error });
        toast.update(toastId, {
          variant: "error",
          title: "No se pudo enviar la cotización",
          description: result.error,
        });
        return;
      }

      const nextStatus = result.status ?? "cotizacion_enviada";
      const successMessage =
        nextStatus === "no_hubo_producto"
          ? "Se informó que los productos no están disponibles."
          : "Cotización enviada correctamente.";
      setFeedback({
        kind: result.warning ? "warning" : "success",
        message: result.warning ?? successMessage,
      });
      toast.update(toastId, {
        variant: result.warning ? "warning" : "success",
        title: result.warning ? "Cotización enviada con una novedad" : successMessage,
        description: result.warning,
      });
      onSent(nextStatus);
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-orbita-cyan/30 bg-white">
      <div className="border-b border-orbita-cyan/20 bg-orbita-cyan-soft/55 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-orbita-cyan-dark shadow-sm">
            <PackageCheck size={19} />
          </div>
          <div>
            <h2 className="font-semibold text-orbita-navy">Preparar cotización</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Ajusta productos, disponibilidad, cantidades, precios y costo de entrega antes de enviarla.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <article className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <UserRound size={16} />
              Cliente
            </div>
            <p className="text-sm font-medium text-slate-900">{order.customer_name}</p>
            <p className="mt-1 text-sm text-slate-600">{order.customer_phone}</p>
            <p className="text-sm text-slate-600">Cédula: {order.customer_cedula}</p>
            {order.customer_email ? <p className="text-sm text-slate-600">{order.customer_email}</p> : null}
          </article>

          <article className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <MapPin size={16} />
              Entrega
            </div>
            <p className="text-sm font-medium text-slate-900">
              {order.delivery_method === "domicilio" ? "Domicilio" : "Recoger en tienda"}
            </p>
            {order.location_name_snapshot ? (
              <p className="mt-1 text-sm text-slate-600">Sede: {order.location_name_snapshot}</p>
            ) : null}
            {order.address ? <p className="text-sm text-slate-600">{order.address}</p> : null}
            {order.neighborhood ? (
              <p className="text-sm text-slate-600">Barrio: {order.neighborhood}</p>
            ) : null}
            {order.address_details ? <p className="text-sm text-slate-600">{order.address_details}</p> : null}
            {order.city || order.department ? (
              <p className="text-sm text-slate-600">
                {[order.city, order.department].filter(Boolean).join(", ")}
              </p>
            ) : null}
          </article>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Productos</h3>
              <p className="mt-0.5 text-xs text-slate-500">Cada línea puede editarse o marcarse como no disponible.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addLine("catalog")}
                disabled={isPending || !canSend}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-orbita-cyan/40 bg-white px-3 py-2 text-sm font-semibold text-orbita-navy transition hover:bg-orbita-cyan-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={16} />
                Del catálogo
              </button>
              <button
                type="button"
                onClick={() => addLine("custom")}
                disabled={isPending || !canSend}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-orbita-navy px-3 py-2 text-sm font-semibold text-white transition hover:bg-orbita-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={16} />
                Producto personalizado
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => (
              <div
                key={line.id}
                className={clsx(
                  "rounded-xl border p-3 transition sm:p-4",
                  line.available ? "border-slate-200 bg-white" : "border-red-200 bg-red-50/60"
                )}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_100px_140px_auto] lg:items-end">
                  <div className="block text-xs font-medium text-slate-600">
                    <span id={`quote-product-label-${line.id}`}>
                      {line.kind === "custom" ? `Producto personalizado ${index + 1}` : `Producto ${index + 1}`}
                    </span>
                    {line.kind === "custom" ? (
                      <input
                        type="text"
                        aria-labelledby={`quote-product-label-${line.id}`}
                        maxLength={160}
                        placeholder="Nombre o descripción del producto"
                        value={line.customName}
                        onChange={(event) => updateLine(line.id, { customName: event.target.value })}
                        disabled={isPending || !canSend}
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10 disabled:bg-slate-100"
                      />
                    ) : (
                      <SearchableProductSelect
                        lineId={line.id}
                        labelId={`quote-product-label-${line.id}`}
                        optionKey={line.optionKey}
                        options={catalogOptions}
                        disabled={isPending || !canSend}
                        onSelect={(optionKey) => selectProduct(line.id, optionKey)}
                      />
                    )}
                  </div>

                  <label className="block text-xs font-medium text-slate-600">
                    Cantidad
                    <input
                      type="number"
                      min="1"
                      max="999"
                      step="1"
                      value={line.quantity}
                      onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                      disabled={isPending || !canSend}
                      className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10 disabled:bg-slate-100"
                    />
                  </label>

                  <label className="block text-xs font-medium text-slate-600">
                    Precio unitario
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={line.unitPrice}
                      onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}
                      disabled={isPending || !canSend}
                      className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10 disabled:bg-slate-100"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    disabled={isPending || !canSend}
                    aria-label={`Eliminar producto ${index + 1}`}
                    className="flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={!line.available}
                      onChange={(event) => updateLine(line.id, { available: !event.target.checked })}
                      disabled={isPending || !canSend}
                      className="h-4 w-4 rounded border-slate-300 accent-red-600"
                    />
                    No disponible
                  </label>
                  <span className={clsx("text-sm font-semibold", line.available ? "text-slate-700" : "text-red-700")}>
                    {line.available
                      ? formatCOP((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))
                      : "No suma al total"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <label className="block text-xs font-medium text-slate-600">
          Notas de la cotización
          <textarea
            rows={4}
            maxLength={1000}
            value={quoteNote}
            onChange={(event) => setQuoteNote(event.target.value)}
            disabled={isPending || !canSend}
            placeholder="Agrega condiciones, aclaraciones o información especial para el cliente."
            className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10 disabled:bg-slate-100"
          />
          <span className="mt-1 block text-right text-[11px] text-slate-400">{quoteNote.length}/1000</span>
        </label>

        <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-[minmax(0,1fr)_260px] md:items-end">
          <div>
            {order.delivery_method === "domicilio" ? (
              <label className="block max-w-xs text-xs font-medium text-slate-600">
                Costo del domicilio
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={deliveryFee}
                  onChange={(event) => setDeliveryFee(event.target.value)}
                  disabled={isPending || !canSend}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10 disabled:bg-slate-100"
                />
              </label>
            ) : (
              <p className="text-sm text-slate-600">Recogida en tienda, sin costo de domicilio.</p>
            )}
            {totals.unavailableCount > 0 ? (
              <p className="mt-2 text-xs font-medium text-red-700">
                {totals.unavailableCount} {totals.unavailableCount === 1 ? "producto no disponible" : "productos no disponibles"}
              </p>
            ) : null}
          </div>

          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4 text-slate-600">
              <dt>Subtotal disponible</dt>
              <dd>{formatCOP(totals.availableSubtotal)}</dd>
            </div>
            {order.delivery_method === "domicilio" ? (
              <div className="flex justify-between gap-4 text-slate-600">
                <dt>Domicilio</dt>
                <dd>{formatCOP(Number(deliveryFee) || 0)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-base font-bold text-orbita-navy">
              <dt>Total</dt>
              <dd>{formatCOP(totals.total)}</dd>
            </div>
          </dl>
        </div>

        {feedback ? (
          <p
            role="status"
            className={clsx(
              "rounded-xl px-3 py-2.5 text-sm",
              feedback.kind === "success" && "bg-emerald-50 text-emerald-700",
              feedback.kind === "warning" && "bg-amber-50 text-amber-800",
              feedback.kind === "error" && "bg-red-50 text-red-700"
            )}
          >
            {feedback.message}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            {order.quote_sent_at ? (
              <p>
                Último envío: {new Date(order.quote_sent_at).toLocaleString("es-CO")}
                {order.quote_sent_by_email ? ` · ${order.quote_sent_by_email}` : ""}
              </p>
            ) : (
              <p>La cotización todavía no ha sido enviada.</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={isPending || !canSend || lines.length === 0}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orbita-navy px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orbita-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
            {isPending
              ? "Enviando..."
              : order.quote_sent_at
                ? "Reenviar cotización"
                : "Enviar cotización"}
          </button>
        </div>
        {!canSend ? (
          <p className="text-xs text-slate-500">
            Para editar y enviar otra cotización, devuelve el pedido a Pedido realizado.
          </p>
        ) : null}
      </div>
    </section>
  );
}
