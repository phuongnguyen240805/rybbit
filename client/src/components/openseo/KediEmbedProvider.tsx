"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { parseKediAppearance, type KediAppearance } from "@/lib/kediAppearance";

const KediEmbedContext = createContext<KediAppearance | null>(null);
export const useKediEmbed = () => useContext(KediEmbedContext);

export function KediEmbedProvider({ children, initialAppearance, adminOrigin }: {
  children: React.ReactNode; initialAppearance: KediAppearance | null; adminOrigin?: string;
}) {
  const [appearance, setAppearance] = useState(initialAppearance);
  const locale = useLocale();
  const router = useRouter();
  useEffect(() => {
    if (!adminOrigin || window.parent === window) {
      setAppearance(null);
      return;
    }
    const receive = (event: MessageEvent) => {
      if (event.origin !== adminOrigin || event.source !== window.parent || event.data?.type !== "kedi-seo:appearance") return;
      const next = parseKediAppearance(event.data.appearance);
      if (!next) return;
      setAppearance(next);
      const secure = location.protocol === "https:" ? ";Secure" : "";
      document.cookie = `kedi_seo_appearance=${encodeURIComponent(JSON.stringify(next))};path=/;max-age=31536000;SameSite=Lax${secure}`;
      if (next.locale !== locale) {
        document.cookie = `NEXT_LOCALE=${next.locale};path=/;max-age=31536000;SameSite=Lax${secure}`;
        router.refresh();
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [adminOrigin, locale, router]);
  useEffect(() => {
    if (appearance) document.documentElement.dataset.kediEmbed = "true";
    else delete document.documentElement.dataset.kediEmbed;
  }, [appearance]);
  return <KediEmbedContext.Provider value={appearance}>{children}</KediEmbedContext.Provider>;
}
