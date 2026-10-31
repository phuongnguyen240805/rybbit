import { authClient } from "../lib/auth";
import { useKediEmbed } from "../components/openseo/KediEmbedProvider";

const WHITE_LABEL_ORGANIZATIONS: Record<string, string> = { XQroMSqHm87DPcvFozpajPI7ufVdxta6: "/ruby.png" };

export function useWhiteLabel() {
  const appearance = useKediEmbed();
  const { data: activeOrganization, isPending } = authClient.useActiveOrganization();
  return {
    isWhiteLabel: !!appearance || !!WHITE_LABEL_ORGANIZATIONS[activeOrganization?.id || ""],
    whiteLabelImage: appearance ? `/kedi/logo-${appearance.theme}.png` : WHITE_LABEL_ORGANIZATIONS[activeOrganization?.id || ""],
    brandName: appearance ? "Kedi SEO" : "Rybbit",
    isPending: appearance ? false : isPending,
  };
}
