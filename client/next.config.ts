import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const withNextIntl = createNextIntlPlugin({
  experimental: {
    srcPath: "./src",
    extract: process.env.KEDI_CLOUDFLARE_BUILD === "true" ? undefined : true,
    messages: {
      sourceLocale: "en",
      path: "./messages",
      format: "json",
      locales: ["en", "vi", "de", "fr", "zh", "es", "pl", "it", "ko", "pt", "ja", "cs", "uk"],
    },
  },
});

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["@icons-pack/react-simple-icons"],
  },
  async rewrites() {
    const backend = process.env.RYBBIT_INTERNAL_URL?.replace(/\/$/, "");
    return backend
      ? {
          // /api/user/* also matches the dynamic profile page. Route Rybbit
          // API calls first while explicitly retaining OpenSEO's local BFF.
          beforeFiles: [{ source: "/api/:path((?!(?:openseo|kedi-seo)(?:/|$)).*)",
            missing: [{ type: "cookie", key: "kedi_seo_session" }],
            destination: `${backend}/api/:path` }],
        }
      : [];
  },
  output: process.env.KEDI_CLOUDFLARE_BUILD === "true" ? undefined : "standalone",
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
    NEXT_PUBLIC_DISABLE_SIGNUP: process.env.NEXT_PUBLIC_DISABLE_SIGNUP,
    NEXT_PUBLIC_LITE_DASHBOARD: process.env.NEXT_PUBLIC_LITE_DASHBOARD,
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
  },
};

export default withNextIntl(nextConfig);
