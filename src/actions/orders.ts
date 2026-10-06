"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeCatalogName } from "@/lib/catalog-name";
import {
  createCrmContactNote,
  CrmConfigurationError,
  sendCrmQuoteMessage,
  syncCrmOrderCreatedOpportunities,
  syncCrmProductOpportunityStage,
  upsertCrmContact,
} from "@/lib/crm";
import { buildOrderCrmNote, SMS_MAX_LENGTH } from "@/lib/messaging";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type CartItem,
  type DeliveryMethod,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/types";

export interface CreateOrderInput {
  customerName: string;
  customerCedula: string;
  customerPhone: string;
  customerEmail?: string;
  locationId?: string;
  deliveryMethod: DeliveryMethod;
  address?: string;
  addressDetails?: string;
  city?: string;
  department?: string;
  notes?: string;
  items: CartItem[];
}

export interface ManualOrderItemInput {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
}

export interface CreateManualOrderInput extends Omit<CreateOrderInput, "items"> {
  items: ManualOrderItemInput[];
}

export interface CreateOrderResult {
  orderId: string;
  orderNumber: number;
  subtotal: number;
  locationName: string | null;
  locationAddress: string | null;
  crmSynced: boolean;
  warning?: string;
}

interface ResolvedOrderItem {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

type CrmSyncState = {
  contactId: string | null;
  status: "sin_configurar" | "sincronizado" | "error";
  error: string | null;
};

type ValidatedLocation = {
  id: string;
  name: string;
  address: string | null;
};

const ORDER_STATUSES = new Set(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]);
const PAYMENT_STATUSES = new Set(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function joinWarnings(...warnings: Array<string | null | undefined>) {
  const messages = warnings.filter((warning): warning is string => Boolean(warning));
  return messages.length > 0 ? messages.join(" ") : undefined;
}

async function syncCreatedOrderOpportunities(input: {
  contactId: string | null;
  orderNumber: number;
  total: number;
  includeAgentPipeline: boolean;
}) {
  if (!input.contactId) return null;
  try {
    if (input.includeAgentPipeline) {
      await syncCrmOrderCreatedOpportunities({
        contactId: input.contactId,
        orderNumber: input.orderNumber,
        total: input.total,
      });
    } else {
      await syncCrmProductOpportunityStage({
        contactId: input.contactId,
        orderNumber: input.orderNumber,
        total: input.total,
        stage: "pedido_realizado",
      });
    }
    return null;
  } catch (error) {
    return `El pedido se guardó, pero no se pudieron sincronizar sus oportunidades: ${errorMessage(error)}`;
  }
}

function validateCustomer(input: Omit<CreateOrderInput, "items">): string | null {
  if (!input.customerName.trim()) return "El nombre es obligatorio.";
  if (!input.customerCedula.trim()) return "La cédula es obligatoria.";
  if (!input.customerPhone.trim()) return "El teléfono es obligatorio.";
  if (input.customerEmail?.trim() && !/^\S+@\S+\.\S+$/.test(input.customerEmail.trim())) {
    return "El correo electrónico no es válido.";
  }
  if (input.deliveryMethod === "domicilio" && !input.address?.trim()) {
    return "La dirección es obligatoria para domicilio.";
  }
  return null;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function validateLocationSelection(
  locationId: string | undefined,
  options: { allowInactive: boolean; requireWhenAvailable: boolean }
): Promise<{ location: ValidatedLocation | null } | { error: string }> {
  const supabase = await createClient();

  if (locationId) {
    const { data, error } = await supabase
      .from("store_locations")
      .select("id, name, address, active")
      .eq("id", locationId)
      .maybeSingle();

    if (error) return { error: error.message };
    if (!data || (!options.allowInactive && !data.active)) {
      return { error: "La sede seleccionada no está disponible." };
    }

    return { location: { id: data.id, name: data.name, address: data.address } };
  }

  if (options.requireWhenAvailable) {
    const { count, error } = await supabase
      .from("store_locations")
      .select("id", { count: "exact", head: true })
      .eq("active", true);
    if (error) return { error: error.message };
    if ((count ?? 0) > 0) return { error: "Selecciona una sede para continuar." };
  }

  return { location: null };
}

async function resolveItems(
  items: Array<{ productId: string; variantId: string | null; quantity: number; unitPrice?: number }>,
  allowAdvisorPrice: boolean
): Promise<{ items: ResolvedOrderItem[] } | { error: string }> {
  if (items.length === 0) return { error: "El pedido no tiene productos." };
  if (items.length > 100) return { error: "El pedido supera el máximo de 100 líneas." };

  const productIds = [...new Set(items.map((item) => item.productId).filter(Boolean))];
  if (productIds.length === 0) return { error: "Selecciona al menos un producto válido." };

  const supabase = await createClient();
  const [{ data: products, error: productsError }, { data: variants, error: variantsError }] =
    await Promise.all([
      supabase.from("products").select("id, name, price, active").in("id", productIds),
      supabase
        .from("product_variants")
        .select("id, product_id, variant_name, option_value, price_override")
        .in("product_id", productIds),
    ]);

  if (productsError || variantsError) {
    return { error: productsError?.message ?? variantsError?.message ?? "No se pudo validar el catálogo." };
  }

  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const variantById = new Map((variants ?? []).map((variant) => [variant.id, variant]));
  const productsWithVariants = new Set((variants ?? []).map((variant) => variant.product_id));
  const resolved: ResolvedOrderItem[] = [];

  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product || (!allowAdvisorPrice && !product.active)) {
      return { error: "Uno de los productos ya no está disponible en el catálogo." };
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      return { error: `La cantidad de ${product.name} no es válida.` };
    }

    const variant = item.variantId ? variantById.get(item.variantId) : null;
    if (item.variantId && (!variant || variant.product_id !== product.id)) {
      return { error: `La variante seleccionada de ${product.name} no es válida.` };
    }
    if (!item.variantId && productsWithVariants.has(product.id)) {
      return { error: `Selecciona una variante para ${product.name}.` };
    }

    const catalogPrice = Number(variant?.price_override ?? product.price);
    const advisorPrice = Number(item.unitPrice);
    const unitPrice = allowAdvisorPrice ? advisorPrice : catalogPrice;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return { error: `El precio de ${product.name} no es válido.` };
    }

    resolved.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      productName: normalizeCatalogName(product.name),
      variantLabel: variant ? `${variant.variant_name}: ${variant.option_value}` : null,
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity,
    });
  }

  return { items: resolved };
}

async function prepareCrmContact(
  input: Omit<CreateOrderInput, "items">,
  source: "catalogo" | "asesor"
): Promise<CrmSyncState> {
  try {
    const contactId = await upsertCrmContact({
      name: input.customerName,
      email: input.customerEmail,
      phone: input.customerPhone,
      cedula: input.customerCedula,
      address: [input.address, input.addressDetails].filter(Boolean).join(", ") || null,
      city: input.city,
      department: input.department,
      source: source === "asesor" ? "Catálogo virtual - asesor" : "Catálogo virtual - web",
    });
    return { contactId, status: "sincronizado", error: null };
  } catch (error) {
    return {
      contactId: null,
      status: error instanceof CrmConfigurationError ? "sin_configurar" : "error",
      error: errorMessage(error).slice(0, 500),
    };
  }
}

function toRpcItems(items: ResolvedOrderItem[]) {
  return items.map((item) => ({
    product_id: item.productId,
    variant_id: item.variantId,
    product_name_snapshot: item.productName,
    variant_label_snapshot: item.variantLabel,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    subtotal: item.subtotal,
  }));
}

function buildRpcInput(
  input: Omit<CreateOrderInput, "items">,
  items: ResolvedOrderItem[],
  crm: CrmSyncState
) {
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return {
    p_customer_name: input.customerName.trim(),
    p_customer_cedula: input.customerCedula.trim(),
    p_customer_phone: input.customerPhone.trim(),
    p_customer_email: input.customerEmail?.trim() || "",
    p_delivery_method: input.deliveryMethod,
    p_address: input.address?.trim() || null,
    p_address_details: input.addressDetails?.trim() || null,
    p_city: input.city?.trim() || null,
    p_department: input.department?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_subtotal: subtotal,
    p_total: subtotal,
    p_location_id: input.locationId || null,
    p_ghl_contact_id: crm.contactId,
    p_ghl_sync_status: crm.status,
    p_ghl_sync_error: crm.error,
    p_items: toRpcItems(items),
  };
}

async function attachOrderNote(input: {
  contactId: string | null;
  orderNumber: number;
  source: "catalogo" | "asesor";
  customer: Omit<CreateOrderInput, "items">;
  locationName: string | null;
  items: ResolvedOrderItem[];
  subtotal: number;
}) {
  if (!input.contactId) return null;

  try {
    await createCrmContactNote(
      input.contactId,
      `Solicitud #${input.orderNumber} - pendiente por cotizar`,
      buildOrderCrmNote({
        orderNumber: input.orderNumber,
        source: input.source,
        customerName: input.customer.customerName,
        customerEmail: input.customer.customerEmail,
        customerCedula: input.customer.customerCedula,
        customerPhone: input.customer.customerPhone,
        deliveryMethod: input.customer.deliveryMethod,
        address: input.customer.address,
        addressDetails: input.customer.addressDetails,
        city: input.customer.city,
        department: input.customer.department,
        locationName: input.locationName,
        notes: input.customer.notes,
        items: input.items.map((item) => ({
          productName: item.productName,
          variantLabel: item.variantLabel,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        })),
        subtotal: input.subtotal,
        total: input.subtotal,
      })
    );
    return null;
  } catch {
    return "El contacto se sincronizó, pero el resumen del pedido no pudo agregarse al CRM.";
  }
}

export async function createOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult | { error: string }> {
  const validationError = validateCustomer(input);
  if (validationError) return { error: validationError };

  const resolved = await resolveItems(input.items, false);
  if ("error" in resolved) return resolved;

  const locationResult = await validateLocationSelection(input.locationId, {
    allowInactive: false,
    requireWhenAvailable: true,
  });
  if ("error" in locationResult) return locationResult;

  const customerInput: Omit<CreateOrderInput, "items"> = input;
  const crm = await prepareCrmContact(customerInput, "catalogo");
  const rpcInput = buildRpcInput(customerInput, resolved.items, crm);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_order_with_items", rpcInput);

  if (error || !data || data.length === 0) {
    return { error: error?.message ?? "No se pudo crear el pedido." };
  }

  const order = data[0];
  const noteWarning = await attachOrderNote({
    contactId: crm.contactId,
    orderNumber: order.order_number,
    source: "catalogo",
    customer: customerInput,
    locationName: order.location_name ?? null,
    items: resolved.items,
    subtotal: rpcInput.p_subtotal,
  });
  const opportunityWarning = await syncCreatedOrderOpportunities({
    contactId: crm.contactId,
    orderNumber: order.order_number,
    total: rpcInput.p_subtotal,
    includeAgentPipeline: true,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    subtotal: rpcInput.p_subtotal,
    locationName: order.location_name ?? null,
    locationAddress: order.location_address ?? null,
    crmSynced: crm.status === "sincronizado",
    warning: joinWarnings(crm.error, noteWarning, opportunityWarning),
  };
}

export async function createManualOrder(
  input: CreateManualOrderInput
): Promise<CreateOrderResult | { error: string }> {
  const { supabase, user } = await requireAdmin();
  if (!user) return { error: "No autorizado." };

  const validationError = validateCustomer(input);
  if (validationError) return { error: validationError };

  const resolved = await resolveItems(input.items, true);
  if ("error" in resolved) return resolved;

  const locationResult = await validateLocationSelection(input.locationId, {
    allowInactive: true,
    requireWhenAvailable: false,
  });
  if ("error" in locationResult) return locationResult;

  const customerInput: Omit<CreateOrderInput, "items"> = input;
  const crm = await prepareCrmContact(customerInput, "asesor");
  const rpcInput = buildRpcInput(customerInput, resolved.items, crm);
  const { data, error } = await supabase.rpc("admin_create_order_with_items", rpcInput);

  if (error || !data || data.length === 0) {
    return { error: error?.message ?? "No se pudo crear el pedido manual." };
  }

  const order = data[0];
  const location = locationResult.location;
  const noteWarning = await attachOrderNote({
    contactId: crm.contactId,
    orderNumber: order.order_number,
    source: "asesor",
    customer: customerInput,
    locationName: location?.name ?? null,
    items: resolved.items,
    subtotal: rpcInput.p_subtotal,
  });
  const opportunityWarning = await syncCreatedOrderOpportunities({
    contactId: crm.contactId,
    orderNumber: order.order_number,
    total: rpcInput.p_subtotal,
    includeAgentPipeline: false,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    subtotal: rpcInput.p_subtotal,
    locationName: location?.name ?? null,
    locationAddress: location?.address ?? null,
    crmSynced: crm.status === "sincronizado",
    warning: joinWarnings(crm.error, noteWarning, opportunityWarning),
  };
}

export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  if (!ORDER_STATUSES.has(status)) return { error: "Estado de pedido inválido." };
  const { supabase, user } = await requireAdmin();
  if (!user) return { error: "No autorizado." };

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) return { error: orderError?.message ?? "El pedido no existe." };

  const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
  if (error) return { error: error.message };

  try {
    let contactId = order.ghl_contact_id as string | null;
    if (!contactId) {
      contactId = await upsertCrmContact({
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
        cedula: order.customer_cedula,
        address: [order.address, order.address_details].filter(Boolean).join(", ") || null,
        city: order.city,
        department: order.department,
        source: order.order_source === "asesor" ? "Catálogo virtual - asesor" : "Catálogo virtual - web",
      });
    }

    await syncCrmProductOpportunityStage({
      contactId,
      orderNumber: order.order_number,
      total: Number(order.total),
      stage: status,
    });
    await supabase
      .from("orders")
      .update({
        ghl_contact_id: contactId,
        ghl_sync_status: "sincronizado",
        ghl_sync_error: null,
        ghl_synced_at: new Date().toISOString(),
      })
      .eq("id", orderId);
  } catch (syncError) {
    const warning = `El estado local cambió, pero el CRM no se pudo sincronizar: ${errorMessage(syncError)}`;
    await supabase
      .from("orders")
      .update({ ghl_sync_status: "error", ghl_sync_error: warning.slice(0, 500) })
      .eq("id", orderId);
    revalidatePath("/admin");
    revalidatePath("/admin/pedidos");
    revalidatePath(`/admin/pedidos/${orderId}`);
    return { success: true, warning };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath(`/admin/pedidos/${orderId}`);
  return { success: true };
}

export async function updatePaymentStatus(orderId: string, paymentStatus: PaymentStatus) {
  if (!PAYMENT_STATUSES.has(paymentStatus)) return { error: "Estado de pago inválido." };
  const { supabase, user } = await requireAdmin();
  if (!user) return { error: "No autorizado." };

  const { error } = await supabase
    .from("orders")
    .update({ payment_status: paymentStatus })
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/pedidos/${orderId}`);
  return { success: true };
}

export async function sendOrderQuote(orderId: string, message: string) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) return { error: "Escribe el mensaje de la cotización." };
  if (trimmedMessage.length > SMS_MAX_LENGTH) {
    return {
      error: `El mensaje de la cotización no puede superar ${SMS_MAX_LENGTH} caracteres.`,
    };
  }

  const { supabase, user } = await requireAdmin();
  if (!user) return { error: "No autorizado." };

  const [{ data: order, error: orderError }, { data: items }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
    supabase.from("order_items").select("*").eq("order_id", orderId),
  ]);

  if (orderError || !order) return { error: orderError?.message ?? "El pedido no existe." };
  if (!["pedido_realizado", "cotizacion_enviada"].includes(order.status)) {
    return { error: "Solo puedes cotizar pedidos pendientes o reenviar una cotización." };
  }
  if (!items || items.length === 0) return { error: "El pedido no tiene productos para cotizar." };

  let contactId: string;
  try {
    contactId = await upsertCrmContact({
      name: order.customer_name,
      email: order.customer_email,
      phone: order.customer_phone,
      cedula: order.customer_cedula,
      address: [order.address, order.address_details].filter(Boolean).join(", ") || null,
      city: order.city,
      department: order.department,
      source: order.order_source === "asesor" ? "Catálogo virtual - asesor" : "Catálogo virtual - web",
    });
  } catch (error) {
    const message = errorMessage(error).slice(0, 500);
    await supabase
      .from("orders")
      .update({
        ghl_sync_status: error instanceof CrmConfigurationError ? "sin_configurar" : "error",
        ghl_sync_error: message,
      })
      .eq("id", orderId);
    revalidatePath(`/admin/pedidos/${orderId}`);
    return { error: message };
  }

  try {
    const sent = await sendCrmQuoteMessage(contactId, trimmedMessage);
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: "cotizacion_enviada",
        quote_message: trimmedMessage,
        quote_sent_at: new Date().toISOString(),
        quote_sent_by_email: user.email ?? null,
        ghl_contact_id: contactId,
        ghl_sync_status: "sincronizado",
        ghl_sync_error: null,
        ghl_synced_at: new Date().toISOString(),
        ghl_message_id: sent.messageId,
        ghl_conversation_id: sent.conversationId,
      })
      .eq("id", orderId);

    revalidatePath("/admin");
    revalidatePath("/admin/pedidos");
    revalidatePath(`/admin/pedidos/${orderId}`);

    if (updateError) {
      return {
        success: true,
        warning:
          "La cotización fue enviada, pero no se pudo actualizar su estado local. No la reenvíes sin verificar la conversación en el CRM.",
      };
    }

    try {
      await syncCrmProductOpportunityStage({
        contactId,
        orderNumber: order.order_number,
        total: Number(order.total),
        stage: "cotizacion_enviada",
      });
      return { success: true };
    } catch (syncError) {
      const warning = `La cotización fue enviada, pero la oportunidad no cambió de etapa: ${errorMessage(syncError)}`;
      await supabase
        .from("orders")
        .update({ ghl_sync_status: "error", ghl_sync_error: warning.slice(0, 500) })
        .eq("id", orderId);
      return { success: true, warning };
    }
  } catch (error) {
    const message = errorMessage(error).slice(0, 500);
    await supabase
      .from("orders")
      .update({ ghl_contact_id: contactId, ghl_sync_status: "error", ghl_sync_error: message })
      .eq("id", orderId);
    revalidatePath(`/admin/pedidos/${orderId}`);
    return { error: message };
  }
}
