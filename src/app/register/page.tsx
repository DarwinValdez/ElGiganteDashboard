import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { RegisterForm } from "@/app/register/register-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function RegisterPage() {
  await connection();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) redirect("/setup");
  const supabase = await createClient();
  const { data: hasUsers, error } = await supabase.rpc("has_any_user");
  if (error) redirect("/setup");
  const first = hasUsers === false;

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
            <CardTitle>Crear cuenta</CardTitle>
            <CardDescription>{first ? "Primera cuenta del sistema" : "Solicitud de acceso"}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Alert variant={first ? "success" : "default"}>
              <AlertDescription>
                {first
                  ? "Todavía no hay usuarios: esta cuenta será la de ADMINISTRADOR, con acceso completo."
                  : "Su cuenta quedará pendiente hasta que un administrador la apruebe y le asigne un rol."}
              </AlertDescription>
            </Alert>
            <RegisterForm />
            <p className="text-center text-sm text-muted-foreground">
              ¿Ya tiene cuenta?{" "}
              <Link href="/login" className="font-medium text-primary underline">
                Iniciar sesión
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
