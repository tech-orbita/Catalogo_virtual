import type { SupabaseClient } from "@supabase/supabase-js";
import {
  triggerCrmNewOrderNotificationWorkflow,
  triggerCrmOrdersGroupWorkflow,
  upsertCrmContact,
} from "@/lib/crm";

/** Contacto de Órbita del grupo "Domicilio Órganic"; ORBITA_ORDERS_GROUP_CONTACT_ID lo reemplaza. */
const DEFAULT_ORDERS_GROUP_CONTACT_ID = "72jZuNAuZrzHccn5JWir";

export interface AcceptedQuoteOrder {
  order_number: number | string;
  customer_name: string;
  customer_cedula: string;
  customer_phone: string;
  total: number | string;
  delivery_method: string;
  location_name_snapshot?: string | null;
  location_whatsapp_snapshot?: string | null;
  sales_origin_location_id?: string | null;
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

function buildAcceptedQuoteMessage(order: AcceptedQuoteOrder) {
  return [
    `Cotización aceptada #${order.order_number}`,
    `Cliente: ${order.customer_name}`,
    `Cédula: ${order.customer_cedula}`,
    `Teléfono: ${order.customer_phone}`,
    `Total: ${Number(order.total).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}`,
    `Entrega: ${order.delivery_method === "domicilio" ? "Domicilio" : "Recoger en tienda"}`,
    order.location_name_snapshot ? `Sede: ${order.location_name_snapshot}` : null,
    "Revisar facturación y continuar la preparación del pedido.",
  ]
    .filter(Boolean)
    .join("\n");
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
  const message = buildAcceptedQuoteMessage(order);

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
