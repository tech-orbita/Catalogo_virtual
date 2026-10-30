import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const CATALOG_CONTACT_COOKIE = "orbita_catalog_contact";
export const CATALOG_CONTACT_LINK_TTL_SECONDS = 24 * 60 * 60;

type CatalogContactLinkPayload = {
  v: 1;
  contactId: string;
  exp: number;
};

function signingSecret() {
  const secret = process.env.ORBITA_CATALOG_LINK_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("Configura ORBITA_CATALOG_LINK_SIGNING_SECRET con al menos 32 caracteres.");
  }
  return secret;
}

function sign(encodedPayload: string) {
  return createHmac("sha256", signingSecret()).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function validContactId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

export function createCatalogContactToken(contactId: string) {
  if (!validContactId(contactId)) throw new Error("El identificador del contacto no es válido.");

  const expiresAt = Math.floor(Date.now() / 1_000) + CATALOG_CONTACT_LINK_TTL_SECONDS;
  const payload: CatalogContactLinkPayload = { v: 1, contactId, exp: expiresAt };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    token: `${encodedPayload}.${sign(encodedPayload)}`,
    expiresAt,
  };
}

export function verifyCatalogContactToken(token: string): CatalogContactLinkPayload | null {
  try {
    const [encodedPayload, suppliedSignature, extra] = token.split(".");
    if (!encodedPayload || !suppliedSignature || extra || !safeEqual(sign(encodedPayload), suppliedSignature)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<CatalogContactLinkPayload>;
    const now = Math.floor(Date.now() / 1_000);
    if (
      payload.v !== 1 ||
      !validContactId(payload.contactId) ||
      typeof payload.exp !== "number" ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= now ||
      payload.exp > now + CATALOG_CONTACT_LINK_TTL_SECONDS
    ) {
      return null;
    }
    return payload as CatalogContactLinkPayload;
  } catch {
    return null;
  }
}

export function verifyCatalogLinkApiSecret(suppliedSecret: string | null) {
  const expectedSecret = process.env.ORBITA_CATALOG_LINK_API_SECRET?.trim();
  return Boolean(expectedSecret && suppliedSecret && safeEqual(expectedSecret, suppliedSecret));
}
