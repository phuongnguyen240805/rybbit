import { Inter } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { cn } from "../lib/utils";
import "./globals.css";
import { Providers } from "./Providers";
import { KediSessionBridge } from "../components/openseo/KediSessionBridge";
import { KediEmbedProvider } from "../components/openseo/KediEmbedProvider";
import { readKediAppearanceCookie } from "../lib/kediAppearance";
import { cookies } from "next/headers";
import "./kedi-embed.css";

const inter = Inter({ subsets: ["latin"] });

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const cookieStore = await cookies();
  const appearance = process.env.KEDI_SEO_ADMIN_ORIGIN
    ? readKediAppearanceCookie(cookieStore.get("kedi_seo_appearance")?.value) : null;

  return (
    <html lang={locale} data-kedi-embed={appearance ? "true" : undefined} suppressHydrationWarning>
      <body className={cn("bg-background text-foreground h-full", inter.className)} suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <KediEmbedProvider initialAppearance={appearance} adminOrigin={process.env.KEDI_SEO_ADMIN_ORIGIN}>
          <Providers>{children}</Providers>
          <KediSessionBridge adminOrigin={process.env.KEDI_SEO_ADMIN_ORIGIN} />
          </KediEmbedProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
