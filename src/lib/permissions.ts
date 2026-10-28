import type { Role } from "@/lib/types";

/**
 * Permisos de interfaz. La autorización real se aplica en el servidor
 * (Server Actions) y en la base de datos (RLS + funciones RPC).
 */
export const PERMISSIONS = {
  "products.write": ["admin", "purchasing"],
  "suppliers.read": ["admin", "purchasing"],
  "suppliers.write": ["admin", "purchasing"],
  "po.read": ["admin", "purchasing"],
  "po.write": ["admin", "purchasing"],
  "po.approve": ["admin"],
  "invoices.read": ["admin", "purchasing"],
  "invoices.write": ["admin", "purchasing"],
  "invoices.void": ["admin"],
  "invoices.exception": ["admin"],
  "prices.read": ["admin", "purchasing"],
  "receipts.write": ["admin", "purchasing"],
  "receipts.void": ["admin"],
  "inventory.read": ["admin", "purchasing", "employee"],
  "inventory.adjust": ["admin", "purchasing"],
  "inventory.basic": ["admin", "purchasing", "employee"],
  "payments.read": ["admin", "purchasing"],
  "payments.write": ["admin", "purchasing"],
  "payments.void": ["admin"],
  "reports.read": ["admin", "purchasing"],
  "audit.read": ["admin", "purchasing"],
  "users.manage": ["admin"],
  "settings.manage": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
