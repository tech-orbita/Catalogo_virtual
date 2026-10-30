import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CATALOG_CONTACT_COOKIE,
  verifyCatalogContactToken,
} from "@/lib/catalog-contact-link";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const payload = verifyCatalogContactToken(token);
  const destination = new URL("/", request.url);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");

  if (payload) {
    response.cookies.set(CATALOG_CONTACT_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(payload.exp * 1_000),
      priority: "high",
    });
  } else {
    response.cookies.delete(CATALOG_CONTACT_COOKIE);
  }

  return response;
}
