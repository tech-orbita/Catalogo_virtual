import Link from "next/link";
import {
  ArrowUpRight,
  Boxes,
  ClipboardList,
  PackageCheck,
  Plus,
  MapPinned,
  Shapes,
  Store,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AdminTopbar } from "@/components/admin/AdminTopbar";
import { formatCOP } from "@/lib/currency";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/types";

const statusClasses: Record<OrderStatus, string> = {
  pedido_realizado: "bg-amber-50 text-amber-700",
  cotizacion_enviada: "bg-cyan-50 text-cyan-700",
  cotizacion_aceptada: "bg-blue-50 text-blue-700",
  cotizacion_no_aceptada: "bg-rose-50 text-rose-700",
  no_hubo_producto: "bg-red-50 text-red-700",
  pedido_listo: "bg-violet-50 text-violet-700",
  pedido_enviado: "bg-indigo-50 text-indigo-700",
  pedido_entregado: "bg-emerald-50 text-emerald-700",
};

export default async function AdminHomePage() {
  const supabase = await createClient();

  const [{ count: pendingOrders }, { count: activeProducts }, { count: categories }, { data: recentOrders }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pedido_realizado"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true),
      supabase.from("categories").select("id", { count: "exact", head: true }),
      supabase
        .from("orders")
        .select("id, order_number, customer_name, total, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const stats = [
    {
      label: "Pedidos realizados",
      value: pendingOrders ?? 0,
      href: "/admin/pedidos?estado=pedido_realizado",
      icon: ClipboardList,
      accent: "bg-amber-50 text-amber-700",
    },
    {
      label: "Productos activos",
      value: activeProducts ?? 0,
      href: "/admin/productos?activo=true",
      icon: PackageCheck,
      accent: "bg-orbita-cyan-soft text-orbita-cyan-dark",
    },
    {
      label: "Categorías",
      value: categories ?? 0,
      href: "/admin/categorias",
      icon: Shapes,
      accent: "bg-indigo-50 text-indigo-700",
    },
  ];

  const shortcuts = [
    {
      href: "/admin/productos",
      title: "Gestionar productos",
      description: "Edita precios, fotos, variantes y visibilidad.",
      icon: Boxes,
    },
    {
      href: "/admin/home",
      title: "Editar portada",
      description: "Actualiza el logo, banner y presentación del catálogo.",
      icon: Store,
    },
    {
      href: "/admin/sedes",
      title: "Gestionar sedes",
      description: "Configura direcciones y el WhatsApp que recibe cada pedido.",
      icon: MapPinned,
    },
  ];

  return (
    <>
      <AdminTopbar
        title="Resumen operativo"
        backHref={null}
        actions={
          <Link
            href="/admin/productos"
            className="hidden min-h-10 items-center gap-2 rounded-xl bg-orbita-cyan px-4 py-2 text-sm font-semibold text-orbita-navy transition hover:bg-[#78c5d7] sm:flex"
          >
            <Plus size={17} />
            Producto
          </Link>
        }
      />

      <div className="admin-enter p-4 sm:p-6">
        <div className="mb-5">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Todo bajo control</h2>
          <p className="mt-1 text-sm text-slate-500">Consulta el estado del catálogo y entra directo a cada operación.</p>
        </div>

        <div className="grid grid-flow-dense grid-cols-12 gap-3 sm:gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Link
                key={stat.label}
                href={stat.href}
                className="group col-span-12 rounded-2xl border border-slate-200 bg-white p-4 transition duration-300 hover:-translate-y-0.5 hover:border-orbita-cyan/60 hover:shadow-[0_18px_45px_-30px_rgba(3,27,45,0.5)] sm:col-span-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{stat.value}</p>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.accent}`}>
                    <Icon size={19} />
                  </div>
                </div>
                <p className="mt-4 flex items-center gap-1 text-xs font-semibold text-orbita-cyan-dark">
                  Revisar
                  <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </p>
              </Link>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-950">Últimos pedidos</h2>
                <p className="mt-0.5 text-xs text-slate-500">Actividad reciente del catálogo</p>
              </div>
              <Link href="/admin/pedidos" className="text-sm font-semibold text-orbita-cyan-dark hover:underline">
                Ver todos
              </Link>
            </div>

            {!recentOrders || recentOrders.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center">
                <p className="text-sm font-medium text-slate-600">Todavía no hay pedidos</p>
                <p className="mt-1 text-xs text-slate-400">Los nuevos pedidos aparecerán aquí.</p>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {recentOrders.map((order) => {
                  const status = order.status as OrderStatus;
                  return (
                    <li key={order.id}>
                      <Link
                        href={`/admin/pedidos/${order.id}`}
                        className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-1 py-3 transition hover:bg-slate-50 sm:grid-cols-[70px_1fr_auto_auto] sm:px-2"
                      >
                        <span className="text-sm font-semibold text-slate-950">#{order.order_number}</span>
                        <span className="min-w-0 truncate text-sm text-slate-600">{order.customer_name}</span>
                        <span className="hidden text-sm font-semibold text-slate-700 sm:block">{formatCOP(order.total)}</span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClasses[status]}`}>
                          {ORDER_STATUS_LABELS[status]}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl bg-orbita-navy p-4 text-white sm:p-5">
            <div className="mb-5">
              <p className="text-sm font-semibold">Acciones rápidas</p>
              <p className="mt-1 text-xs text-white/45">Lo esencial para mantener el catálogo al día.</p>
            </div>

            <div className="space-y-2">
              {shortcuts.map((shortcut) => {
                const Icon = shortcut.icon;
                return (
                  <Link
                    key={shortcut.href}
                    href={shortcut.href}
                    className="group flex items-center gap-3 rounded-xl bg-white/[0.06] p-3.5 transition hover:bg-white/[0.11]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orbita-cyan/15 text-orbita-cyan">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{shortcut.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-white/45">{shortcut.description}</p>
                    </div>
                    <ArrowUpRight size={16} className="text-white/35 transition group-hover:text-orbita-cyan" />
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
