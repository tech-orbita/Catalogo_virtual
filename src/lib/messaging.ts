import { formatCOP } from "@/lib/currency";
import { sanitizeInteractiveMessageText } from "@/lib/interactive-message";
import type { DeliveryMethod, OrderQuoteItem, OrderWithItems } from "@/lib/types";

export const DELIVERY_MINIMUM_SUBTOTAL = 50_000;
export const DATA_POLICY_URL = "https://Tyc.puntosorganic.com";

function formatQuotePrice(value: number): string {
  return `$ ${Math.round(value).toLocaleString("es-CO")}`;
}

function compactVariantLabel(value: string | null): string | null {
  if (!value) return null;
  const optionValue = value.includes(":") ? value.slice(value.indexOf(":") + 1).trim() : value.trim();
  return optionValue.replace(/(\d+(?:[.,]\d+)?)\s+(ml|g|gr|kg|oz|l)\b/gi, "$1$2");
}

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
  salesOriginLabel?: string | null;
  notes?: string | null;
  privacyAccepted?: boolean;
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
    `*Solicitud #${order.orderNumber} recibida*`,
    `Hola ${order.customerName}. Confirma que estos datos sean correctos:`,
    "",
    "*Tus datos*",
    `*Nombre:* ${order.customerName}`,
    `*Teléfono:* ${order.customerPhone}`,
    `*Cédula:* ${order.customerCedula}`,
  ];

  if (order.customerEmail) lines.push(`*Correo:* ${order.customerEmail}`);
  lines.push(
    `*Entrega:* ${order.deliveryMethod === "domicilio" ? "Domicilio" : "Recoger en tienda"}`
  );
  if (order.locationName) lines.push(`*Sede:* ${order.locationName}`);
  if (order.address) lines.push(`*Dirección:* ${order.address}`);
  if (order.neighborhood) lines.push(`*Barrio:* ${order.neighborhood}`);
  if (order.addressDetails) lines.push(`*Indicaciones:* ${order.addressDetails}`);
  if (order.city || order.department) {
    lines.push(`*Ciudad / departamento:* ${[order.city, order.department].filter(Boolean).join(", ")}`);
  }

  lines.push("", "*Productos*");
  for (const item of order.items) {
    const label = item.variantLabel
      ? `${item.productName} (${item.variantLabel})`
      : item.productName;
    lines.push(`• ${label} ×${item.quantity}: *${formatCOP(item.subtotal)}*`);
  }
  lines.push(`*Subtotal:* ${formatCOP(order.subtotal)}`);
  if (order.notes) lines.push(`*Notas:* ${order.notes}`);

  if (order.deliveryMethod === "domicilio") {
    lines.push(
      "",
      `_El domicilio se cotiza aparte. Aplica para productos desde ${formatCOP(DELIVERY_MINIMUM_SUBTOTAL)}; fuera de Bogotá o Soacha se cotiza transportadora._`
    );
  }

  lines.push(
    "",
    "Revisa la información. Si encuentras un error, respóndenos por este chat.",
    "Un asesor confirmará disponibilidad y te enviará la cotización final."
  );
  return lines.join("\n");
}

export function buildOperationalOrderAlert(order: OrderMessageInput): string {
  const lines = [
    `Nuevo pedido #${order.orderNumber}`,
    `Proveniencia: ${order.salesOriginLabel || "Catálogo virtual"}`,
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
  if (order.privacyAccepted) {
    lines.push("", `Tratamiento de datos: Aceptado (${DATA_POLICY_URL})`);
  }
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
  deliveryFee: number,
  quoteNote?: string | null
): string {
  const availableItems = items.filter((item) => item.available);
  const unavailableItems = items.filter((item) => !item.available);
  const subtotal = availableItems.reduce((sum, item) => sum + item.subtotal, 0);
  const total = subtotal + deliveryFee;
  const lines = [
    `*Cotización solicitud #${order.order_number}*`,
    "",
    "*Datos del cliente*",
    `*Cliente:* ${order.customer_name}`,
    `*Teléfono:* ${order.customer_phone}`,
    `*Cédula:* ${order.customer_cedula}`,
  ];

  if (order.customer_email) lines.push(`*Correo:* ${order.customer_email}`);
  lines.push(
    "",
    "*Datos de entrega*",
    `*Modalidad:* ${order.delivery_method === "domicilio" ? "Domicilio" : "Recoger en tienda"}`
  );
  if (order.location_name_snapshot) lines.push(`*Sede:* ${order.location_name_snapshot}`);
  if (order.address) lines.push(`*Dirección:* ${order.address}`);
  if (order.neighborhood) lines.push(`*Barrio:* ${order.neighborhood}`);
  if (order.address_details) lines.push(`*Indicaciones:* ${order.address_details}`);
  if (order.city || order.department) {
    lines.push(`*Ciudad / departamento:* ${[order.city, order.department].filter(Boolean).join(", ")}`);
  }

  if (availableItems.length > 0) {
    lines.push("", "*Productos disponibles*");
    for (const item of availableItems) {
      const variantLabel = compactVariantLabel(item.variant_label);
      const label = variantLabel
        ? `${item.product_name} (${variantLabel})`
        : item.product_name;
      lines.push(`- ${label} ×${item.quantity}: ${formatQuotePrice(item.subtotal)}`);
    }
  }

  if (unavailableItems.length > 0) {
    lines.push("", "*Productos no disponibles*");
    for (const item of unavailableItems) {
      const variantLabel = compactVariantLabel(item.variant_label);
      const label = variantLabel
        ? `${item.product_name} (${variantLabel})`
        : item.product_name;
      lines.push(`- ${label} ×${item.quantity}`);
    }
  }

  if (order.delivery_method === "domicilio") {
    lines.push(
      "",
      "*Resumen de valores*",
      `Productos: ${formatQuotePrice(subtotal)}`,
      `Domicilio: ${formatQuotePrice(deliveryFee)}`,
      `*Total: ${formatQuotePrice(total)}*`
    );
  } else {
    lines.push("", `*Total: ${formatQuotePrice(total)}*`);
  }
  if (quoteNote) lines.push("", "*Notas de la cotización*", quoteNote);
  lines.push("", "_Si no ves los botones, responde APROBAR o RECHAZAR._");
  return sanitizeInteractiveMessageText(lines.join("\n"));
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
  salesOriginLabel?: string | null;
  notes?: string | null;
  privacyAccepted?: boolean;
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
    `Proveniencia: ${order.salesOriginLabel || "Catálogo virtual"}`,
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
  if (order.privacyAccepted) {
    lines.push("", `Tratamiento de datos: Aceptado (${DATA_POLICY_URL})`);
  }
  return lines.join("\n");
}
