import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/register", "/auth/", "/setup", "/api/health"];

/** Refresca la sesión en cada petición y redirige a /login si no hay usuario. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  // Sin variables de Supabase la app no puede funcionar: se muestra la guía de configuración
  // en lugar de un error 500 genérico.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !/^https?:\/\//.test(SUPABASE_URL)) {
    if (isPublic) return response;
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Supabase no está configurado" }, { status: 503 });
    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  let claims: unknown = null;
  try {
    const { data } = await supabase.auth.getClaims();
    claims = data?.claims ?? null;
  } catch (e) {
    // Un fallo de red o una URL/clave errónea no debe tumbar todas las rutas (MIDDLEWARE_INVOCATION_FAILED)
    console.error("[proxy] getClaims", e);
  }
  const data = { claims };

  if (!data?.claims && !isPublic) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return response;
}
