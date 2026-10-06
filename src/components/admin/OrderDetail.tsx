"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { updateOrderStatus, updatePaymentStatus } from "@/actions/orders";
import { useToast } from "@/components/ui/Toast";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/types";
import type { OrderStatus, OrderWithItems, PaymentStatus } from "@/lib/types";
import { OrderQuoteBuilder, type QuoteCatalogOption } from "./OrderQuoteBuilder";
import { PaymentBadge, StatusBadge } from "./OrdersTable";

export function OrderDetail({ order, catalogOptions }: { order: OrderWithItems; catalogOptions: QuoteCatalogOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status);
  const [feedback, setFeedback] = useState<string | null>(null);
  const canSendQuote = ["pedido_realizado", "cotizacion_enviada", "no_hubo_producto"].includes(status);

  async function handleStatusChange(next: OrderStatus) {
    const previous = status;
    setStatus(next);
    const result = await updateOrderStatus(order.id, next);
    if ("error" in result && result.error) {
      setStatus(previous);
      setFeedback(result.error);
      toast.error("No se pudo cambiar el estado del pedido", { description: result.error });
      return;
    }
    const warning = "warning" in result ? result.warning : undefined;
    setFeedback(warning ?? null);
    if (warning) toast.warning("Estado actualizado con una novedad", { description: warning });
    else toast.success("Estado del pedido actualizado", { description: ORDER_STATUS_LABELS[next] });
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
        <OrderQuoteBuilder order={order} catalogOptions={catalogOptions} canSend={canSendQuote} onSent={handleQuoteSent} />

        <section className="rounded-2xl border border-black/5 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-black/60">Estado del pedido</h2>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs font-medium text-slate-600">
              Estado
              <select value={status} onChange={(event) => handleStatusChange(event.target.value as OrderStatus)} className="mt-1 block rounded-lg border border-black/10 px-3 py-2.5 text-sm">
                {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Pago
              <select value={paymentStatus} onChange={(event) => handlePaymentChange(event.target.value as PaymentStatus)} className="mt-1 block rounded-lg border border-black/10 px-3 py-2.5 text-sm">
                {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </section>

        {order.notes ? (
          <section className="rounded-2xl border border-black/5 bg-white p-5">
            <h2 className="mb-2 text-sm font-semibold text-black/60">Notas del pedido</h2>
            <p className="whitespace-pre-line text-sm text-black/70">{order.notes}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
