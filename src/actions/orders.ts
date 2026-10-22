"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeCatalogName } from "@/lib/catalog-name";
import { getDashboardRole } from "@/lib/auth/access";
import {
  createCrmContactNote,
  CrmConfigurationError,
  getCrmContactTags,
  syncCrmOrderCreatedOpportunities,
  syncCrmProductOpportunityStage,
  triggerCrmNewOrderNotificationWorkflow,
  triggerCrmOrderConfirmationWorkflow,
  triggerCrmQuoteWorkflow,
  updateCrmContactById,
  upsertCrmContact,
  normalizePhoneForCrm,
} from "@/lib/crm";
import {
  buildOperationalOrderAlert,
  buildOrderCrmNote,
  buildOrderReceivedMessage,
  buildStructuredQuoteMessage,
  DELIVERY_MINIMUM_SUBTOTAL,
} from "@/lib/messaging";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type CartItem,
  type DeliveryMethod,
  type OrderQuoteItem,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/types";

export interface CreateOrderInput {
  customerName: string;
  customerCedula: string;
  customerPhone: string;
  phoneCountryCode?: string;
  phoneCountryIso?: string;
  customerEmail?: string;
  locationId?: string;
  deliveryMethod: DeliveryMethod;
  address?: string;
  neighborhood?: string;
  addressDetails?: string;
  city?: string;
  department?: string;
  notes?: string;
  privacyAccepted?: boolean;
  items: CartItem[];
}

export interface ManualOrderItemInput {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
}

export interface CreateManualOrderInput extends Omit<CreateOrderInput, "items"> {
  crmContactId?: string;
  items: ManualOrderItemInput[];
}

export interface UpdateOrderCustomerInput {
  customerName: string;
  customerCedula: string;
  customerPhone: string;
  customerEmail?: string;
  address?: string;
  neighborhood?: string;
  addressDetails?: string;
  city?: string;
  department?: string;
}

export interface QuoteOrderItemInput {
  productId: string | null;
  variantId: string | null;
  customName?: string;
  quantity: number;
  unitPrice: number;
  available: boolean;
}

export interface TriggerOrderQuoteWorkflowInput {
  items: QuoteOrderItemInput[];
  deliveryFee: number;
  quoteNote?: string;
}

export type TriggerOrderQuoteWorkflowResult =
  | { error: string }
  | {
      success: true;
      status: "cotizacion_enviada" | "no_hubo_producto";
      workflowMode: "initial" | "resend";
      warning?: string;
    };

export interface CreateOrderResult {
  orderId: string;
  orderNumber: number;
  subtotal: number;
  locationName: string | null;
  locationAddress: string | null;
  crmSynced: boolean;
  customerConfirmationSent: boolean;
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
  whatsappNumber: string;
};

type SalesOrigin = {
  type: "store_location" | "catalogo_virtual";
  locationId: string | null;
  label: string;
};

const ORDER_STATUSES = new Set(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]);
const PAYMENT_STATUSES = new Set(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function isMissingQuoteAttemptsTable(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === "42P01" ||
        error.code === "PGRST205" ||
        error.message?.includes("order_quote_attempts"))
  );
}

function joinWarnings(...warnings: Array<string | null | undefined>) {
  const messages = warnings.filter((warning): warning is string => Boolean(warning));
  return messages.length > 0 ? messages.join(" ") : undefined;
}

async function syncCreatedOrderOpportunities(input: {
  contactId: string | null;
  customerName: string;
  orderNumber: number;
  source: "catalogo" | "manual";
  salesOriginLabel: string;
  total: number;
  includeAgentPipeline: boolean;
}) {
  if (!input.contactId) return null;
  try {
    if (input.includeAgentPipeline) {
      await syncCrmOrderCreatedOpportunities({
        contactId: input.contactId,
        customerName: input.customerName,
        orderNumber: input.orderNumber,
        salesOriginLabel: input.salesOriginLabel,
        total: input.total,
      });
    } else {
      await syncCrmProductOpportunityStage({
        contactId: input.contactId,
        customerName: input.customerName,
        orderNumber: input.orderNumber,
        source: input.source,
        salesOriginLabel: input.salesOriginLabel,
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
  if (input.deliveryMethod === "domicilio" && !input.neighborhood?.trim()) {
    return "El barrio es obligatorio para domicilio.";
  }
  if (input.deliveryMethod === "domicilio" && !input.addressDetails?.trim()) {
    return "Las indicaciones para llegar son obligatorias para domicilio.";
  }
  return null;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user, role: getDashboardRole(user) };
}

async function validateLocationSelection(
  locationId: string | undefined,
  options: { allowInactive: boolean; requireWhenAvailable: boolean }
): Promise<{ location: ValidatedLocation | null } | { error: string }> {
  const supabase = await createClient();

  if (locationId) {
    const { data, error } = await supabase
      .from("store_locations")
      .select("id, name, address, whatsapp_number, active")
      .eq("id", locationId)
      .maybeSingle();

    if (error) return { error: error.message };
    if (!data || (!options.allowInactive && !data.active)) {
      return { error: "La sede seleccionada no está disponible." };
    }

    return {
      location: {
        id: data.id,
        name: data.name,
        address: data.address,
        whatsappNumber: data.whatsapp_number,
      },
    };
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

async function resolveQuoteItems(
  items: QuoteOrderItemInput[]
): Promise<{ items: ResolvedOrderItem[] } | { error: string }> {
  if (items.length === 0) return { error: "La cotización no tiene productos." };
  if (items.length > 100) return { error: "La cotización supera el máximo de 100 líneas." };

  const catalogInputs = items.filter((item) => item.productId !== null) as Array<
    QuoteOrderItemInput & { productId: string }
  >;
  const resolvedCatalog = catalogInputs.length
    ? await resolveItems(catalogInputs, true)
    : { items: [] as ResolvedOrderItem[] };
  if ("error" in resolvedCatalog) return resolvedCatalog;

  const resolved: ResolvedOrderItem[] = [];
  let catalogIndex = 0;
  for (const item of items) {
    if (item.productId !== null) {
      resolved.push(resolvedCatalog.items[catalogIndex]);
      catalogIndex += 1;
      continue;
    }

    const productName = normalizeCatalogName(item.customName ?? "");
    if (!productName || productName.length > 160) {
      return { error: "Escribe un nombre válido para cada producto personalizado." };
    }
    if (item.variantId) {
      return { error: `El producto personalizado ${productName} no puede tener una variante del catálogo.` };
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      return { error: `La cantidad de ${productName} no es válida.` };
    }
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 100_000_000) {
      return { error: `El precio de ${productName} no es válido.` };
    }

    resolved.push({
      productId: "",
      variantId: null,
      productName,
      variantLabel: null,
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity,
    });
  }

  return { items: resolved };
}

async function prepareCrmContact(
  input: Omit<CreateOrderInput, "items">,
  source: "catalogo" | "asesor",
  contactId?: string | null
): Promise<CrmSyncState> {
  try {
    const contactInput = {
      name: input.customerName,
      email: input.customerEmail,
      phone: input.customerPhone,
      countryCallingCode: input.phoneCountryCode,
      countryCode: input.phoneCountryIso,
      cedula: input.customerCedula,
      address: [input.address, input.neighborhood, input.addressDetails].filter(Boolean).join(", ") || null,
      city: input.city,
      department: input.department,
      source: source === "asesor" ? "Catálogo virtual - asesor" : "Catálogo virtual - web",
    };
    const resolvedContactId = contactId
      ? await updateCrmContactById(contactId, contactInput)
      : await upsertCrmContact(contactInput);
    return { contactId: resolvedContactId, status: "sincronizado", error: null };
  } catch (error) {
    return {
      contactId: null,
      status: error instanceof CrmConfigurationError ? "sin_configurar" : "error",
      error: errorMessage(error).slice(0, 500),
    };
  }
}

async function resolveCatalogSalesOrigin(
  contactId: string | null
): Promise<{ origin: SalesOrigin; warning: string | null }> {
  const fallback: SalesOrigin = {
    type: "catalogo_virtual",
    locationId: null,
    label: "Catálogo virtual",
  };
  if (!contactId) return { origin: fallback, warning: null };

  try {
    const tags = await getCrmContactTags(contactId);
    const whatsappTag = [...tags]
      .reverse()
      .find((tag) => /^wa\s*:/i.test(tag.trim()));
    if (!whatsappTag) return { origin: fallback, warning: null };

    const tagPhone = whatsappTag.replace(/^wa\s*:/i, "").trim();
    const normalizedTagPhone = normalizePhoneForCrm(tagPhone);
    if (!normalizedTagPhone) return { origin: fallback, warning: null };

    const supabase = await createClient();
    const { data: locations, error } = await supabase
      .from("store_locations")
      .select("id, name, whatsapp_number");
    if (error) throw error;

    const location = locations?.find(
      (candidate) =>
        normalizePhoneForCrm(candidate.whatsapp_number) === normalizedTagPhone
    );
    if (!location) return { origin: fallback, warning: null };

    return {
      origin: {
        type: "store_location",
        locationId: location.id,
        label: location.name,
      },
      warning: null,
    };
  } catch (error) {
    return {
      origin: fallback,
      warning: `No se pudo consultar la proveniencia en el CRM; se registró Catálogo virtual: ${errorMessage(error)}`,
    };
  }
}

async function resolveDashboardSalesOrigin(
  user: { app_metadata?: Record<string, unknown> },
  selectedLocation: ValidatedLocation | null
): Promise<{ origin: SalesOrigin; warning: string | null }> {
  const fallback: SalesOrigin = {
    type: "catalogo_virtual",
    locationId: null,
    label: "Catálogo virtual",
  };
  const metadataLocationId =
    typeof user.app_metadata?.store_location_id === "string"
      ? user.app_metadata.store_location_id.trim()
      : "";

  if (!metadataLocationId && !selectedLocation) {
    return { origin: fallback, warning: null };
  }
  if (!metadataLocationId && selectedLocation) {
    return {
      origin: {
        type: "store_location",
        locationId: selectedLocation.id,
        label: selectedLocation.name,
      },
      warning: null,
    };
  }

  if (selectedLocation?.id === metadataLocationId) {
    return {
      origin: {
        type: "store_location",
        locationId: selectedLocation.id,
        label: selectedLocation.name,
      },
      warning: null,
    };
  }

  const locationResult = await validateLocationSelection(metadataLocationId, {
    allowInactive: true,
    requireWhenAvailable: false,
  });
  if ("error" in locationResult || !locationResult.location) {
    return {
      origin: fallback,
      warning: "La sede configurada para el usuario no es válida; se registró Catálogo virtual.",
    };
  }

  return {
    origin: {
      type: "store_location",
      locationId: locationResult.location.id,
      label: locationResult.location.name,
    },
    warning: null,
  };
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
  crm: CrmSyncState,
  salesOrigin: SalesOrigin
) {
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return {
    p_customer_name: input.customerName.trim(),
    p_customer_cedula: input.customerCedula.trim(),
    p_customer_phone: input.customerPhone.trim(),
    p_customer_email: input.customerEmail?.trim() || "",
    p_delivery_method: input.deliveryMethod,
    p_address: input.address?.trim() || null,
    p_neighborhood: input.neighborhood?.trim() || null,
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
    p_sales_origin_type: salesOrigin.type,
    p_sales_origin_location_id: salesOrigin.locationId,
    p_sales_origin_label: salesOrigin.label,
    p_items: toRpcItems(items),
  };
}

async function attachOrderNote(input: {
  contactId: string | null;
  orderNumber: number;
  source: "catalogo" | "asesor";
  customer: Omit<CreateOrderInput, "items">;
  locationName: string | null;
  salesOriginLabel: string;
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
        neighborhood: input.customer.neighborhood,
        addressDetails: input.customer.addressDetails,
        city: input.customer.city,
        department: input.customer.department,
        locationName: input.locationName,
        salesOriginLabel: input.salesOriginLabel,
        notes: input.customer.notes,
        privacyAccepted: input.customer.privacyAccepted,
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

async function sendCreatedOrderNotifications(input: {
  contactId: string | null;
  orderNumber: number;
  customer: Omit<CreateOrderInput, "items">;
  location: ValidatedLocation | null;
  salesOriginLabel: string;
  items: ResolvedOrderItem[];
  subtotal: number;
  sendCustomerConfirmation?: boolean;
}) {
  const messageInput = {
    orderNumber: input.orderNumber,
    customerName: input.customer.customerName,
    customerPhone: input.customer.customerPhone,
    customerCedula: input.customer.customerCedula,
    customerEmail: input.customer.customerEmail,
    deliveryMethod: input.customer.deliveryMethod,
    address: input.customer.address,
    neighborhood: input.customer.neighborhood,
    addressDetails: input.customer.addressDetails,
    city: input.customer.city,
    department: input.customer.department,
    locationName: input.location?.name ?? null,
    salesOriginLabel: input.salesOriginLabel,
    notes: input.customer.notes,
    privacyAccepted: input.customer.privacyAccepted,
    items: input.items.map((item) => ({
      productName: item.productName,
      variantLabel: item.variantLabel,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
    })),
    subtotal: input.subtotal,
  };
  const warnings: string[] = [];
  let customerConfirmationSent = false;

  if (input.sendCustomerConfirmation !== false && input.contactId) {
    try {
      await triggerCrmOrderConfirmationWorkflow(
        input.contactId,
        buildOrderReceivedMessage(messageInput)
      );
      customerConfirmationSent = true;
    } catch (error) {
      warnings.push(`No se pudo enviar la confirmación al cliente: ${errorMessage(error)}`);
    }
  } else if (input.sendCustomerConfirmation !== false) {
    warnings.push("No se pudo enviar la confirmación porque el contacto no quedó sincronizado.");
  }

  const operationalRecipient =
    input.customer.deliveryMethod === "domicilio"
      ? {
          name: "Centro logístico domicilios",
          phone: process.env.ORBITA_LOGISTICS_WHATSAPP_NUMBER?.trim() || "3508811341",
        }
      : input.location
        ? { name: `Sede ${input.location.name}`, phone: input.location.whatsappNumber }
        : null;

  if (operationalRecipient) {
    try {
      const operationalContactId = await upsertCrmContact({
        name: operationalRecipient.name,
        phone: operationalRecipient.phone,
        source: "Alertas operativas - catálogo virtual",
      });
      await triggerCrmNewOrderNotificationWorkflow(
        operationalContactId,
        buildOperationalOrderAlert(messageInput)
      );
    } catch (error) {
      warnings.push(`No se pudo enviar el aviso operativo: ${errorMessage(error)}`);
    }
  } else {
    warnings.push("No se pudo determinar el destinatario del aviso operativo.");
  }

  return {
    customerConfirmationSent,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  };
}

export async function createOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult | { error: string }> {
  if (!input.privacyAccepted) {
    return { error: "Debes aceptar la política de tratamiento de datos para continuar." };
  }
  if (!/^\+\d{1,4}$/.test(input.phoneCountryCode?.trim() ?? "")) {
    return { error: "Selecciona un código de país válido para el teléfono." };
  }
  if (!/^[A-Z]{2}$/.test(input.phoneCountryIso?.trim().toUpperCase() ?? "")) {
    return { error: "Selecciona un país válido para el teléfono." };
  }
  const normalizedPhone = normalizePhoneForCrm(input.customerPhone, input.phoneCountryCode);
  if (!/^\+\d{8,15}$/.test(normalizedPhone)) {
    return { error: "El teléfono no es válido para el país seleccionado." };
  }
  const validationError = validateCustomer({ ...input, customerPhone: normalizedPhone });
  if (validationError) return { error: validationError };

  const resolved = await resolveItems(input.items, false);
  if ("error" in resolved) return resolved;

  const subtotal = resolved.items.reduce((sum, item) => sum + item.subtotal, 0);
  if (input.deliveryMethod === "domicilio" && subtotal <= DELIVERY_MINIMUM_SUBTOTAL) {
    return {
      error: `Los pedidos a domicilio deben superar ${DELIVERY_MINIMUM_SUBTOTAL.toLocaleString("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      })} en productos.`,
    };
  }

  const customerInput: Omit<CreateOrderInput, "items"> = {
    ...input,
    customerPhone: normalizedPhone,
    locationId: input.deliveryMethod === "recoger" ? input.locationId : undefined,
  };
  const locationResult = await validateLocationSelection(customerInput.locationId, {
    allowInactive: false,
    requireWhenAvailable: customerInput.deliveryMethod === "recoger",
  });
  if ("error" in locationResult) return locationResult;

  const crm = await prepareCrmContact(customerInput, "catalogo");
  const salesOriginResult = await resolveCatalogSalesOrigin(crm.contactId);
  const salesOrigin = salesOriginResult.origin;
  const rpcInput = buildRpcInput(customerInput, resolved.items, crm, salesOrigin);
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
    salesOriginLabel: salesOrigin.label,
    items: resolved.items,
    subtotal: rpcInput.p_subtotal,
  });
  const opportunityWarning = await syncCreatedOrderOpportunities({
    contactId: crm.contactId,
    customerName: customerInput.customerName,
    orderNumber: order.order_number,
    source: "catalogo",
    salesOriginLabel: salesOrigin.label,
    total: rpcInput.p_subtotal,
    includeAgentPipeline: true,
  });
  const notification = await sendCreatedOrderNotifications({
    contactId: crm.contactId,
    orderNumber: order.order_number,
    customer: customerInput,
    location: locationResult.location,
    salesOriginLabel: salesOrigin.label,
    items: resolved.items,
    subtotal: rpcInput.p_subtotal,
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
    customerConfirmationSent: notification.customerConfirmationSent,
    warning: joinWarnings(
      crm.error,
      salesOriginResult.warning,
      noteWarning,
      opportunityWarning,
      notification.warning
    ),
  };
}

export async function createManualOrder(
  input: CreateManualOrderInput
): Promise<CreateOrderResult | { error: string }> {
  const { supabase, user, role } = await requireAdmin();
  if (!user || (role !== "admin" && role !== "operator")) return { error: "No autorizado." };

  const validationError = validateCustomer(input);
  if (validationError) return { error: validationError };

  const resolved = await resolveItems(input.items, true);
  if ("error" in resolved) return resolved;

  const customerInput: Omit<CreateOrderInput, "items"> = {
    ...input,
    locationId: input.deliveryMethod === "recoger" ? input.locationId : undefined,
  };
  const locationResult = await validateLocationSelection(customerInput.locationId, {
    allowInactive: true,
    requireWhenAvailable: customerInput.deliveryMethod === "recoger",
  });
  if ("error" in locationResult) return locationResult;

  const crm = await prepareCrmContact(customerInput, "asesor", input.crmContactId);
  const salesOriginResult = await resolveDashboardSalesOrigin(user, locationResult.location);
  const salesOrigin = salesOriginResult.origin;
  const rpcInput = buildRpcInput(customerInput, resolved.items, crm, salesOrigin);
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
    salesOriginLabel: salesOrigin.label,
    items: resolved.items,
    subtotal: rpcInput.p_subtotal,
  });
  const opportunityWarning = await syncCreatedOrderOpportunities({
    contactId: crm.contactId,
    customerName: customerInput.customerName,
    orderNumber: order.order_number,
    source: "manual",
    salesOriginLabel: salesOrigin.label,
    total: rpcInput.p_subtotal,
    includeAgentPipeline: false,
  });
  const notification = await sendCreatedOrderNotifications({
    contactId: crm.contactId,
    orderNumber: order.order_number,
    customer: customerInput,
    location,
    salesOriginLabel: salesOrigin.label,
    items: resolved.items,
    subtotal: rpcInput.p_subtotal,
    sendCustomerConfirmation: false,
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
    customerConfirmationSent: false,
    warning: joinWarnings(
      crm.error,
      salesOriginResult.warning,
      noteWarning,
      opportunityWarning,
      notification.warning
    ),
  };
}

export async function updateOrderCustomer(orderId: string, input: UpdateOrderCustomerInput) {
  const { supabase, user, role } = await requireAdmin();
  if (!user || role !== "admin") return { error: "No autorizado." };

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) return { error: orderError?.message ?? "El pedido no existe." };

  const normalizedPhone = normalizePhoneForCrm(input.customerPhone);
  const customerInput: Omit<CreateOrderInput, "items"> = {
    ...input,
    customerPhone: normalizedPhone,
    deliveryMethod: order.delivery_method,
    locationId: order.location_id ?? undefined,
  };
  const validationError = validateCustomer(customerInput);
  if (validationError) return { error: validationError };

  const customerUpdate = {
    customer_name: customerInput.customerName.trim(),
    customer_cedula: customerInput.customerCedula.trim(),
    customer_phone: customerInput.customerPhone,
    customer_email: customerInput.customerEmail?.trim() || null,
    address: customerInput.address?.trim() || null,
    neighborhood: customerInput.neighborhood?.trim() || null,
    address_details: customerInput.addressDetails?.trim() || null,
    city: customerInput.city?.trim() || null,
    department: customerInput.department?.trim() || null,
  };
  const { error: updateError } = await supabase
    .from("orders")
    .update(customerUpdate)
    .eq("id", orderId);
  if (updateError) return { error: updateError.message };

  try {
    const crmInput = {
      name: customerInput.customerName,
      email: customerInput.customerEmail,
      phone: customerInput.customerPhone,
      cedula: customerInput.customerCedula,
      address:
        [customerInput.address, customerInput.neighborhood, customerInput.addressDetails]
          .filter(Boolean)
          .join(", ") || null,
      city: customerInput.city,
      department: customerInput.department,
      source:
        order.order_source === "asesor"
          ? "Catálogo virtual - asesor"
          : "Catálogo virtual - web",
    };
    const contactId = order.ghl_contact_id
      ? await updateCrmContactById(order.ghl_contact_id, crmInput, {
          clearMissingFields: true,
        })
      : await upsertCrmContact(crmInput);
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
    const warning = `Los datos del pedido se actualizaron, pero el contacto del CRM no se pudo sincronizar: ${errorMessage(syncError)}`;
    await supabase
      .from("orders")
      .update({ ghl_sync_status: "error", ghl_sync_error: warning.slice(0, 500) })
      .eq("id", orderId);
    revalidatePath("/admin/pedidos");
    revalidatePath(`/admin/pedidos/${orderId}`);
    return { success: true, warning };
  }

  revalidatePath("/admin/pedidos");
  revalidatePath(`/admin/pedidos/${orderId}`);
  return { success: true };
}

export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  if (!ORDER_STATUSES.has(status)) return { error: "Estado de pedido inválido." };
  const { supabase, user, role } = await requireAdmin();
  if (!user || role !== "admin") return { error: "No autorizado." };

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
        address: [order.address, order.neighborhood, order.address_details]
          .filter(Boolean)
          .join(", ") || null,
        city: order.city,
        department: order.department,
        source: order.order_source === "asesor" ? "Catálogo virtual - asesor" : "Catálogo virtual - web",
      });
    }

    await syncCrmProductOpportunityStage({
      contactId,
      customerName: order.customer_name,
      orderNumber: order.order_number,
      source: order.order_source === "asesor" ? "manual" : "catalogo",
      salesOriginLabel: order.sales_origin_label,
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

    if (status === "cotizacion_aceptada" && order.status !== "cotizacion_aceptada") {
      const billingPhone = process.env.ORBITA_BILLING_WHATSAPP_NUMBER?.trim();
      if (!billingPhone) {
        throw new CrmConfigurationError(
          "Configura ORBITA_BILLING_WHATSAPP_NUMBER para avisar a facturación cuando acepten una cotización."
        );
      }
      const billingContactId = await upsertCrmContact({
        name: process.env.ORBITA_BILLING_CONTACT_NAME?.trim() || "Facturación",
        phone: billingPhone,
        source: "Alertas de cotizaciones aceptadas - catálogo virtual",
      });
      await triggerCrmNewOrderNotificationWorkflow(
        billingContactId,
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
      const { data: latestAttempt, error: attemptLookupError } = await supabase
        .from("order_quote_attempts")
        .select("id")
        .eq("order_id", orderId)
        .eq("status", "requested")
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!attemptLookupError && latestAttempt) {
        await supabase
          .from("order_quote_attempts")
          .update({ accepted_notified_at: new Date().toISOString() })
          .eq("id", latestAttempt.id);
      }
    }
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
  const { supabase, user, role } = await requireAdmin();
  if (!user || role !== "admin") return { error: "No autorizado." };

  const { error } = await supabase
    .from("orders")
    .update({ payment_status: paymentStatus })
    .eq("id", orderId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/pedidos/${orderId}`);
  return { success: true };
}

export async function triggerOrderQuoteWorkflow(
  orderId: string,
  input: TriggerOrderQuoteWorkflowInput
): Promise<TriggerOrderQuoteWorkflowResult> {
  const { supabase, user, role } = await requireAdmin();
  if (!user || (role !== "admin" && role !== "operator")) return { error: "No autorizado." };

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) return { error: orderError?.message ?? "El pedido no existe." };
  if (
    !["pedido_realizado", "cotizacion_enviada", "cotizacion_aceptada", "no_hubo_producto"].includes(
      order.status
    )
  ) {
    return { error: "Solo puedes cotizar pedidos pendientes o reenviar una cotización." };
  }

  const resolved = await resolveQuoteItems(input.items);
  if ("error" in resolved) return resolved;

  const quoteNote = input.quoteNote?.trim() || null;
  if (quoteNote && quoteNote.length > 1_000) {
    return { error: "Las notas de la cotización no pueden superar 1000 caracteres." };
  }

  const requestedDeliveryFee = Number(input.deliveryFee);
  if (!Number.isFinite(requestedDeliveryFee) || requestedDeliveryFee < 0 || requestedDeliveryFee > 100_000_000) {
    return { error: "El costo del domicilio no es válido." };
  }
  const deliveryFee = order.delivery_method === "domicilio" ? requestedDeliveryFee : 0;
  const quoteItems: OrderQuoteItem[] = resolved.items.map((item, index) => ({
    product_id: item.productId || null,
    variant_id: item.variantId,
    product_name: item.productName,
    variant_label: item.variantLabel,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    subtotal: item.subtotal,
    available: input.items[index]?.available !== false,
    ...(index === 0 && quoteNote ? { quote_note: quoteNote } : {}),
  }));
  const availableItems = quoteItems.filter((item) => item.available);
  const unavailableProducts = [
    ...new Set(quoteItems.filter((item) => !item.available).map((item) => item.product_name)),
  ];
  const subtotal = availableItems.reduce((sum, item) => sum + item.subtotal, 0);
  const total = subtotal + deliveryFee;
  const workflowMode = order.quote_sent_at ? "resend" : "initial";
  const quoteSummary = buildStructuredQuoteMessage(order, quoteItems, deliveryFee, quoteNote, {
    withButtons: workflowMode === "initial",
  });
  const nextStatus: OrderStatus = availableItems.length > 0 ? "cotizacion_enviada" : "no_hubo_producto";
  let quoteRevision = order.quote_sent_at ? 2 : 1;
  const { data: latestAttempt, error: revisionError } = await supabase
    .from("order_quote_attempts")
    .select("revision")
    .eq("order_id", orderId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!revisionError && latestAttempt) quoteRevision = Number(latestAttempt.revision) + 1;

  let contactId: string;
  try {
    contactId = await upsertCrmContact({
      name: order.customer_name,
      email: order.customer_email,
      phone: order.customer_phone,
      cedula: order.customer_cedula,
      address: [order.address, order.neighborhood, order.address_details]
        .filter(Boolean)
        .join(", ") || null,
      city: order.city,
      department: order.department,
      source: order.order_source === "asesor" ? "Catálogo virtual - asesor" : "Catálogo virtual - web",
    });
  } catch (error) {
    const message = errorMessage(error).slice(0, 500);
    const { error: attemptError } = await supabase.from("order_quote_attempts").insert({
      order_id: orderId,
      revision: quoteRevision,
      attempt_kind: workflowMode,
      status: "error",
      quote_message: quoteSummary,
      quote_items: quoteItems,
      delivery_fee: deliveryFee,
      subtotal,
      total,
      requested_by_email: user.email ?? null,
      error_message: message,
    });
    if (attemptError && !isMissingQuoteAttemptsTable(attemptError)) {
      console.error("No se pudo registrar el intento fallido de cotización", attemptError);
    }
    await supabase
      .from("orders")
      .update({
        ghl_sync_status: error instanceof CrmConfigurationError ? "sin_configurar" : "error",
        ghl_sync_error: message,
      })
      .eq("id", orderId);
    revalidatePath(`/admin/pedidos/${orderId}`);
    return { error: "No se pudo preparar el contacto para enviar la cotización." };
  }

  try {
    await triggerCrmQuoteWorkflow(contactId, quoteSummary, unavailableProducts, workflowMode);
    const requestedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: nextStatus,
        quote_message: quoteSummary,
        quote_items: quoteItems,
        quote_delivery_fee: deliveryFee,
        subtotal,
        total,
        quote_sent_at: requestedAt,
        quote_sent_by_email: user.email ?? null,
        ghl_contact_id: contactId,
        ghl_sync_status: "sincronizado",
        ghl_sync_error: null,
        ghl_synced_at: new Date().toISOString(),
        // El mensaje lo crea el workflow. Limpiamos IDs antiguos para no
        // atribuirle al nuevo intento un mensaje enviado por la integración previa.
        ghl_message_id: null,
        ghl_conversation_id: null,
      })
      .eq("id", orderId);

    const { error: attemptError } = await supabase.from("order_quote_attempts").insert({
      order_id: orderId,
      revision: quoteRevision,
      attempt_kind: workflowMode,
      status: "requested",
      quote_message: quoteSummary,
      quote_items: quoteItems,
      delivery_fee: deliveryFee,
      subtotal,
      total,
      requested_by_email: user.email ?? null,
      requested_at: requestedAt,
    });
    const attemptWarning =
      attemptError && !isMissingQuoteAttemptsTable(attemptError)
        ? "El envío fue solicitado, pero no se pudo guardar su historial detallado."
        : undefined;

    revalidatePath("/admin");
    revalidatePath("/admin/pedidos");
    revalidatePath(`/admin/pedidos/${orderId}`);

    if (updateError) {
      return {
        success: true,
        status: nextStatus,
        workflowMode,
        warning:
          "La cotización fue preparada, pero su estado local necesita revisión antes de reenviarla.",
      };
    }

    try {
      await syncCrmProductOpportunityStage({
        contactId,
        customerName: order.customer_name,
        orderNumber: order.order_number,
        source: order.order_source === "asesor" ? "manual" : "catalogo",
        salesOriginLabel: order.sales_origin_label,
        total,
        stage: nextStatus,
      });
      return { success: true, status: nextStatus, workflowMode, warning: attemptWarning };
    } catch (syncError) {
      const technicalWarning = `La cotización fue preparada, pero la oportunidad no cambió de etapa: ${errorMessage(syncError)}`;
      await supabase
        .from("orders")
        .update({ ghl_sync_status: "error", ghl_sync_error: technicalWarning.slice(0, 500) })
        .eq("id", orderId);
      return {
        success: true,
        status: nextStatus,
        workflowMode,
        warning: joinWarnings(
          attemptWarning,
          "La cotización quedó preparada, pero su estado externo necesita revisión."
        ),
      };
    }
  } catch (error) {
    const message = errorMessage(error).slice(0, 500);
    const { error: attemptError } = await supabase.from("order_quote_attempts").insert({
      order_id: orderId,
      revision: quoteRevision,
      attempt_kind: workflowMode,
      status: "error",
      quote_message: quoteSummary,
      quote_items: quoteItems,
      delivery_fee: deliveryFee,
      subtotal,
      total,
      requested_by_email: user.email ?? null,
      error_message: message,
    });
    if (attemptError && !isMissingQuoteAttemptsTable(attemptError)) {
      console.error("No se pudo registrar el workflow fallido de cotización", attemptError);
    }
    await supabase
      .from("orders")
      .update({ ghl_contact_id: contactId, ghl_sync_status: "error", ghl_sync_error: message })
      .eq("id", orderId);
    revalidatePath(`/admin/pedidos/${orderId}`);
    return {
      error: `No se pudo activar el workflow de cotización: ${message}`,
    };
  }
}
