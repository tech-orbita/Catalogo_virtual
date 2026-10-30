"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowRight, Download, Loader2, Search } from "lucide-react";
import { updateOrderStatus } from "@/actions/orders";
import { useToast } from "@/components/ui/Toast";
import { formatCOP } from "@/lib/currency";
import { NEXT_ORDER_STAGE, canMoveToStatus } from "@/lib/order-stages";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/types";
import type { Order, OrderStatus, PaymentStatus } from "@/lib/types";
import type { StoreLocation } from "@/lib/types";

export function OrdersTable({
  orders,
  total,
  page,
  totalPages,
  locations,
  canManageOrders,
}: {
  orders: Order[];
  total: number;
  page: number;
  totalPages: number;
  locations: StoreLocation[];
  canManageOrders: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function goToPage(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateParam("search", search);
          }}
          className="relative flex-1 min-w-[220px]"
        >
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número, nombre, teléfono o cédula"
            className="w-full rounded-lg border border-black/10 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand"
          />
        </form>

        <select
          defaultValue={searchParams.get("estado") ?? ""}
          onChange={(e) => updateParam("estado", e.target.value)}
          className="rounded-lg border border-black/10 px-3 py-2.5 text-sm"
        >
          <option value="">Todos los estados</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          defaultValue={searchParams.get("sede") ?? ""}
          onChange={(e) => updateParam("sede", e.target.value)}
          className="rounded-lg border border-black/10 px-3 py-2.5 text-sm"
          aria-label="Filtrar por proveniencia"
        >
          <option value="">Todas las proveniencias</option>
          <option value="sin_sede">Catálogo virtual / dashboard</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>{location.name}</option>
          ))}
        </select>

        <select
          defaultValue={searchParams.get("pago") ?? ""}
          onChange={(e) => updateParam("pago", e.target.value)}
          className="rounded-lg border border-black/10 px-3 py-2.5 text-sm"
        >
          <option value="">Todos los pagos</option>
          {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <a
          href={`/api/admin/orders/export?${searchParams.toString()}`}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-orbita-cyan/40 bg-white px-3 py-2 text-sm font-semibold text-orbita-navy transition hover:bg-orbita-cyan-soft"
        >
          <Download size={16} aria-hidden="true" />
          Exportar Excel
        </a>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white">
        <table className="min-w-[760px] w-full text-sm">
          <thead>
            <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-black/40">
              <th className="p-3">Pedido</th>
              <th className="p-3">Comprador</th>
              <th className="p-3">Entrega</th>
              <th className="p-3">Valor</th>
              <th className="p-3">{canManageOrders ? "Acción" : "Estado"}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.02]">
                <td className="p-3 font-medium">#{order.order_number}</td>
                <td className="p-3">{order.customer_name}</td>
                <td className="p-3 text-black/50">
                  <span className="capitalize">{order.delivery_method}</span>
                  {order.location_name_snapshot && (
                    <span className="mt-0.5 block text-xs text-orbita-cyan-dark">
                      {order.location_name_snapshot}
                    </span>
                  )}
                </td>
                <td className="p-3 font-medium">{formatCOP(order.total)}</td>
                {canManageOrders ? (
                  <OrderStageCell order={order} />
                ) : (
                  <td className="p-3">
                    <StatusBadge status={order.status} />
                  </td>
                )}
                <td className="p-3">
                  <Link
                    href={`/admin/pedidos/${order.id}`}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
                  >
                    Ver pedido
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-sm text-black/50 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Mostrando {orders.length} de {total} pedidos
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40"
          >
            Anterior
          </button>
          <span>
            Página {page} de {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => goToPage(page + 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Estado y botón de siguiente paso para cambiar la etapa desde la lista
 * sin abrir el pedido.
 */
function OrderStageCell({ order }: { order: Order }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [isUpdating, setIsUpdating] = useState(false);
  const nextStage = NEXT_ORDER_STAGE[status];

  async function changeStatus(next: OrderStatus) {
    if (next === status || isUpdating) return;
    const previous = status;
    setIsUpdating(true);
    setStatus(next);
    const result = await updateOrderStatus(order.id, next);
    setIsUpdating(false);
    if ("error" in result && result.error) {
      setStatus(previous);
      toast.error(`No se pudo actualizar el pedido #${order.order_number}`, { description: result.error });
      return;
    }
    const warning = "warning" in result ? result.warning : undefined;
    if (warning) toast.warning(`Pedido #${order.order_number} actualizado con una novedad`, { description: warning });
    else
      toast.success(`Pedido #${order.order_number}: ${ORDER_STATUS_LABELS[next]}`, {
        description: next === "cotizacion_aceptada" ? "Pedido enviado al grupo de domicilios." : undefined,
      });
    router.refresh();
  }

  return (
    <td className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(event) => changeStatus(event.target.value as OrderStatus)}
          disabled={isUpdating}
          aria-label={`Estado del pedido #${order.order_number}`}
          className={`max-w-[11rem] cursor-pointer rounded-full border-0 py-1 pl-2.5 pr-7 text-xs font-medium outline-none focus:ring-2 focus:ring-orbita-cyan/40 disabled:cursor-wait disabled:opacity-60 ${STATUS_COLORS[status]}`}
        >
          {(Object.entries(ORDER_STATUS_LABELS) as [OrderStatus, string][]).map(([value, label]) => (
            <option key={value} value={value} disabled={!canMoveToStatus(status, value)}>{label}</option>
          ))}
        </select>
        {nextStage ? (
          <button
            type="button"
            onClick={() => changeStatus(nextStage.status)}
            disabled={isUpdating}
            title={
              nextStage.status === "cotizacion_aceptada"
                ? "Marca la cotización aceptada y envía el pedido al grupo de domicilios."
                : nextStage.description
            }
            className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-orbita-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orbita-navy/90 disabled:cursor-wait disabled:opacity-60"
          >
            {isUpdating ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            {nextStage.shortLabel}
            {isUpdating ? null : <ArrowRight size={14} aria-hidden="true" />}
          </button>
        ) : status === "pedido_realizado" ? (
          <Link
            href={`/admin/pedidos/${order.id}`}
            className="inline-flex min-h-8 items-center whitespace-nowrap rounded-lg border border-orbita-cyan/50 px-3 py-1.5 text-xs font-semibold text-orbita-navy transition hover:bg-orbita-cyan-soft"
          >
            Cotizar
          </Link>
        ) : null}
      </div>
    </td>
  );
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  pedido_realizado: "bg-amber-50 text-amber-700",
  cotizacion_enviada: "bg-cyan-50 text-cyan-700",
  cotizacion_aceptada: "bg-blue-50 text-blue-700",
  cotizacion_no_aceptada: "bg-rose-50 text-rose-700",
  no_hubo_producto: "bg-red-50 text-red-700",
  pedido_listo: "bg-purple-50 text-purple-700",
  pedido_enviado: "bg-indigo-50 text-indigo-700",
  pedido_entregado: "bg-green-50 text-green-700",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[status]}`}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        status === "pagado" ? "bg-green-50 text-green-700" : "bg-black/5 text-black/50"
      }`}
    >
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}
