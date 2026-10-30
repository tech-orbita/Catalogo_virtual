import { createCatalogContactToken, verifyCatalogLinkApiSecret } from "@/lib/catalog-contact-link";

export const runtime = "nodejs";

function publicCatalogOrigin(request: Request) {
  const configured = process.env.ORBITA_PUBLIC_CATALOG_URL?.trim();
  const url = new URL(configured || request.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("ORBITA_PUBLIC_CATALOG_URL no es una URL pública válida.");
  }
  return url.origin;
}

export async function POST(request: Request) {
  if (!verifyCatalogLinkApiSecret(request.headers.get("x-orbita-catalog-secret"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { contactId?: unknown };
    const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
    const { token, expiresAt } = createCatalogContactToken(contactId);
    const url = new URL(`/vincular/${encodeURIComponent(token)}`, publicCatalogOrigin(request));

    return Response.json(
      { url: url.toString(), expiresAt: new Date(expiresAt * 1_000).toISOString() },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el enlace.";
    const status = message.startsWith("Configura ") ? 503 : 400;
    return Response.json({ error: message }, { status });
  }
}
