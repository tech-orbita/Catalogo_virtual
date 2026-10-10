"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, ClipboardList, MessageSquareText } from "lucide-react";
import { updateOrderStatus, updatePaymentStatus } from "@/actions/orders";
import { useToast } from "@/components/ui/Toast";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/types";
import type { OrderStatus, OrderWithItems, PaymentStatus } from "@/lib/types";
import { OrderQuoteBuilder, type QuoteCatalogOption } from "./OrderQuoteBuilder";
import { PaymentBadge, StatusBadge } from "./OrdersTable";

const NEXT_ORDER_STAGE: Partial<
  Record<OrderStatus, { status: OrderStatus; label: string; description: string }>
> = {
  cotizacion_enviada: {
    status: "cotizacion_aceptada",
    label: "Marcar cotización aceptada",
    description: "Continúa cuando el cliente confirme la cotización.",
  },
  cotizacion_aceptada: {
    status: "pedido_listo",
    label: "Marcar pedido listo",
    description: "Indica que el pedido ya está preparado.",
  },
  pedido_listo: {
    status: "pedido_enviado",
    label: "Marcar como enviado",
    description: "Informa que el pedido ya salió de la sede.",
  },
  pedido_enviado: {
    status: "pedido_entregado",
    label: "Marcar como entregado",
    description: "Finaliza el seguimiento cuando llegue al cliente.",
  },
};

export function OrderDetail({ order, catalogOptions }: { order: OrderWithItems; catalogOptions: QuoteCatalogOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const canSendQuote = ["pedido_realizado", "cotizacion_enviada", "no_hubo_producto"].includes(status);
  const nextStage = NEXT_ORDER_STAGE[status];

  async function handleStatusChange(next: OrderStatus) {
    if (next === status || isUpdatingStatus) return;
    const previous = status;
    setIsUpdatingStatus(true);
    setStatus(next);
    const result = await updateOrderStatus(order.id, next);
    if ("error" in result && result.error) {
      setStatus(previous);
      setFeedback(result.error);
      toast.error("No se pudo cambiar el estado del pedido", { description: result.error });
      setIsUpdatingStatus(false);
      return;
    }
    const warning = "warning" in result ? result.warning : undefined;
    setFeedback(warning ?? null);
    if (warning) toast.warning("Estado actualizado con una novedad", { description: warning });
    else toast.success("Estado del pedido actualizado", { description: ORDER_STATUS_LABELS[next] });
    setIsUpdatingStatus(false);
    router.refresh();
  }

  async function handlePaymentChange(next: PaymentStatus) {
    const previous = paymentStatus;
    setPaymentStatus(next);
    const result = await updatePaymentStatus(order.id, next);
    if ("error" in result && result.error) {
      setPaymentStatus(previous);
      setFeedback(result.error);
      toast.error("No se pudo cambiar el estado del pago", { description: result.error });
      return;
    }
    setFeedback(null);
    toast.success("Estado del pago actualizado", { description: PAYMENT_STATUS_LABELS[next] });
    router.refresh();
  }

  function handleQuoteSent(nextStatus: OrderStatus) {
    setStatus(nextStatus);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <h1 className="mr-1 text-xl font-semibold">Pedido #{order.order_number}</h1>
        <StatusBadge status={status} />
        <PaymentBadge status={paymentStatus} />
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {order.order_source === "asesor" ? "Creado por asesor" : "Catálogo web"}
        </span>
      </div>

      {feedback ? (
        <div role="status" className="mb-5 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 shrink-0" size={17} />
          <span>{feedback}</span>
        </div>
      ) : null}

      <div className="space-y-6">
        <section className="overflow-hidden rounded-2xl border border-orbita-cyan/30 bg-white shadow-sm">
          <div className="border-b border-orbita-cyan/20 bg-orbita-cyan-soft/55 px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-orbita-cyan-dark shadow-sm">
                <ClipboardList size={19} aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-orbita-navy">Gestión del pedido</h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">
                  Revisa el estado, el pago y las notas antes de preparar la cotización.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)] sm:p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-800">
                  Estado del pedido
                  <select
                    value={status}
                    onChange={(event) => handleStatusChange(event.target.value as OrderStatus)}
                    disabled={isUpdatingStatus}
                    className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-semibold text-slate-900 outline-none transition focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10 disabled:cursor-wait disabled:bg-slate-100"
                  >
                    {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  Estado del pago
                  <select
                    value={paymentStatus}
                    onChange={(event) => handlePaymentChange(event.target.value as PaymentStatus)}
                    className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-semibold text-slate-900 outline-none transition focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10"
                  >
                    {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                <MessageSquareText size={17} aria-hidden="true" />
                Notas del pedido
              </div>
              <p className="mt-2 whitespace-pre-line text-base leading-6 text-slate-900">
                {order.notes?.trim() || "Este pedido no tiene notas."}
              </p>
            </div>
          </div>

          {nextStage ? (
            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <p className="text-sm font-semibold text-slate-900">Siguiente paso recomendado</p>
                <p className="mt-0.5 text-sm text-slate-600">{nextStage.description}</p>
              </div>
              <button
                type="button"
                onClick={() => handleStatusChange(nextStage.status)}
                disabled={isUpdatingStatus}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orbita-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orbita-navy/90 disabled:cursor-wait disabled:opacity-60"
              >
                {isUpdatingStatus ? "Actualizando..." : nextStage.label}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </section>

        <OrderQuoteBuilder order={order} catalogOptions={catalogOptions} canSend={canSendQuote} onSent={handleQuoteSent} />
      </div>
    </div>
  );
}
