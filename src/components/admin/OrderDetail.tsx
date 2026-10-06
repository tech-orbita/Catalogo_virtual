"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, MessageSquare, Send } from "lucide-react";
import { formatCOP } from "@/lib/currency";
import { buildQuoteMessage, estimateSmsCost, SMS_MAX_LENGTH } from "@/lib/messaging";
import { sendOrderQuote, updateOrderStatus, updatePaymentStatus } from "@/actions/orders";
import { useToast } from "@/components/ui/Toast";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/types";
import { StatusBadge, PaymentBadge } from "./OrdersTable";
import type { OrderStatus, OrderWithItems, PaymentStatus } from "@/lib/types";

const CRM_STATUS_COPY = {
  pendiente: { label: "Sincronización pendiente", className: "bg-slate-100 text-slate-600" },
  sin_configurar: { label: "CRM sin configurar", className: "bg-amber-50 text-amber-700" },
  sincronizado: { label: "Contacto sincronizado", className: "bg-emerald-50 text-emerald-700" },
  error: { label: "Error de sincronización", className: "bg-red-50 text-red-700" },
} as const;

export function OrderDetail({ order }: { order: OrderWithItems }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status);
  const [quoteMessage, setQuoteMessage] = useState(order.quote_message ?? buildQuoteMessage(order));
  const [sendingQuote, setSendingQuote] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const crmStatus = CRM_STATUS_COPY[order.ghl_sync_status ?? "pendiente"];
  const canSendQuote = status === "pedido_realizado" || status === "cotizacion_enviada";
  const smsCost = estimateSmsCost(quoteMessage);

  async function handleStatusChange(next: OrderStatus) {
    const previous = status;
    setStatus(next);
    const result = await updateOrderStatus(order.id, next);
    if ("error" in result && result.error) {
      setStatus(previous);
      setFeedback({ kind: "error", message: result.error });
      toast.error("No se pudo cambiar el estado del pedido", { description: result.error });
      return;
    }
    const warning = "warning" in result ? result.warning : undefined;
    setFeedback(warning ? { kind: "warning", message: warning } : null);
    if (warning) {
      toast.warning("Estado local actualizado con advertencias", { description: warning });
    } else {
      toast.success("Estado del pedido actualizado", {
        description: ORDER_STATUS_LABELS[next],
      });
    }
    router.refresh();
  }

  async function handlePaymentChange(next: PaymentStatus) {
    const previous = paymentStatus;
    setPaymentStatus(next);
    const result = await updatePaymentStatus(order.id, next);
    if ("error" in result && result.error) {
      setPaymentStatus(previous);
      setFeedback({ kind: "error", message: result.error });
      toast.error("No se pudo cambiar el estado del pago", { description: result.error });
      return;
    }
    setFeedback(null);
    toast.success("Estado del pago actualizado", {
      description: PAYMENT_STATUS_LABELS[next],
    });
    router.refresh();
  }

  async function handleSendQuote() {
    setSendingQuote(true);
    setFeedback(null);
    const toastId = toast.loading("Enviando cotización por SMS...");
    const result = await sendOrderQuote(order.id, quoteMessage);
    setSendingQuote(false);

    if ("error" in result && result.error) {
      setFeedback({ kind: "error", message: result.error });
      toast.update(toastId, {
        variant: "error",
        title: "No se pudo enviar la cotización",
        description: result.error,
      });
      return;
    }

    setStatus("cotizacion_enviada");
    setFeedback({
      kind: result.warning ? "warning" : "success",
      message: result.warning ?? "Cotización enviada por SMS desde Órbita IA.",
    });
    toast.update(toastId, {
      variant: result.warning ? "warning" : "success",
      title: result.warning ? "Cotización enviada con advertencias" : "Cotización enviada",
      description: result.warning ?? `Pedido #${order.order_number} por SMS.`,
    });
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

      {feedback && (
        <div
          role="status"
          className={`mb-5 flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm ${
            feedback.kind === "success"
              ? "bg-emerald-50 text-emerald-700"
              : feedback.kind === "warning"
                ? "bg-amber-50 text-amber-800"
                : "bg-red-50 text-red-700"
          }`}
        >
          {feedback.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 shrink-0" size={17} />
          ) : (
            <AlertCircle className="mt-0.5 shrink-0" size={17} />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="overflow-hidden rounded-2xl border border-orbita-cyan/30 bg-white">
            <div className="border-b border-orbita-cyan/20 bg-orbita-cyan-soft/55 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-orbita-cyan-dark shadow-sm">
                    <MessageSquare size={19} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-orbita-navy">Cotización por SMS</h2>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Confirma disponibilidad y revisa el texto. Se envía como SMS desde el proveedor configurado.
                    </p>
                  </div>
                </div>
                <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-medium sm:block ${crmStatus.className}`}>
                  {crmStatus.label}
                </span>
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <textarea
                value={quoteMessage}
                onChange={(event) => setQuoteMessage(event.target.value)}
                rows={10}
                maxLength={SMS_MAX_LENGTH}
                disabled={!canSendQuote}
                aria-label="Mensaje de la cotización"
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-6 outline-none focus:border-orbita-cyan-dark focus:ring-4 focus:ring-orbita-cyan/10 disabled:bg-slate-50 disabled:text-slate-400"
              />
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-500">
                  <span className={`inline-flex rounded-full px-2.5 py-1 sm:hidden ${crmStatus.className}`}>
                    {crmStatus.label}
                  </span>
                  <p className="mt-2 sm:mt-0">
                    {smsCost.characters}/{SMS_MAX_LENGTH} caracteres ·{" "}
                    {smsCost.segments} {smsCost.segments === 1 ? "segmento" : "segmentos"} ({smsCost.encoding})
                  </p>
                  {order.quote_sent_at && (
                    <p className="mt-2 sm:mt-0">
                      Último envío: {new Date(order.quote_sent_at).toLocaleString("es-CO")}
                      {order.quote_sent_by_email ? ` · ${order.quote_sent_by_email}` : ""}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSendQuote}
                  disabled={sendingQuote || !canSendQuote || !quoteMessage.trim()}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orbita-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orbita-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={16} />
                  {sendingQuote
                    ? "Enviando..."
                    : status === "cotizacion_enviada"
                      ? "Reenviar cotización"
                      : "Enviar cotización"}
                </button>
              </div>
              {!canSendQuote && (
                <p className="mt-3 text-xs text-slate-500">
                  Para enviar o reenviar una cotización, cambia el pedido a Pedido realizado o Cotización enviada.
                </p>
              )}
              {order.ghl_sync_error && order.ghl_sync_status !== "sincronizado" && (
                <p className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700">
                  {order.ghl_sync_error}
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-black/60">Estado del pedido</h2>
            <div className="flex flex-wrap gap-3">
              <select
                value={status}
                onChange={(event) => handleStatusChange(event.target.value as OrderStatus)}
                className="rounded-lg border border-black/10 px-3 py-2.5 text-sm"
              >
                {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={paymentStatus}
                onChange={(event) => handlePaymentChange(event.target.value as PaymentStatus)}
                className="rounded-lg border border-black/10 px-3 py-2.5 text-sm"
              >
                {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-black/60">Detalles del pedido</h2>
            <p className="mb-3 text-xs text-black/40">
              {new Date(order.created_at).toLocaleString("es-CO")}
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-[540px] w-full text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left text-xs uppercase text-black/40">
                    <th className="py-2">Producto</th>
                    <th className="py-2">Cantidad</th>
                    <th className="py-2">Precio</th>
                    <th className="py-2">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b border-black/5 last:border-0">
                      <td className="py-2.5">
                        {item.product_name_snapshot}
                        {item.variant_label_snapshot && (
                          <span className="text-black/40"> ({item.variant_label_snapshot})</span>
                        )}
                      </td>
                      <td className="py-2.5">{item.quantity}</td>
                      <td className="py-2.5">{formatCOP(item.unit_price)}</td>
                      <td className="py-2.5 font-medium">{formatCOP(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end border-t border-black/10 pt-3 text-sm">
              <div className="w-44 space-y-1">
                <div className="flex justify-between">
                  <span className="text-black/50">Subtotal</span>
                  <span>{formatCOP(order.subtotal)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{formatCOP(order.total)}</span>
                </div>
              </div>
            </div>
          </section>

          {order.notes && (
            <section className="rounded-2xl border border-black/5 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-black/60">Notas del pedido</h2>
              <p className="whitespace-pre-line text-sm text-black/70">{order.notes}</p>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-black/5 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-black/60">Comprador</h2>
            <p className="text-sm font-medium">{order.customer_name}</p>
            <p className="mt-1 text-sm text-black/50">Teléfono: {order.customer_phone}</p>
            {order.customer_email && (
              <p className="text-sm text-black/50">Correo: {order.customer_email}</p>
            )}
            <p className="text-sm text-black/50">Cédula: {order.customer_cedula}</p>
            {order.created_by_email && (
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
                Registrado por {order.created_by_email}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-black/5 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-black/60">Entrega</h2>
            {order.location_name_snapshot && (
              <div className="mb-3 rounded-xl bg-orbita-cyan-soft px-3 py-2.5 text-sm text-orbita-navy">
                <p className="font-semibold">Sede {order.location_name_snapshot}</p>
                {order.location_address_snapshot && (
                  <p className="mt-0.5 text-xs text-slate-500">{order.location_address_snapshot}</p>
                )}
                {order.location_whatsapp_snapshot && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    WhatsApp: +{order.location_whatsapp_snapshot}
                  </p>
                )}
              </div>
            )}
            {order.delivery_method === "domicilio" ? (
              <div className="space-y-1 text-sm text-black/70">
                <p className="font-medium text-[var(--foreground)]">Domicilio</p>
                <p>{order.address}</p>
                {order.address_details && <p>{order.address_details}</p>}
                <p>
                  {order.city}
                  {order.department ? `, ${order.department}` : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm font-medium text-[var(--foreground)]">Recoger en tienda</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
