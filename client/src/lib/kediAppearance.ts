export const dashboardLocales = ["en", "vi", "de", "fr", "zh", "es", "pl", "it", "ko", "pt", "ja", "cs", "uk"] as const;
export type DashboardLocale = (typeof dashboardLocales)[number];
export type KediAppearance = { locale: DashboardLocale; theme: "light" | "dark" };

export function parseKediAppearance(value: unknown): KediAppearance | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!dashboardLocales.includes(input.locale as DashboardLocale) || !["light", "dark"].includes(String(input.theme))) return null;
  return { locale: input.locale as DashboardLocale, theme: input.theme as KediAppearance["theme"] };
}

export function readKediAppearanceCookie(value?: string): KediAppearance | null {
  try { return value ? parseKediAppearance(JSON.parse(decodeURIComponent(value))) : null; }
  catch { return null; }
}
