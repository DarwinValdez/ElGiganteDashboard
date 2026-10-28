import { NewUserDialog, UserRowActions } from "@/app/(app)/users/users-client";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { Profile } from "@/lib/types";

export const metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const { supabase, profile } = await requirePage("users.manage");
  const { data } = await supabase.from("profiles").select("*").order("created_at");
  const users = (data ?? []) as Profile[];
  const hasServiceKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY);
  return (
    <>
      <PageHeader title="Usuarios y permisos" description="Administrador: acceso completo · Compras: órdenes, facturas, proveedores y precios · Empleado: productos e inventario." actions={hasServiceKey ? <NewUserDialog /> : null} />
      {!hasServiceKey ? (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>
            Para crear usuarios y cambiar contraseñas desde aquí configure SUPABASE_SERVICE_ROLE_KEY en el servidor. Mientras tanto puede invitarlos desde el panel de Supabase (Authentication → Users) y asignar el rol aquí.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Alta</TableHead>
              <TableHead>Rol y acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.full_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <ActiveBadge active={u.active} />
                </TableCell>
                <TableCell className="text-xs">{formatDateTime(u.created_at)}</TableCell>
                <TableCell>
                  <UserRowActions id={u.id} role={u.role} active={u.active} isSelf={u.id === profile.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
