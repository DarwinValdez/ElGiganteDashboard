"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import { createUser, resetUserPassword, setUserActive, updateUserRole } from "@/app/(app)/users/actions";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ROLE_LABELS } from "@/lib/labels";
import type { Role } from "@/lib/types";
import { newUserSchema } from "@/lib/validations";

export function NewUserDialog() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { register, handleSubmit, formState, reset } = useForm<z.input<typeof newUserSchema>>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { email: "", full_name: "", password: "", role: "employee" },
  });
  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Nuevo usuario
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear usuario</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={handleSubmit((v) =>
            start(async () => {
              const res = await createUser(v);
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.message);
              reset();
              setOpen(false);
              router.refresh();
            }),
          )}
        >
          <Field label="Nombre completo" error={e.full_name?.message} required>
            <Input {...register("full_name")} />
          </Field>
          <Field label="Correo" error={e.email?.message} required>
            <Input type="email" {...register("email")} />
          </Field>
          <Field label="Contraseña inicial" error={e.password?.message} required hint="Comuníquela de forma segura; el usuario puede cambiarla después">
            <Input type="password" autoComplete="new-password" {...register("password")} />
          </Field>
          <Field label="Rol" required>
            <NativeSelect {...register("role")}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null} Crear usuario
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UserRowActions({ id, role, active, isSelf }: { id: string; role: Role; active: boolean; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else toast.error(res.error);
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect className="h-8 w-48" value={role} disabled={pending} onChange={(e) => run(() => updateUserRole(id, e.target.value as Role))}>
        {Object.entries(ROLE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </NativeSelect>
      {!isSelf ? (
        <Button size="sm" variant={active ? "outline" : "default"} disabled={pending} onClick={() => run(() => setUserActive(id, !active))}>
          {active ? "Desactivar" : "Activar"}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          const pwd = window.prompt("Nueva contraseña (mínimo 8 caracteres)");
          if (pwd) run(() => resetUserPassword(id, pwd));
        }}
      >
        <KeyRound /> Contraseña
      </Button>
    </div>
  );
}
