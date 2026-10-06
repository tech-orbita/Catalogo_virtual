import Link from "next/link";
import { Plus } from "lucide-react";
import { getAdminOrders } from "@/lib/data/admin-orders";
import { AdminTopbar } from "@/components/admin/AdminTopbar";
import { OrdersTable } from "@/components/admin/OrdersTable";
import type { OrderStatus, PaymentStatus } from "@/lib/types";

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; estado?: OrderStatus; pago?: PaymentStatus; page?: string }>;
}) {
  const params = await searchParams;
  const { orders, total, page, totalPages } = await getAdminOrders({
    search: params.search,
    status: params.estado,
    paymentStatus: params.pago,
    page: params.page ? Number(params.page) : 1,
  });

  return (
    <>
      <AdminTopbar
        title="Pedidos"
        actions={
          <Link
            href="/admin/pedidos/nuevo"
            className="flex min-h-10 items-center gap-2 rounded-xl bg-orbita-cyan px-3 py-2 text-sm font-semibold text-orbita-navy transition hover:bg-[#78c5d7] sm:px-4"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Crear pedido</span>
          </Link>
        }
      />
      <div className="admin-enter p-4 sm:p-6">
        <OrdersTable orders={orders} total={total} page={page} totalPages={totalPages} />
      </div>
    </>
  );
}
