import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { nextIntlExtraction } from "./scripts/next-intl-vite";

export default defineConfig({
  plugins: [
    nextIntlExtraction(),
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
