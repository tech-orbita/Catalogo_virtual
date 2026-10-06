"use client";

import { useMemo, useState, useTransition } from "react";
import { MapPin, PackageCheck, Plus, Send, Trash2, UserRound } from "lucide-react";
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
  optionKey: string;
  quantity: string;
  unitPrice: string;
  available: boolean;
}

function createEmptyLine(index: number): DraftQuoteLine {
  return {
    id: `new-${Date.now()}-${index}`,
    optionKey: "",
    quantity: "1",
    unitPrice: "",
    available: true,
  };
}

function createInitialLines(order: OrderWithItems): DraftQuoteLine[] {
  if (order.quote_items?.length) {
    return order.quote_items.map((item, index) => ({
      id: `quote-${index}-${item.product_id}-${item.variant_id ?? "base"}`,
      optionKey: `${item.product_id}:${item.variant_id ?? ""}`,
      quantity: String(item.quantity),
      unitPrice: String(item.unit_price),
      available: item.available,
    }));
  }

  return order.items.map((item) => ({
    id: item.id,
    optionKey: item.product_id ? `${item.product_id}:${item.variant_id ?? ""}` : "",
    quantity: String(item.quantity),
    unitPrice: String(item.unit_price),
    available: true,
  }));
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

  function addLine() {
    setLines((current) => [...current, createEmptyLine(current.length)]);
  }

  function buildItems(): QuoteOrderItemInput[] | null {
    if (lines.length === 0) {
      setFeedback({ kind: "error", message: "Agrega al menos un producto a la cotización." });
      return null;
    }

    const items: QuoteOrderItemInput[] = [];
    for (const line of lines) {
      const option = optionByKey.get(line.optionKey);
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      if (!option) {
        setFeedback({ kind: "error", message: "Selecciona un producto válido en cada línea." });
        return null;
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
        setFeedback({ kind: "error", message: `Revisa la cantidad de ${option.label}.` });
        return null;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        setFeedback({ kind: "error", message: `Revisa el precio de ${option.label}.` });
        return null;
      }
      items.push({
        productId: option.productId,
        variantId: option.variantId,
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

      const nextStatus = result.status;
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
            <button
              type="button"
              onClick={addLine}
              disabled={isPending || !canSend}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-orbita-cyan/40 bg-white px-3 py-2 text-sm font-semibold text-orbita-navy transition hover:bg-orbita-cyan-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} />
              Agregar producto
            </button>
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
                  <label className="block text-xs font-medium text-slate-600">
                    Producto {index + 1}
                    <select
                      value={line.optionKey}
                      onChange={(event) => selectProduct(line.id, event.target.value)}
                      disabled={isPending || !canSend}
                      className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10 disabled:bg-slate-100"
                    >
                      <option value="">Seleccionar producto</option>
                      {catalogOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

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
