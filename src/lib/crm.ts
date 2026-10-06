import "server-only";

const CRM_API_BASE_URL = "https://services.leadconnectorhq.com";
const CRM_API_VERSION = "v3";

/**
 * Marca blanca: la app nunca nombra al proveedor del CRM. Las variables de
 * entorno se llaman ORBITA_CRM_*; los nombres antiguos se siguen leyendo para
 * no romper despliegues existentes, pero nunca aparecen en mensajes de error.
 */
function readEnv(name: string, legacyName: string) {
  return (process.env[name] ?? process.env[legacyName])?.trim();
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
  source: string;
}

interface CrmContactResponse {
  contact?: { id?: string };
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

export function normalizePhoneForCrm(phone: string): string {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (!digits) return "";
  if (trimmed.startsWith("+") || phone.trim().startsWith("00")) return `+${digits}`;

  const defaultCountryCode = (
    readEnv("ORBITA_CRM_DEFAULT_PHONE_COUNTRY_CODE", "GHL_DEFAULT_PHONE_COUNTRY_CODE") ?? "57"
  ).replace(/\D/g, "");
  if (digits.length === 10 && defaultCountryCode) return `+${defaultCountryCode}${digits}`;
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

function productOpportunityName(orderNumber: number) {
  return `Pedido catálogo #${orderNumber}`;
}

function waitForCrmIndex(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function ensureProductOpportunity(input: {
  contactId: string;
  orderNumber: number;
  total: number;
  stage: CrmOrderStage;
}) {
  const stageName = PRODUCT_STAGE_NAMES[input.stage];
  const pipeline = await resolveCrmPipeline(PRODUCTS_PIPELINE_NAME, [stageName]);
  const opportunityName = productOpportunityName(input.orderNumber);
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
  orderNumber: number;
  total: number;
}) {
  const agentPipeline = await resolveCrmPipeline(AGENT_PIPELINE_NAME, [AGENT_CATALOG_STAGE_NAME]);
  const agentOpportunities = await searchCrmOpportunities(input.contactId, agentPipeline.id);
  const activeAgentOpportunity =
    agentOpportunities.find((opportunity) => opportunity.status === "open") ?? agentOpportunities[0];
  const agentStageId = agentPipeline.stages.get(AGENT_CATALOG_STAGE_NAME)!;

  if (activeAgentOpportunity?.id) {
    await updateCrmOpportunity(activeAgentOpportunity.id, {
      pipelineId: agentPipeline.id,
      stageId: agentStageId,
    });
  } else {
    await createCrmOpportunity({
      contactId: input.contactId,
      pipelineId: agentPipeline.id,
      stageId: agentStageId,
      name: "Pedido por catálogo virtual",
    });
  }

  await ensureProductOpportunity({ ...input, stage: "pedido_realizado" });
}

export async function syncCrmProductOpportunityStage(input: {
  contactId: string;
  orderNumber: number;
  total: number;
  stage: CrmOrderStage;
}) {
  await ensureProductOpportunity(input);
}

export async function upsertCrmContact(input: CrmContactInput): Promise<string> {
  const { locationId } = getConfig();
  const phone = normalizePhoneForCrm(input.phone);
  if (!phone) throw new Error("El teléfono no es válido para sincronizarlo con el CRM.");

  const { firstName, lastName } = splitName(input.name);
  const customFields: Array<{ id: string; fieldValue: string }> = [];
  const cedulaFieldId = readEnv("ORBITA_CRM_CEDULA_CUSTOM_FIELD_ID", "GHL_CEDULA_CUSTOM_FIELD_ID");
  if (cedulaFieldId && input.cedula) {
    customFields.push({ id: cedulaFieldId, fieldValue: input.cedula });
  }

  const response = await crmRequest<CrmContactResponse>("/contacts/upsert", {
    method: "POST",
    body: JSON.stringify({
      locationId,
      name: input.name.trim(),
      firstName,
      lastName,
      phone,
      email: input.email?.trim() || undefined,
      address1: input.address?.trim() || undefined,
      city: input.city?.trim() || undefined,
      state: input.department?.trim() || undefined,
      country: readEnv("ORBITA_CRM_CONTACT_COUNTRY", "GHL_CONTACT_COUNTRY") || "CO",
      source: input.source,
      createNewIfDuplicateAllowed: false,
      customFields: customFields.length > 0 ? customFields : undefined,
    }),
  });

  const contactId = response.contact?.id;
  if (!contactId) throw new Error("El CRM no devolvió el identificador del contacto.");
  return contactId;
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
  customFieldKey: string | undefined;
  workflowId: string | undefined;
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
      body: JSON.stringify({ eventStartTime: new Date().toISOString() }),
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
    customFieldKey: readEnv(
      "ORBITA_CRM_ORDER_CONFIRMATION_CUSTOM_FIELD_KEY",
      "GHL_ORDER_CONFIRMATION_CUSTOM_FIELD_KEY"
    ),
    workflowId: readEnv(
      "ORBITA_CRM_ORDER_CONFIRMATION_WORKFLOW_ID",
      "GHL_ORDER_CONFIRMATION_WORKFLOW_ID"
    ),
    configurationError:
      "Configura el campo y el workflow de confirmación de pedidos para clientes.",
  });
}

export async function triggerCrmNewOrderNotificationWorkflow(contactId: string, message: string) {
  return triggerCrmMessageWorkflow({
    contactId,
    message,
    customFieldKey: readEnv(
      "ORBITA_CRM_NEW_ORDER_CUSTOM_FIELD_KEY",
      "GHL_NEW_ORDER_CUSTOM_FIELD_KEY"
    ),
    workflowId: readEnv(
      "ORBITA_CRM_NEW_ORDER_WORKFLOW_ID",
      "GHL_NEW_ORDER_WORKFLOW_ID"
    ),
    configurationError:
      "Configura el campo y el workflow interno de notificaciones de nuevo pedido.",
  });
}

function getQuoteWorkflowConfig() {
  const quoteFieldKey = readEnv(
    "ORBITA_CRM_QUOTE_CUSTOM_FIELD_KEY",
    "GHL_QUOTE_CUSTOM_FIELD_KEY"
  );
  const unavailableProductsFieldKey = readEnv(
    "ORBITA_CRM_UNAVAILABLE_PRODUCTS_CUSTOM_FIELD_KEY",
    "GHL_UNAVAILABLE_PRODUCTS_CUSTOM_FIELD_KEY"
  );
  const workflowId = readEnv("ORBITA_CRM_QUOTE_WORKFLOW_ID", "GHL_QUOTE_WORKFLOW_ID");

  if (!quoteFieldKey || !unavailableProductsFieldKey || !workflowId) {
    throw new CrmConfigurationError(
      "Configura las keys de los campos de cotización y productos no disponibles, además del workflow de cotización."
    );
  }

  return { quoteFieldKey, unavailableProductsFieldKey, workflowId };
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
      body: JSON.stringify({ eventStartTime: new Date().toISOString() }),
    }
  );

  if (enrolled.succeeded !== true && enrolled.succeded !== true) {
    throw new Error("El CRM no confirmó la activación del workflow de cotización.");
  }
}
