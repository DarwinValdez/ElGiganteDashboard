import { CategoriesManager, SettingsForm, UnitsManager } from "@/app/(app)/settings/settings-client";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSettings, requirePage } from "@/lib/auth";
import { isOcrConfigured } from "@/lib/ocr";
import type { Category, Unit } from "@/lib/types";

export const metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const { supabase } = await requirePage("settings.manage");
  const [settings, { data: units }, { data: categories }] = await Promise.all([
    getSettings(),
    supabase.from("units").select("*").order("kind").order("code"),
    supabase.from("categories").select("*").order("name"),
  ]);
  const ocr = isOcrConfigured();
  return (
    <>
      <PageHeader title="Configuración del sistema" />
      <Alert variant={ocr ? "success" : "warning"} className="mb-4">
        <AlertDescription>
          {ocr
            ? `OCR conectado: proveedor ${process.env.OCR_PROVIDER ?? "anthropic"}, modelo ${process.env.OCR_MODEL ?? "claude-opus-5-5"}.`
            : "OCR no configurado: defina ANTHROPIC_API_KEY (y opcionalmente OCR_MODEL) en las variables de entorno del servidor. Mientras tanto las facturas se capturan manualmente."}
        </AlertDescription>
      </Alert>
      <div className="grid gap-4">
        <SettingsForm settings={settings} />
        <div className="grid gap-4 xl:grid-cols-2">
          <UnitsManager units={(units ?? []) as Unit[]} />
          <CategoriesManager categories={(categories ?? []) as Category[]} />
        </div>
      </div>
    </>
  );
}
