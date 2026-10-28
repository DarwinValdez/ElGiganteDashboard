"use client";

import { useState } from "react";
import { LogOut, Menu, UserCircle } from "lucide-react";

import { signOut } from "@/app/login/actions";
import { Brand, SidebarNav } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ROLE_LABELS } from "@/lib/labels";
import type { Profile } from "@/lib/types";

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="no-print hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex lg:sticky lg:top-0 lg:h-dvh">
        <Brand />
        <SidebarNav role={profile.role} />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Menú</SheetTitle>
          <Brand />
          <SidebarNav role={profile.role} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu />
          </Button>
          <div className="text-sm font-semibold lg:hidden">EL GIGANTE SUPERMARKET</div>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2">
                  <UserCircle className="size-5" />
                  <span className="hidden max-w-40 truncate sm:inline">{profile.full_name ?? profile.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="truncate">{profile.email}</div>
                  <div className="text-xs font-normal text-muted-foreground">{ROLE_LABELS[profile.role]}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <form action={signOut}>
                  <DropdownMenuItem asChild>
                    <button type="submit" className="w-full">
                      <LogOut /> Cerrar sesión
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
