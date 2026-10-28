import type { Metadata } from "next";

import { LoginForm } from "@/app/login/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const error = params.error === "inactive" ? "Su usuario está inactivo o no tiene perfil asignado." : undefined;
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
        <p className="mt-4 text-center text-xs text-white/60">Las cuentas las crea un administrador.</p>
      </div>
    </div>
  );
}
