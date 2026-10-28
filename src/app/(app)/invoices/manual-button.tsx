"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Keyboard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createManualInvoice } from "@/app/(app)/invoices/actions";
import { Button } from "@/components/ui/button";

export function ManualInvoiceButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await createManualInvoice();
          if (!res.ok) return void toast.error(res.error);
          router.push(`/invoices/${res.data!.id}`);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Keyboard />} Captura manual
    </Button>
  );
}
