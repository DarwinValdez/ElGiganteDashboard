"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_SECTIONS } from "@/components/layout/nav-items";
import { can } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <div className="flex size-9 items-center justify-center rounded-md bg-white text-lg font-black text-sidebar">G</div>
      <div className="leading-tight">
        <div className="text-sm font-extrabold tracking-wide">EL GIGANTE</div>
        <div className="text-[10px] font-medium tracking-[0.2em] text-sidebar-foreground/70">SUPERMARKET</div>
      </div>
    </div>
  );
}

export function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((i) => !i.permission || can(role, i.permission));
        if (!items.length) return null;
        return (
          <div key={section.title}>
            <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="size-4" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
