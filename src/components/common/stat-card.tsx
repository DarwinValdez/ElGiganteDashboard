import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  tone?: "default" | "warning" | "danger";
}) {
  const body = (
    <Card className={cn("h-full gap-1 px-5 py-4 transition-colors", href && "hover:border-primary/40")}>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        {Icon ? (
          <Icon
            className={cn(
              "size-4",
              tone === "warning" && "text-[oklch(0.6_0.13_70)]",
              tone === "danger" && "text-destructive",
              tone === "default" && "text-primary",
            )}
          />
        ) : null}
      </div>
      <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
