import { formatCOP } from "@/lib/currency";
import type { DeliveryMethod, OrderQuoteItem, OrderWithItems } from "@/lib/types";

/**
 * Caracteres representables en GSM-7. Cualquier otro (á, í, ó, ú, ¿, …) obliga
 * al operador a codificar el SMS en UCS-2, que reduce el segmento de 153 a 67
 * caracteres. Por eso la cotización se arma en texto plano y sin viñetas.
 */
const GSM7 =
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
  "\n\r";
const GSM7_EXTENDED = "^{}\\[~]|€";

/**
 * Tope de la cotizacion. La mayoria de operadores rechaza concatenaciones de
 * mas de 10 segmentos; con acentos (UCS-2) eso son ~670 caracteres, asi que
 * 1600 deja margen para textos sin acentos y sigue siendo un limite sensato.
 */
export const SMS_MAX_LENGTH = 1600;
export const QUOTE_SUMMARY_MAX_LENGTH = 1600;

export interface SmsCost {
  characters: number;
  encoding: "GSM-7" | "UCS-2";
  segments: number;
}

/** Cuenta caracteres y segmentos para que el asesor vea el costo antes de enviar. */
export function estimateSmsCost(message: string): SmsCost {
  let units = 0;
  let isGsm7 = true;

  for (const char of message) {
    if (GSM7.includes(char)) {
      units += 1;
    } else if (GSM7_EXTENDED.includes(char)) {
      units += 2;
    } else {
      isGsm7 = false;
      break;
    }
  }

  const characters = [...message].length;
  if (!isGsm7) {
    const segments = characters === 0 ? 0 : characters <= 70 ? 1 : Math.ceil(characters / 67);
    return { characters, encoding: "UCS-2", segments };
  }

  const segments = units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153);
  return { characters, encoding: "GSM-7", segments };
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
  lines.push("Responde este mensaje si deseas continuar.");
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
  lines.push("", `Entrega: ${order.delivery_method === "domicilio" ? "Domicilio" : "Recoger en tienda"}`);
  if (order.location_name_snapshot) lines.push(`Sede: ${order.location_name_snapshot}`);
  if (order.address) lines.push(`Dirección: ${order.address}`);
  if (order.address_details) lines.push(`Detalles: ${order.address_details}`);
  if (order.city || order.department) lines.push(`Ciudad: ${[order.city, order.department].filter(Boolean).join(", ")}`);

  if (availableItems.length > 0) {
    lines.push("", "Productos disponibles:");
    for (const item of availableItems) {
      const label = item.variant_label ? `${item.product_name} (${item.variant_label})` : item.product_name;
      lines.push(`- ${label} · ${item.quantity} x ${formatCOP(item.unit_price)} = ${formatCOP(item.subtotal)}`);
    }
  }

  if (unavailableItems.length > 0) {
    lines.push("", "Productos no disponibles:");
    for (const item of unavailableItems) {
      const label = item.variant_label ? `${item.product_name} (${item.variant_label})` : item.product_name;
      lines.push(`- ${label}`);
    }
  }

  lines.push("", `Subtotal productos: ${formatCOP(subtotal)}`);
  if (order.delivery_method === "domicilio") lines.push(`Domicilio: ${formatCOP(deliveryFee)}`);
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
  if (order.addressDetails) lines.push(`Detalles: ${order.addressDetails}`);
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
