import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions } from "./cookie-options";
import { getDashboardRole } from "@/lib/auth/access";

function redirectWithSession(url: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);

  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  redirectResponse.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate");

  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");
  const isLoginRoute = request.nextUrl.pathname === "/admin/login";
  const role = getDashboardRole(user);

  if (isAdminRoute && !isLoginRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    return redirectWithSession(url, response);
  }

  if (isAdminRoute && !isLoginRoute && user && !role) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("error", "sin-acceso");
    return redirectWithSession(url, response);
  }

  if (role === "operator" && isAdminRoute && !isLoginRoute) {
    const pathname = request.nextUrl.pathname;
    const isOrderList = pathname === "/admin/pedidos";
    const isOrderDetail = /^\/admin\/pedidos\/[0-9a-f-]{36}$/i.test(pathname);

    if (!isOrderList && !isOrderDetail) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/pedidos";
      url.search = "";
      return redirectWithSession(url, response);
    }
  }

  if (isLoginRoute && user && role) {
    const url = request.nextUrl.clone();
    url.pathname = role === "operator" ? "/admin/pedidos" : "/admin";
    return redirectWithSession(url, response);
  }

  return response;
}
