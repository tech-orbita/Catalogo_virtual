import { CrmConfigurationError, triggerCrmNewOrderNotificationWorkflow } from "@/lib/crm";

export interface AcceptedQuoteOrder {
  order_number: number | string;
  customer_name: string;
  customer_cedula: string;
  customer_phone: string;
  total: number | string;
  delivery_method: string;
  location_name_snapshot?: string | null;
}

/**
 * Envía el pedido aceptado al grupo de WhatsApp de domicilios mediante el mismo
 * workflow de notificación de pedidos. El grupo es un contacto de Órbita.
 */
export async function notifyAcceptedQuoteToOrdersGroup(order: AcceptedQuoteOrder) {
  const groupContactId = process.env.ORBITA_ORDERS_GROUP_CONTACT_ID?.trim();
  if (!groupContactId) {
    throw new CrmConfigurationError(
      "Configura ORBITA_ORDERS_GROUP_CONTACT_ID con el contacto del grupo de domicilios en Órbita."
    );
  }
  await triggerCrmNewOrderNotificationWorkflow(
    groupContactId,
    [
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
      .join("\n")
  );
}
