import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { notifyAcceptedQuoteToOrdersGroup, type AcceptedQuoteOrder } from "@/lib/orders-group-notification";

export const runtime = "nodejs";

type QuoteDecision = "aprobar" | "rechazar";

function safeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function parseDecision(value: unknown): QuoteDecision | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["aprobar", "aprobar_cotizacion", "aceptar", "aceptada"].includes(normalized)) return "aprobar";
  if (["rechazar", "rechazar_cotizacion", "rechazada"].includes(normalized)) return "rechazar";
  return null;
}

/**
 * Cliente anónimo sin sesión: las funciones RPC validan el mismo secreto contra
 * su hash en la base de datos antes de tocar un pedido.
 */
function integrationClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function revalidateOrders(orderId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath(`/admin/pedidos/${orderId}`);
}

/**
 * Lo llama el workflow de cotización de Órbita cuando el cliente pulsa
 * Aprobar o Rechazar. Al aprobar, el pedido se envía al grupo de domicilios.
 */
export async function POST(request: Request) {
  const expectedSecret = process.env.ORBITA_QUOTE_WEBHOOK_SECRET?.trim();
  const suppliedSecret = request.headers.get("x-orbita-webhook-secret")?.trim() ?? "";
  if (!expectedSecret) {
    return Response.json({ error: "Configura ORBITA_QUOTE_WEBHOOK_SECRET." }, { status: 503 });
  }
  if (!suppliedSecret || !safeEqual(expectedSecret, suppliedSecret)) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  let body: { contactId?: unknown; contact_id?: unknown; decision?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON." }, { status: 400 });
  }
  const rawContactId = body.contactId ?? body.contact_id;
  const contactId = typeof rawContactId === "string" ? rawContactId.trim() : "";
  const decision = parseDecision(body.decision);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(contactId) || !decision) {
    return Response.json(
      { error: "Envía contactId y decision (aprobar o rechazar)." },
      { status: 400 }
    );
  }

  const supabase = integrationClient();
  const { data, error } = await supabase.rpc("integration_claim_quote_response", {
    p_secret: suppliedSecret,
    p_contact_id: contactId,
    p_decision: decision,
  });
  if (error) {
    const status = error.code === "42501" ? 401 : 500;
    return Response.json({ error: error.message }, { status });
  }

  const order = data as (AcceptedQuoteOrder & { id: string }) | null;
  if (!order) {
    // Sin cotización enviada pendiente para el contacto: puede ser un reintento
    // o una cotización ya gestionada manualmente desde el dashboard.
    return Response.json({ matched: false });
  }

  if (decision === "rechazar") {
    revalidateOrders(order.id);
    return Response.json({ matched: true, orderNumber: order.order_number, status: "cotizacion_no_aceptada" });
  }

  try {
    await notifyAcceptedQuoteToOrdersGroup(order);
  } catch (notifyError) {
    await supabase.rpc("integration_finish_quote_acceptance", {
      p_secret: suppliedSecret,
      p_order_id: order.id,
      p_notified: false,
    });
    revalidateOrders(order.id);
    const message = notifyError instanceof Error ? notifyError.message : "Error desconocido.";
    return Response.json(
      { error: `No se pudo enviar el pedido al grupo de domicilios: ${message}` },
      { status: 502 }
    );
  }

  await supabase.rpc("integration_finish_quote_acceptance", {
    p_secret: suppliedSecret,
    p_order_id: order.id,
    p_notified: true,
  });
  revalidateOrders(order.id);
  return Response.json({ matched: true, orderNumber: order.order_number, status: "cotizacion_aceptada" });
}
