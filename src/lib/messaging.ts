import { formatCOP } from "@/lib/currency";
import type { DeliveryMethod, OrderQuoteItem, OrderWithItems } from "@/lib/types";

/** Tope conservador para el campo multiline y el cuerpo del mensaje del proveedor. */
export const QUOTE_SUMMARY_MAX_LENGTH = 1600;
export const DELIVERY_MINIMUM_SUBTOTAL = 50_000;

type OrderMessageInput = {
  orderNumber: number;
  customerName: string;
  customerPhone: string;
  customerCedula: string;
  customerEmail?: string | null;
  deliveryMethod: DeliveryMethod;
  address?: string | null;
  neighborhood?: string | null;
  addressDetails?: string | null;
  city?: string | null;
  department?: string | null;
  locationName?: string | null;
  notes?: string | null;
  items: Array<{
    productName: string;
    variantLabel?: string | null;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  subtotal: number;
};

function appendOrderItems(lines: string[], items: OrderMessageInput["items"]) {
  for (const item of items) {
    const label = item.variantLabel
      ? `${item.productName} (${item.variantLabel})`
      : item.productName;
    lines.push(`- ${label} x${item.quantity}: ${formatCOP(item.subtotal)}`);
  }
}

export function buildOrderReceivedMessage(order: OrderMessageInput): string {
  const lines = [
    `Hola ${order.customerName}, recibimos tu solicitud #${order.orderNumber}.`,
    "",
    "Datos recibidos:",
    `Entrega: ${order.deliveryMethod === "domicilio" ? "Domicilio" : "Recoger en tienda"}`,
  ];

  if (order.locationName) lines.push(`Sede: ${order.locationName}`);
  if (order.address) lines.push(`Dirección: ${order.address}`);
  if (order.neighborhood) lines.push(`Barrio: ${order.neighborhood}`);
  if (order.addressDetails) lines.push(`Indicaciones: ${order.addressDetails}`);
  if (order.city || order.department) {
    lines.push(`Ciudad / departamento: ${[order.city, order.department].filter(Boolean).join(", ")}`);
  }

  lines.push("", "Productos:");
  appendOrderItems(lines, order.items);
  lines.push("", `Subtotal de productos: ${formatCOP(order.subtotal)}`);

  if (order.deliveryMethod === "domicilio") {
    lines.push(
      "",
      "Políticas de domicilio:",
      `- Solo atendemos domicilios para pedidos de productos mayores a ${formatCOP(DELIVERY_MINIMUM_SUBTOTAL)}.`,
      "- El valor final del domicilio se informará en la cotización.",
      "- Los envíos fuera de Bogotá o Soacha se cotizan por separado mediante una transportadora."
    );
  }

  lines.push("", "Un asesor revisará disponibilidad y te enviará la cotización final.");
  return lines.join("\n");
}

export function buildOperationalOrderAlert(order: OrderMessageInput): string {
  const lines = [
    `Nuevo pedido #${order.orderNumber} desde el catálogo`,
    `Cliente: ${order.customerName}`,
    `Teléfono: ${order.customerPhone}`,
    `Cédula: ${order.customerCedula}`,
  ];

  if (order.customerEmail) lines.push(`Correo: ${order.customerEmail}`);
  lines.push(
    `Entrega: ${order.deliveryMethod === "domicilio" ? "Domicilio" : "Recoger en tienda"}`
  );
  if (order.locationName) lines.push(`Sede: ${order.locationName}`);
  if (order.address) lines.push(`Dirección: ${order.address}`);
  if (order.neighborhood) lines.push(`Barrio: ${order.neighborhood}`);
  if (order.addressDetails) lines.push(`Indicaciones: ${order.addressDetails}`);
  if (order.city || order.department) {
    lines.push(`Ciudad / departamento: ${[order.city, order.department].filter(Boolean).join(", ")}`);
  }

  lines.push("", "Productos:");
  appendOrderItems(lines, order.items);
  lines.push("", `Subtotal de productos: ${formatCOP(order.subtotal)}`);
  if (order.notes) lines.push("", `Notas: ${order.notes}`);
  return lines.join("\n");
}

export function buildQuoteMessage(order: OrderWithItems): string {
  const lines = [`Hola ${order.customer_name}, esta es la cotizacion de tu solicitud #${order.order_number}:`];

  for (const item of order.items) {
    const label = item.variant_label_snapshot
      ? `${item.product_name_snapshot} (${item.variant_label_snapshot})`
      : item.product_name_snapshot;
    lines.push(`- ${label} x${item.quantity}: ${formatCOP(item.subtotal)}`);
  }

  lines.push(`Total: ${formatCOP(order.total)}`);
  lines.push("Si no ves los botones, responde APROBAR o RECHAZAR.");
  return lines.join("\n");
}

export function buildStructuredQuoteMessage(
  order: Pick<
    OrderWithItems,
    | "order_number"
    | "customer_name"
    | "customer_phone"
    | "customer_cedula"
    | "customer_email"
    | "delivery_method"
    | "address"
    | "neighborhood"
    | "address_details"
    | "city"
    | "department"
    | "location_name_snapshot"
  >,
  items: OrderQuoteItem[],
  deliveryFee: number
): string {
  const availableItems = items.filter((item) => item.available);
  const unavailableItems = items.filter((item) => !item.available);
  const subtotal = availableItems.reduce((sum, item) => sum + item.subtotal, 0);
  const total = subtotal + deliveryFee;
  const lines = [
    `Cotización solicitud #${order.order_number}`,
    `Cliente: ${order.customer_name}`,
    `Teléfono: ${order.customer_phone}`,
    `Cédula: ${order.customer_cedula}`,
  ];

  if (order.customer_email) lines.push(`Correo: ${order.customer_email}`);
  lines.push(
    "",
    `Entrega: ${order.delivery_method === "domicilio" ? "Domicilio" : "Recoger en tienda"}`
  );
  if (order.location_name_snapshot) lines.push(`Sede: ${order.location_name_snapshot}`);
  if (order.address) lines.push(`Dirección: ${order.address}`);
  if (order.neighborhood) lines.push(`Barrio: ${order.neighborhood}`);
  if (order.address_details) lines.push(`Indicaciones: ${order.address_details}`);
  if (order.city || order.department) {
    lines.push(`Ciudad: ${[order.city, order.department].filter(Boolean).join(", ")}`);
  }

  if (availableItems.length > 0) {
    lines.push("", "Productos disponibles:");
    for (const item of availableItems) {
      const label = item.variant_label
        ? `${item.product_name} (${item.variant_label})`
        : item.product_name;
      lines.push(
        `- ${label} · ${item.quantity} x ${formatCOP(item.unit_price)} = ${formatCOP(item.subtotal)}`
      );
    }
  }

  if (unavailableItems.length > 0) {
    lines.push("", "Productos no disponibles:");
    for (const item of unavailableItems) {
      const label = item.variant_label
        ? `${item.product_name} (${item.variant_label})`
        : item.product_name;
      lines.push(`- ${label}`);
    }
  }

  lines.push("", `Subtotal productos: ${formatCOP(subtotal)}`);
  if (order.delivery_method === "domicilio") {
    lines.push(`Domicilio: ${formatCOP(deliveryFee)}`);
  }
  lines.push(`Total: ${formatCOP(total)}`);
  lines.push("Si no ves los botones, responde APROBAR o RECHAZAR.");
  return lines.join("\n");
}

export function buildOrderCrmNote(order: {
  orderNumber: number;
  source: "catalogo" | "asesor";
  customerName: string;
  customerEmail?: string | null;
  customerCedula: string;
  customerPhone: string;
  deliveryMethod: DeliveryMethod;
  address?: string | null;
  neighborhood?: string | null;
  addressDetails?: string | null;
  city?: string | null;
  department?: string | null;
  locationName?: string | null;
  notes?: string | null;
  items: Array<{
    productName: string;
    variantLabel?: string | null;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  subtotal: number;
  total: number;
}): string {
  const lines = [
    `Solicitud #${order.orderNumber}`,
    `Origen: ${order.source === "asesor" ? "Creada por asesor" : "Catálogo web"}`,
    "Estado: Pendiente por cotizar",
    "",
    `Cliente: ${order.customerName}`,
    `Teléfono: ${order.customerPhone}`,
    `Correo: ${order.customerEmail || "No informado"}`,
    `Cédula: ${order.customerCedula}`,
    "",
    `Entrega: ${order.deliveryMethod === "domicilio" ? "Domicilio" : "Recoger en tienda"}`,
  ];

  if (order.locationName) lines.push(`Sede: ${order.locationName}`);
  if (order.address) lines.push(`Dirección: ${order.address}`);
  if (order.neighborhood) lines.push(`Barrio: ${order.neighborhood}`);
  if (order.addressDetails) lines.push(`Indicaciones: ${order.addressDetails}`);
  if (order.city || order.department) {
    lines.push(`Ciudad / departamento: ${[order.city, order.department].filter(Boolean).join(", ")}`);
  }

  lines.push("", "Productos:");
  for (const item of order.items) {
    const label = item.variantLabel
      ? `${item.productName} (${item.variantLabel})`
      : item.productName;
    lines.push(`- ${label} x${item.quantity} | ${formatCOP(item.unitPrice)} | ${formatCOP(item.subtotal)}`);
  }
  lines.push("", `Subtotal: ${formatCOP(order.subtotal)}`, `Total: ${formatCOP(order.total)}`);
  if (order.notes) lines.push("", `Notas: ${order.notes}`);
  return lines.join("\n");
}
