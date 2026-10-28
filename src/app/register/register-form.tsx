"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";

import { register } from "@/app/register/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RegisterForm() {
  const [state, action, pending] = useActionState(register, undefined);

  if (state?.done === "confirm_email") {
    return (
      <Alert variant="success">
        <MailCheck />
        <AlertTitle>Revise su correo</AlertTitle>
        <AlertDescription>Le enviamos un enlace para confirmar la cuenta. Después de confirmarlo podrá iniciar sesión.</AlertDescription>
      </Alert>
    );
  }
  if (state?.done === "pending") {
    return (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertTitle>Cuenta creada</AlertTitle>
        <AlertDescription>
          Un administrador debe aprobarla y asignarle un rol antes de que pueda entrar.{" "}
          <Link href="/login" className="underline">
            Volver a iniciar sesión
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="full_name">Nombre completo</Label>
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm">Repetir contraseña</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      {state?.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 className="animate-spin" /> : null}
        Crear cuenta
      </Button>
    </form>
  );
}
