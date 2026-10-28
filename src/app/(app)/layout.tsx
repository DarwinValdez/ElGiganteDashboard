import { AppShell } from "@/components/layout/app-shell";
import { requirePage } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requirePage();
  return <AppShell profile={profile}>{children}</AppShell>;
}
