import "server-only";

import type { CrmContactSearchResult } from "@/lib/types";

const CRM_API_BASE_URL = "https://services.leadconnectorhq.com";
const CRM_API_VERSION = "v3";
const CRM_WORKFLOW_IDS = {
  quote: "f60ba650-14ca-451d-87c4-6b3ab6eeb311",
  storeNotification: "650f1434-4e4c-4c56-a25f-0abb01bf5e4a",
  customerNotification: "7280e96d-7915-4dc4-9cc7-e9ee4034790c",
} as const;
const CRM_MESSAGE_FIELD_KEYS = {
  identificationNumber: "nmero_de_identificacin",
  quote: "resumen_de_cotizacion",
  unavailableProducts: "productos_no_disponibles",
  customerNotification: "confirmacion_nuevo_pedido",
  storeNotification: "notificacion_nuevo_pedido",
} as const;

/**
 * Marca blanca: la app nunca nombra al proveedor del CRM. Las variables de
 * entorno se llaman ORBITA_CRM_*; los nombres antiguos se siguen leyendo para
 * no romper despliegues existentes, pero nunca aparecen en mensajes de error.
 */
function readEnv(name: string, legacyName: string) {
  return (process.env[name] ?? process.env[legacyName])?.trim();
}

function crmEventStartTime() {
  // La API de workflows exige un offset no-UTC explícito y rechaza `Z`/`+00:00`.
  const colombiaOffsetMs = 5 * 60 * 60 * 1_000;
  const colombiaTime = new Date(Date.now() - colombiaOffsetMs).toISOString();
  return `${colombiaTime.slice(0, 19)}-05:00`;
}

export class CrmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmConfigurationError";
  }
}

export interface CrmContactInput {
  name: string;
  email?: string | null;
  phone: string;
  cedula?: string | null;
  address?: string | null;
  city?: string | null;
  department?: string | null;
  countryCode?: string | null;
  countryCallingCode?: string | null;
  source: string;
}

interface CrmContactResponse {
  contact?: CrmContactRecord;
}

interface CrmContactRecord {
  id?: string;
  locationId?: string;
  contactName?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  address?: string;
  address1?: string;
  city?: string;
  state?: string;
  country?: string;
  tags?: string[];
  customFields?: Array<{ id?: string; key?: string; value?: unknown; fieldValue?: unknown }>;
}

interface CrmContactSearchResponse {
  contacts?: CrmContactRecord[];
}

interface CrmCustomFieldsResponse {
  customFields?: Array<{ id?: string; fieldKey?: string }>;
}

interface CrmNoteResponse {
  note?: { id?: string };
}

interface CrmContactUpdateResponse {
  succeeded?: boolean;
  contact?: { id?: string };
}

interface CrmWorkflowEnrollmentResponse {
  succeeded?: boolean;
  /** Compatibilidad con la respuesta antigua de HighLevel. */
  succeded?: boolean;
}

interface CrmPipelineStage {
  id?: string;
  name?: string;
}

interface CrmPipeline {
  id?: string;
  name?: string;
  stages?: CrmPipelineStage[];
}

interface CrmPipelinesResponse {
  pipelines?: CrmPipeline[];
}

interface CrmOpportunity {
  id?: string;
  name?: string;
  status?: string;
  pipelineId?: string;
  pipelineStageId?: string;
}

interface CrmOpportunitiesResponse {
  opportunities?: CrmOpportunity[];
}

interface CrmOpportunityResponse {
  opportunity?: CrmOpportunity;
}

export type CrmOrderStage =
  | "pedido_realizado"
  | "cotizacion_enviada"
  | "cotizacion_aceptada"
  | "cotizacion_no_aceptada"
  | "no_hubo_producto"
  | "pedido_listo"
  | "pedido_enviado"
  | "pedido_entregado";

const AGENT_PIPELINE_NAME = "000. Agente IA";
const AGENT_CATALOG_STAGE_NAME = "Pedido por Catálogo Virtual";
const PRODUCTS_PIPELINE_NAME = "000. Productos";

const PRODUCT_STAGE_NAMES: Record<CrmOrderStage, string> = {
  pedido_realizado: "Pedido Realizado",
  cotizacion_enviada: "Cotización Enviada",
  cotizacion_aceptada: "Cotización Aceptada",
  cotizacion_no_aceptada: "Cotización no Aceptada",
  no_hubo_producto: "No Hubo Producto",
  pedido_listo: "Pedido Listo",
  pedido_enviado: "Pedido Enviado",
  pedido_entregado: "Pedido Entregado",
};

type ResolvedCrmPipeline = {
  id: string;
  stages: Map<string, string>;
};

let pipelineCache:
  | { locationId: string; expiresAt: number; pipelines: CrmPipeline[] }
  | null = null;
let identificationFieldCache:
  | { locationId: string; expiresAt: number; id: string | null }
  | null = null;

function getConfig() {
  const apiKey = readEnv("ORBITA_CRM_API_KEY", "GHL_API_KEY");
  const locationId = readEnv("ORBITA_CRM_LOCATION_ID", "GHL_LOCATION_ID");

  if (!apiKey || !locationId) {
    throw new CrmConfigurationError(
      "Configura ORBITA_CRM_API_KEY y ORBITA_CRM_LOCATION_ID para sincronizar contactos y preparar cotizaciones."
    );
  }

  return { apiKey, locationId };
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? fullName.trim(),
    lastName: parts.slice(1).join(" ") || undefined,
  };
}

function buildCrmContactFields(input: CrmContactInput) {
  const phone = normalizePhoneForCrm(input.phone, input.countryCallingCode);
  if (!phone) throw new Error("El teléfono no es válido para sincronizarlo con el CRM.");

  const { firstName, lastName } = splitName(input.name);
  const customFields: Array<{ key: string; fieldValue: string }> = [];
  if (input.cedula) {
    customFields.push({
      key: CRM_MESSAGE_FIELD_KEYS.identificationNumber,
      fieldValue: input.cedula,
    });
  }

  return {
    name: input.name.trim(),
    firstName,
    lastName,
    phone,
    address1: input.address?.trim() || undefined,
    city: input.city?.trim() || undefined,
    state: input.department?.trim() || undefined,
    country:
      input.countryCode?.trim().toUpperCase() ||
      readEnv("ORBITA_CRM_CONTACT_COUNTRY", "GHL_CONTACT_COUNTRY") ||
      "CO",
    source: input.source,
    customFields: customFields.length > 0 ? customFields : undefined,
  };
}

export function normalizePhoneForCrm(phone: string, countryCallingCode?: string | null): string {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (!digits) return "";
  if (trimmed.startsWith("+") || phone.trim().startsWith("00")) return `+${digits}`;

  const defaultCountryCode = (countryCallingCode ??
    readEnv("ORBITA_CRM_DEFAULT_PHONE_COUNTRY_CODE", "GHL_DEFAULT_PHONE_COUNTRY_CODE") ??
    "57").replace(/\D/g, "");
  if (defaultCountryCode && digits.startsWith(defaultCountryCode) && digits.length >= defaultCountryCode.length + 7) {
    return `+${digits}`;
  }
  if (defaultCountryCode) return `+${defaultCountryCode}${digits}`;
  return `+${digits}`;
}

async function crmRequest<T>(path: string, init: RequestInit): Promise<T> {
  const { apiKey } = getConfig();
  const response = await fetch(`${CRM_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Version: CRM_API_VERSION,
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : `HTTP ${response.status}`;
    throw new Error(`El CRM de Órbita IA rechazó la solicitud: ${sanitizeDetail(detail)}`);
  }

  return (payload ?? {}) as T;
}

/**
 * El detalle viene del proveedor y puede nombrarlo; lo neutralizamos antes de
 * mostrarlo para mantener la marca blanca incluso en errores remotos.
 */
function sanitizeDetail(detail: string): string {
  return detail
    .replace(/high\s*-?\s*level/gi, "Órbita IA")
    .replace(/gohighlevel(\.com)?/gi, "Órbita IA")
    .replace(/leadconnectorhq?(\.com)?/gi, "Órbita IA")
    .replace(/leadconnector/gi, "Órbita IA")
    .replace(/msgsndr(\.com)?/gi, "Órbita IA")
    .replace(/\bghl\b/gi, "CRM")
    .slice(0, 300);
}

function normalizeCrmName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}

async function getCrmPipelines(): Promise<CrmPipeline[]> {
  const { locationId } = getConfig();
  if (pipelineCache?.locationId === locationId && pipelineCache.expiresAt > Date.now()) {
    return pipelineCache.pipelines;
  }

  const params = new URLSearchParams({ locationId });
  const response = await crmRequest<CrmPipelinesResponse>(
    `/opportunities/pipelines?${params.toString()}`,
    { method: "GET" }
  );
  const pipelines = response.pipelines ?? [];
  pipelineCache = { locationId, pipelines, expiresAt: Date.now() + 5 * 60_000 };
  return pipelines;
}

async function resolveCrmPipeline(
  pipelineName: string,
  requiredStageNames: string[]
): Promise<ResolvedCrmPipeline> {
  const pipelines = await getCrmPipelines();
  const pipeline = pipelines.find(
    (candidate) => normalizeCrmName(candidate.name ?? "") === normalizeCrmName(pipelineName)
  );
  if (!pipeline?.id) {
    throw new Error(`No se encontró el embudo "${pipelineName}" en el CRM.`);
  }

  const stages = new Map<string, string>();
  for (const stageName of requiredStageNames) {
    const stage = pipeline.stages?.find(
      (candidate) => normalizeCrmName(candidate.name ?? "") === normalizeCrmName(stageName)
    );
    if (!stage?.id) {
      throw new Error(`No se encontró la etapa "${stageName}" en el embudo "${pipelineName}".`);
    }
    stages.set(stageName, stage.id);
  }

  return { id: pipeline.id, stages };
}

async function searchCrmOpportunities(contactId: string, pipelineId: string) {
  const { locationId } = getConfig();
  const params = new URLSearchParams({
    locationId,
    contactId,
    pipelineId,
    status: "all",
    limit: "100",
  });
  const response = await crmRequest<CrmOpportunitiesResponse>(
    `/opportunities/search?${params.toString()}`,
    { method: "GET" }
  );
  return response.opportunities ?? [];
}

async function createCrmOpportunity(input: {
  contactId: string;
  pipelineId: string;
  stageId: string;
  name: string;
  monetaryValue?: number;
}) {
  const { locationId } = getConfig();
  const response = await crmRequest<CrmOpportunityResponse>("/opportunities/", {
    method: "POST",
    body: JSON.stringify({
      pipelineId: input.pipelineId,
      pipelineStageId: input.stageId,
      locationId,
      contactId: input.contactId,
      name: input.name,
      status: "open",
      monetaryValue: input.monetaryValue,
    }),
  });
  if (!response.opportunity?.id) {
    throw new Error("El CRM no confirmó la creación de la oportunidad.");
  }
  return response.opportunity.id;
}

async function updateCrmOpportunity(
  opportunityId: string,
  input: { pipelineId: string; stageId: string; name?: string; monetaryValue?: number }
) {
  const response = await crmRequest<CrmOpportunityResponse>(
    `/opportunities/${encodeURIComponent(opportunityId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        pipelineId: input.pipelineId,
        pipelineStageId: input.stageId,
        name: input.name,
        status: "open",
        monetaryValue: input.monetaryValue,
      }),
    }
  );
  if (response.opportunity && !response.opportunity.id) {
    throw new Error("El CRM no confirmó la actualización de la oportunidad.");
  }
}

type CrmOrderSource = "catalogo" | "manual";

function productOpportunityName(input: {
  customerName: string;
  orderNumber: number;
  source: CrmOrderSource;
  salesOriginLabel?: string | null;
}) {
  const reference = input.orderNumber.toString().padStart(4, "0");
  const sourceLabel = input.source === "catalogo" ? "CT" : "Manual";
  const origin = input.salesOriginLabel?.trim();
  return `${input.customerName.trim()} · ${sourceLabel} #${reference}${origin ? ` · ${origin}` : ""}`;
}

function waitForCrmIndex(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function ensureProductOpportunity(input: {
  contactId: string;
  customerName: string;
  orderNumber: number;
  source: CrmOrderSource;
  salesOriginLabel?: string | null;
  total: number;
  stage: CrmOrderStage;
}) {
  const stageName = PRODUCT_STAGE_NAMES[input.stage];
  const pipeline = await resolveCrmPipeline(PRODUCTS_PIPELINE_NAME, [stageName]);
  const opportunityName = productOpportunityName(input);
  const opportunities = await searchCrmOpportunities(input.contactId, pipeline.id);
  const existing =
    opportunities.find(
      (opportunity) =>
        normalizeCrmName(opportunity.name ?? "") === normalizeCrmName(opportunityName)
    ) ?? opportunities.find((opportunity) => opportunity.status === "open") ?? opportunities[0];
  const stageId = pipeline.stages.get(stageName)!;

  if (existing?.id) {
    await updateCrmOpportunity(existing.id, {
      pipelineId: pipeline.id,
      stageId,
      name: opportunityName,
      monetaryValue: input.total,
    });
    return existing.id;
  }

  try {
    return await createCrmOpportunity({
      contactId: input.contactId,
      pipelineId: pipeline.id,
      stageId,
      name: opportunityName,
      monetaryValue: input.total,
    });
  } catch (createError) {
    // La subcuenta puede bloquear duplicados y el índice de búsqueda tarda un
    // instante en mostrar una oportunidad recién creada. La recuperamos y la
    // actualizamos en vez de generar otra.
    for (const delayMs of [200, 400, 800]) {
      await waitForCrmIndex(delayMs);
      const indexed = await searchCrmOpportunities(input.contactId, pipeline.id);
      const recovered =
        indexed.find(
          (opportunity) =>
            normalizeCrmName(opportunity.name ?? "") === normalizeCrmName(opportunityName)
        ) ?? indexed.find((opportunity) => opportunity.status === "open") ?? indexed[0];
      if (recovered?.id) {
        await updateCrmOpportunity(recovered.id, {
          pipelineId: pipeline.id,
          stageId,
          name: opportunityName,
          monetaryValue: input.total,
        });
        return recovered.id;
      }
    }
    throw createError;
  }
}

export async function syncCrmOrderCreatedOpportunities(input: {
  contactId: string;
  customerName: string;
  orderNumber: number;
  salesOriginLabel?: string | null;
  total: number;
}) {
  const opportunityName = productOpportunityName({
    customerName: input.customerName,
    orderNumber: input.orderNumber,
    source: "catalogo",
    salesOriginLabel: input.salesOriginLabel,
  });
  const agentPipeline = await resolveCrmPipeline(AGENT_PIPELINE_NAME, [AGENT_CATALOG_STAGE_NAME]);
  const agentOpportunities = await searchCrmOpportunities(input.contactId, agentPipeline.id);
  const activeAgentOpportunity =
    agentOpportunities.find((opportunity) => opportunity.status === "open") ?? agentOpportunities[0];
  const agentStageId = agentPipeline.stages.get(AGENT_CATALOG_STAGE_NAME)!;

  if (activeAgentOpportunity?.id) {
    await updateCrmOpportunity(activeAgentOpportunity.id, {
      pipelineId: agentPipeline.id,
      stageId: agentStageId,
      name: opportunityName,
    });
  } else {
    await createCrmOpportunity({
      contactId: input.contactId,
      pipelineId: agentPipeline.id,
      stageId: agentStageId,
      name: opportunityName,
    });
  }

  await ensureProductOpportunity({
    ...input,
    source: "catalogo",
    stage: "pedido_realizado",
  });
}

export async function syncCrmProductOpportunityStage(input: {
  contactId: string;
  customerName: string;
  orderNumber: number;
  source: CrmOrderSource;
  salesOriginLabel?: string | null;
  total: number;
  stage: CrmOrderStage;
}) {
  await ensureProductOpportunity(input);
}

export async function upsertCrmContact(input: CrmContactInput): Promise<string> {
  const { locationId } = getConfig();
  const contactFields = buildCrmContactFields(input);
  const response = await crmRequest<CrmContactResponse>("/contacts/upsert", {
    method: "POST",
    body: JSON.stringify({
      locationId,
      ...contactFields,
      createNewIfDuplicateAllowed: false,
    }),
  });

  const contactId = response.contact?.id;
  if (!contactId) throw new Error("El CRM no devolvió el identificador del contacto.");

  // El upsert se hace sin correo para que la coincidencia dependa primero del
  // teléfono. Después completamos el contacto exacto por ID con el resto de datos.
  const updated = await crmRequest<CrmContactUpdateResponse>(
    `/contacts/${encodeURIComponent(contactId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...contactFields,
        email: input.email?.trim() || undefined,
      }),
    }
  );
  if (updated.succeeded === false || (updated.contact?.id && updated.contact.id !== contactId)) {
    throw new Error("El CRM no confirmó la actualización completa del contacto.");
  }
  return contactId;
}

export async function updateCrmContactById(
  contactId: string,
  input: CrmContactInput,
  options: { clearMissingFields?: boolean } = {}
): Promise<string> {
  const { locationId } = getConfig();
  const encodedContactId = encodeURIComponent(contactId);
  const current = await crmRequest<CrmContactResponse>(`/contacts/${encodedContactId}`, {
    method: "GET",
  });
  if (!current.contact?.id || current.contact.locationId !== locationId) {
    throw new Error("El contacto seleccionado no pertenece a la subcuenta configurada.");
  }

  const contactFields = buildCrmContactFields(input);
  const updated = await crmRequest<CrmContactUpdateResponse>(`/contacts/${encodedContactId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...contactFields,
      email: input.email?.trim() || (options.clearMissingFields ? null : undefined),
      address1:
        input.address?.trim() || (options.clearMissingFields ? null : contactFields.address1),
      city: input.city?.trim() || (options.clearMissingFields ? null : contactFields.city),
      state:
        input.department?.trim() || (options.clearMissingFields ? null : contactFields.state),
    }),
  });
  if (updated.succeeded === false || (updated.contact?.id && updated.contact.id !== contactId)) {
    throw new Error("El CRM no confirmó la actualización completa del contacto.");
  }
  return contactId;
}

function normalizeContactSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es-CO");
}

function splitCrmAddress(value: string | undefined) {
  const parts = (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    address: parts[0] ?? "",
    neighborhood: parts[1] ?? "",
    addressDetails: parts.slice(2).join(", "),
  };
}

async function getIdentificationFieldId() {
  const { locationId } = getConfig();
  if (
    identificationFieldCache?.locationId === locationId &&
    identificationFieldCache.expiresAt > Date.now()
  ) {
    return identificationFieldCache.id;
  }

  const response = await crmRequest<CrmCustomFieldsResponse>(
    `/locations/${encodeURIComponent(locationId)}/customFields?model=contact`,
    { method: "GET" }
  );
  const field = response.customFields?.find((candidate) => {
    const key = candidate.fieldKey?.replace(/^contact\./, "");
    return key === CRM_MESSAGE_FIELD_KEYS.identificationNumber;
  });
  const id = field?.id ?? null;
  identificationFieldCache = { locationId, id, expiresAt: Date.now() + 10 * 60_000 };
  return id;
}

function readCustomField(contact: CrmContactRecord, fieldId: string | null) {
  if (!fieldId) return "";
  const field = contact.customFields?.find((candidate) => candidate.id === fieldId);
  const value = field?.fieldValue ?? field?.value;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function toContactSearchResult(
  contact: CrmContactRecord,
  identificationFieldId: string | null
): CrmContactSearchResult | null {
  if (!contact.id) return null;
  const name =
    contact.contactName?.trim() ||
    contact.name?.trim() ||
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  if (!name) return null;
  const address = splitCrmAddress(contact.address ?? contact.address1);
  return {
    id: contact.id,
    name,
    phone: contact.phone?.trim() ?? "",
    email: contact.email?.trim() ?? "",
    cedula: readCustomField(contact, identificationFieldId),
    ...address,
    city: contact.city?.trim() ?? "",
    department: contact.state?.trim() ?? "",
    countryCode: contact.country?.trim() ?? "CO",
  };
}

export async function searchCrmContacts(query: string): Promise<CrmContactSearchResult[]> {
  const normalizedQuery = normalizeContactSearch(query).slice(0, 100);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const searchableTerms = [...new Set(terms.filter((term) => term.length >= 3))];
  const phoneQuery = query.replace(/\D/g, "");
  if (searchableTerms.length === 0 && phoneQuery.length < 3) return [];

  const { locationId } = getConfig();
  const searches: Array<Promise<CrmContactSearchResponse>> = [];
  for (const term of searchableTerms) {
    for (const field of ["firstName", "lastName"] as const) {
      searches.push(
        crmRequest<CrmContactSearchResponse>("/contacts/search", {
          method: "POST",
          body: JSON.stringify({
            locationId,
            page: 1,
            pageLimit: 20,
            filters: [{ field, operator: "contains", value: term }],
          }),
        })
      );
    }
  }
  if (phoneQuery.length >= 3) {
    searches.push(
      crmRequest<CrmContactSearchResponse>("/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          locationId,
          page: 1,
          pageLimit: 20,
          filters: [{ field: "phone", operator: "contains", value: phoneQuery }],
        }),
      })
    );
  }

  const [responses, identificationFieldId] = await Promise.all([
    Promise.all(searches),
    getIdentificationFieldId().catch(() => null),
  ]);
  const contactsById = new Map<string, CrmContactRecord>();
  for (const response of responses) {
    for (const contact of response.contacts ?? []) {
      if (contact.id) contactsById.set(contact.id, contact);
    }
  }

  return [...contactsById.values()]
    .filter((contact) => {
      const name = normalizeContactSearch(
        contact.contactName ||
          contact.name ||
          [contact.firstName, contact.lastName].filter(Boolean).join(" ")
      );
      const phone = (contact.phone ?? "").replace(/\D/g, "");
      return terms.every((term) => {
        const digits = term.replace(/\D/g, "");
        return name.includes(term) || (digits.length >= 3 && phone.includes(digits));
      });
    })
    .map((contact) => toContactSearchResult(contact, identificationFieldId))
    .filter((contact): contact is CrmContactSearchResult => Boolean(contact))
    .sort((left, right) => left.name.localeCompare(right.name, "es-CO"))
    .slice(0, 20);
}

export async function getCrmContactTags(contactId: string): Promise<string[]> {
  const response = await crmRequest<CrmContactResponse>(
    `/contacts/${encodeURIComponent(contactId)}`,
    { method: "GET" }
  );
  return Array.isArray(response.contact?.tags) ? response.contact.tags : [];
}

export async function createCrmContactNote(contactId: string, title: string, body: string) {
  const response = await crmRequest<CrmNoteResponse>(
    `/contacts/${encodeURIComponent(contactId)}/notes`,
    {
      method: "POST",
      body: JSON.stringify({ title, body }),
    }
  );
  return response.note?.id ?? null;
}

async function triggerCrmMessageWorkflow(input: {
  contactId: string;
  message: string;
  customFieldKey: string;
  workflowId: string;
  configurationError: string;
}) {
  if (!input.customFieldKey || !input.workflowId) {
    throw new CrmConfigurationError(input.configurationError);
  }

  const encodedContactId = encodeURIComponent(input.contactId);
  const updated = await crmRequest<CrmContactUpdateResponse>(`/contacts/${encodedContactId}`, {
    method: "PUT",
    body: JSON.stringify({
      customFields: [{ key: input.customFieldKey, fieldValue: input.message }],
    }),
  });
  if (
    updated.succeeded === false ||
    (updated.contact?.id && updated.contact.id !== input.contactId)
  ) {
    throw new Error("El CRM no confirmó la actualización del mensaje del pedido.");
  }

  const enrolled = await crmRequest<CrmWorkflowEnrollmentResponse>(
    `/contacts/${encodedContactId}/workflow/${encodeURIComponent(input.workflowId)}`,
    {
      method: "POST",
      body: JSON.stringify({ eventStartTime: crmEventStartTime() }),
    }
  );
  if (enrolled.succeeded !== true && enrolled.succeded !== true) {
    throw new Error("El CRM no confirmó la activación del workflow del pedido.");
  }
}

export async function triggerCrmOrderConfirmationWorkflow(contactId: string, message: string) {
  return triggerCrmMessageWorkflow({
    contactId,
    message,
    customFieldKey: CRM_MESSAGE_FIELD_KEYS.customerNotification,
    workflowId: CRM_WORKFLOW_IDS.customerNotification,
    configurationError:
      "Configura el campo y el workflow de confirmación de pedidos para clientes.",
  });
}

export async function triggerCrmNewOrderNotificationWorkflow(contactId: string, message: string) {
  return triggerCrmMessageWorkflow({
    contactId,
    message,
    customFieldKey: CRM_MESSAGE_FIELD_KEYS.storeNotification,
    workflowId: CRM_WORKFLOW_IDS.storeNotification,
    configurationError:
      "Configura el campo y el workflow interno de notificaciones de nuevo pedido.",
  });
}

function getQuoteWorkflowConfig() {
  return {
    quoteFieldKey: CRM_MESSAGE_FIELD_KEYS.quote,
    unavailableProductsFieldKey: CRM_MESSAGE_FIELD_KEYS.unavailableProducts,
    workflowId: CRM_WORKFLOW_IDS.quote,
  };
}

/**
 * Guarda el resumen en el contacto y lo inscribe en el workflow de GHL.
 * La aplicación no crea mensajes: el proveedor, el número remitente y los
 * botones interactivos pertenecen exclusivamente al workflow configurado.
 */
export async function triggerCrmQuoteWorkflow(
  contactId: string,
  quoteSummary: string,
  unavailableProducts: string[]
) {
  const { quoteFieldKey, unavailableProductsFieldKey, workflowId } = getQuoteWorkflowConfig();
  const encodedContactId = encodeURIComponent(contactId);

  const updated = await crmRequest<CrmContactUpdateResponse>(`/contacts/${encodedContactId}`, {
    method: "PUT",
    body: JSON.stringify({
      customFields: [
        { key: quoteFieldKey, fieldValue: quoteSummary },
        { key: unavailableProductsFieldKey, fieldValue: unavailableProducts },
      ],
    }),
  });

  if (updated.succeeded === false || (updated.contact?.id && updated.contact.id !== contactId)) {
    throw new Error("El CRM no confirmó la actualización del resumen de la cotización.");
  }

  const enrolled = await crmRequest<CrmWorkflowEnrollmentResponse>(
    `/contacts/${encodedContactId}/workflow/${encodeURIComponent(workflowId)}`,
    {
      method: "POST",
      body: JSON.stringify({ eventStartTime: crmEventStartTime() }),
    }
  );

  if (enrolled.succeeded !== true && enrolled.succeded !== true) {
    throw new Error("El CRM no confirmó la activación del workflow de cotización.");
  }
}
