import type { SupabaseClient } from "@supabase/supabase-js";
import {
  triggerCrmNewOrderNotificationWorkflow,
  triggerCrmOrdersGroupWorkflow,
  upsertCrmContact,
} from "@/lib/crm";
import { buildStructuredQuoteMessage } from "@/lib/messaging";
import type { DeliveryMethod, OrderQuoteItem } from "@/lib/types";

/** Contacto de Órbita del grupo "Domicilio Órganic"; ORBITA_ORDERS_GROUP_CONTACT_ID lo reemplaza. */
const DEFAULT_ORDERS_GROUP_CONTACT_ID = "72jZuNAuZrzHccn5JWir";

export interface AcceptedQuoteOrder {
  id: string;
  order_number: number;
  customer_name: string;
  customer_cedula: string;
  customer_phone: string;
  customer_email?: string | null;
  delivery_method: DeliveryMethod;
  address?: string | null;
  neighborhood?: string | null;
  address_details?: string | null;
  city?: string | null;
  department?: string | null;
  location_name_snapshot?: string | null;
  location_whatsapp_snapshot?: string | null;
  quote_message?: string | null;
  sales_origin_location_id?: string | null;
  quote_items?: OrderQuoteItem[] | null;
  quote_delivery_fee?: number | string | null;
}

function normalizeLocationName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sedes que reciben sus pedidos directamente, también los de domicilio que
 * llegan por su línea. Por defecto, la sede 20 de Julio.
 */
export function isDirectNotificationLocation(name: string | null | undefined) {
  if (!name) return false;
  const configured = process.env.ORBITA_DIRECT_NOTIFICATION_LOCATIONS?.trim() || "20 de julio";
  const normalizedName = normalizeLocationName(name);
  return configured
    .split(",")
    .map(normalizeLocationName)
    .some((candidate) => candidate && normalizedName.includes(candidate));
}

/**
 * "Cotización aprobada por el cliente" seguido del mismo mensaje de la cotización
 * que aceptó, con todos sus datos, sin la instrucción de responder APROBAR o
 * RECHAZAR. Si el pedido se aceptó sin cotización enviada, se arma con el mismo
 * formato a partir de lo solicitado.
 */
async function buildAcceptedQuoteMessage(order: AcceptedQuoteOrder, supabase: SupabaseClient) {
  return `${ACCEPTED_QUOTE_HEADING}\n\n${await buildQuoteBody(order, supabase)}`;
}

const ACCEPTED_QUOTE_HEADING = "*✅ Cotización aprobada por el cliente*";

async function buildQuoteBody(order: AcceptedQuoteOrder, supabase: SupabaseClient) {
  const sentQuote = order.quote_message?.trim();
  if (sentQuote) {
    return sentQuote
      .split("\n")
      .filter((line) => !/responde\s+APROBAR\s+o\s+RECHAZAR/i.test(line))
      .join("\n")
      .trim();
  }

  let items: OrderQuoteItem[] = Array.isArray(order.quote_items) ? order.quote_items : [];
  let deliveryFee = Number(order.quote_delivery_fee ?? 0);
  if (items.length === 0) {
    deliveryFee = 0;
    const { data } = await supabase
      .from("order_items")
      .select("product_id, variant_id, product_name_snapshot, variant_label_snapshot, quantity, unit_price, subtotal")
      .eq("order_id", order.id);
    items = (data ?? []).map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id,
      product_name: item.product_name_snapshot,
      variant_label: item.variant_label_snapshot,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal),
      available: true,
    }));
  }
  const quoteNote = items.find((item) => item.quote_note)?.quote_note ?? null;

  return buildStructuredQuoteMessage(
    {
      order_number: order.order_number,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      customer_cedula: order.customer_cedula,
      customer_email: order.customer_email ?? null,
      delivery_method: order.delivery_method,
      address: order.address ?? null,
      neighborhood: order.neighborhood ?? null,
      address_details: order.address_details ?? null,
      city: order.city ?? null,
      department: order.department ?? null,
      location_name_snapshot: order.location_name_snapshot ?? null,
    },
    items,
    deliveryFee,
    quoteNote,
    { closingLines: [] }
  );
}

async function notifyLocation(name: string, phone: string, message: string) {
  const contactId = await upsertCrmContact({
    name: `Sede ${name}`,
    phone,
    source: "Alertas operativas - catálogo virtual",
  });
  await triggerCrmNewOrderNotificationWorkflow(contactId, message);
}

/**
 * Avisa quién debe preparar un pedido con cotización aceptada:
 * - Recoger: la sede elegida.
 * - Domicilio que llegó por la línea de una sede directa (20 de Julio): esa sede.
 * - Resto de domicilios: el grupo de WhatsApp de domicilios.
 * Devuelve a quién se avisó.
 */
export async function notifyAcceptedQuote(
  order: AcceptedQuoteOrder,
  supabase: SupabaseClient
): Promise<string> {
  const message = await buildAcceptedQuoteMessage(order, supabase);

  if (order.delivery_method !== "domicilio") {
    const phone = order.location_whatsapp_snapshot?.trim();
    const name = order.location_name_snapshot?.trim();
    if (!phone || !name) {
      throw new Error("El pedido para recoger no tiene una sede con WhatsApp para avisar.");
    }
    await notifyLocation(name, phone, message);
    return `sede ${name}`;
  }

  if (order.sales_origin_location_id) {
    const { data: origin } = await supabase
      .from("store_locations")
      .select("name, whatsapp_number")
      .eq("id", order.sales_origin_location_id)
      .maybeSingle();
    if (origin?.whatsapp_number && isDirectNotificationLocation(origin.name)) {
      await notifyLocation(origin.name, origin.whatsapp_number, message);
      return `sede ${origin.name}`;
    }
  }

  const groupContactId =
    process.env.ORBITA_ORDERS_GROUP_CONTACT_ID?.trim() || DEFAULT_ORDERS_GROUP_CONTACT_ID;
  await triggerCrmOrdersGroupWorkflow(groupContactId, message);
  return "grupo de domicilios";
}
