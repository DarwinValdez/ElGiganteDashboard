import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) redirect("/setup");
  const error =
    params.error === "inactive"
      ? "Su cuenta está pendiente de aprobación o fue desactivada. Contacte a un administrador."
      : params.error === "confirm"
        ? "El enlace de confirmación no es válido o ya expiró."
        : undefined;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-xl bg-white text-3xl font-black text-sidebar">G</div>
          <div className="text-2xl font-extrabold tracking-wide">EL GIGANTE</div>
          <div className="text-xs font-medium tracking-[0.35em] text-white/70">SUPERMARKET</div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Iniciar sesión</CardTitle>
            <CardDescription>Sistema de gestión de compras e inventario</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm next={params.next} initialError={error} />
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-sm text-white/80">
          ¿No tiene cuenta?{" "}
          <Link href="/register" className="font-semibold text-white underline">
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}
