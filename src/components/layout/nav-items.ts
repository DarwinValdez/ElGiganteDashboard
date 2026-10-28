import {
  BarChart3,
  Boxes,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "General",
    items: [{ href: "/", label: "Panel principal", icon: LayoutDashboard }],
  },
  {
    title: "Compras",
    items: [
      { href: "/invoices", label: "Facturas", icon: FileText, permission: "invoices.read" },
      { href: "/purchase-orders", label: "Órdenes de compra", icon: ClipboardList, permission: "po.read" },
      { href: "/suppliers", label: "Proveedores", icon: Truck, permission: "suppliers.read" },
      { href: "/prices", label: "Costos y precios", icon: TrendingUp, permission: "prices.read" },
      { href: "/payments", label: "Pagos", icon: Wallet, permission: "payments.read" },
    ],
  },
  {
    title: "Catálogo e inventario",
    items: [
      { href: "/products", label: "Productos", icon: Package },
      { href: "/inventory", label: "Inventario", icon: Boxes, permission: "inventory.read" },
    ],
  },
  {
    title: "Análisis y control",
    items: [
      { href: "/reports", label: "Reportes", icon: BarChart3, permission: "reports.read" },
      { href: "/audit", label: "Auditoría", icon: History, permission: "audit.read" },
      { href: "/users", label: "Usuarios", icon: Users, permission: "users.manage" },
      { href: "/settings", label: "Configuración", icon: Settings, permission: "settings.manage" },
    ],
  },
];

export const BRAND_ICON = ShieldCheck;
