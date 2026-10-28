import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { runSetupChecks } from "@/lib/setup-check";

export const metadata = { title: "Configuración inicial" };

export default async function SetupPage() {
  await connection();
  const { ready, checks } = await runSetupChecks();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-sidebar p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>EL GIGANTE SUPERMARKET · Configuración</CardTitle>
          <CardDescription>
            {ready ? "Todo listo: la aplicación puede usarse." : "La aplicación todavía no está conectada a Supabase. Complete los pasos marcados en rojo."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="grid gap-2">
            {checks.map((c) => (
              <li key={c.key} className="flex gap-3 rounded-md border p-3 text-sm">
                {c.state === "ok" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                ) : c.state === "warning" ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[oklch(0.6_0.13_70)]" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <div className="min-w-0">
                  <div className="font-medium break-all">{c.label}</div>
                  <div className="text-muted-foreground break-words">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          {!ready ? (
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>En Supabase → Project Settings → API Keys copie la URL del proyecto y la clave publicable (o anon).</li>
              <li>
                En Vercel → su proyecto → Settings → Environment Variables agregue <code>NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
                <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> para <strong>Production y Preview</strong>.
              </li>
              <li>En Supabase → SQL Editor ejecute, en orden, los archivos de <code>supabase/migrations/</code>.</li>
              <li>
                En Vercel → Deployments → los tres puntos del último despliegue → <strong>Redeploy</strong> (las variables
                <code> NEXT_PUBLIC_</code> se incorporan al compilar).
              </li>
              <li>En Supabase → Authentication → Users cree su usuario: el primero será administrador.</li>
            </ol>
          ) : (
            <Button asChild>
              <Link href="/login">Ir a iniciar sesión</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
