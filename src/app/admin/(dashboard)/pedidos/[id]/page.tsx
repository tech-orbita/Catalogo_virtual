import { notFound } from "next/navigation";
import { getAdminOrderById } from "@/lib/data/admin-orders";
import { AdminTopbar } from "@/components/admin/AdminTopbar";
import { OrderDetail } from "@/components/admin/OrderDetail";
import type { QuoteCatalogOption } from "@/components/admin/OrderQuoteBuilder";
import { getProducts } from "@/lib/data/queries";

export default async function PedidoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [order, products] = await Promise.all([
    getAdminOrderById(id),
    getProducts({ onlyActive: true }),
  ]);
  if (!order) notFound();

  const catalogOptions = products.flatMap<QuoteCatalogOption>((product) => {
    if (product.variants.length === 0) {
      return [{ key: `${product.id}:`, productId: product.id, variantId: null, label: product.name, unitPrice: Number(product.price) }];
    }
    return product.variants.map((variant) => ({
      key: `${product.id}:${variant.id}`,
      productId: product.id,
      variantId: variant.id,
      label: `${product.name} — ${variant.variant_name}: ${variant.option_value}`,
      unitPrice: Number(variant.price_override ?? product.price),
    }));
  });
  const optionKeys = new Set(catalogOptions.map((option) => option.key));
  for (const item of order.items) {
    if (!item.product_id) continue;
    const key = `${item.product_id}:${item.variant_id ?? ""}`;
    if (optionKeys.has(key)) continue;
    catalogOptions.push({
      key,
      productId: item.product_id,
      variantId: item.variant_id,
      label: [item.product_name_snapshot, item.variant_label_snapshot].filter(Boolean).join(" — "),
      unitPrice: Number(item.unit_price),
    });
    optionKeys.add(key);
  }
  for (const item of order.quote_items ?? []) {
    const key = `${item.product_id}:${item.variant_id ?? ""}`;
    if (optionKeys.has(key)) continue;
    catalogOptions.push({
      key,
      productId: item.product_id,
      variantId: item.variant_id,
      label: [item.product_name, item.variant_label].filter(Boolean).join(" — "),
      unitPrice: Number(item.unit_price),
    });
    optionKeys.add(key);
  }

  return (
    <>
      <AdminTopbar title={`Pedido #${order.order_number}`} backHref="/admin/pedidos" />
      <div className="admin-enter p-4 sm:p-6">
        <OrderDetail order={order} catalogOptions={catalogOptions} />
      </div>
    </>
  );
}
