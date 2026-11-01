import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const action = process.argv[2];
if (!["build", "deploy"].includes(action)) throw new Error("Use build or deploy");
// Keep Docker's .env.local endpoints and development keys out of this build.
const envFile = process.env.KEDI_SEO_CONFIG_FILE ?? ".env.cloudflare.local";
const env = { ...process.env };
if (existsSync(envFile)) {
  const previous = { ...process.env };
  process.loadEnvFile(envFile);
  Object.assign(env, process.env);
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
}
const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
for (const key of ["RYBBIT_INTERNAL_URL", "OPENSEO_INTERNAL_URL", "OPENSEO_BASE_URL",
  "OPENSEO_SESSION_SECRET", "KEDI_SEO_SSO_SECRET"])
  env[key] ??= "";
env.KEDI_SEO_ADMIN_ORIGIN ??= config.vars.KEDI_SEO_ADMIN_ORIGIN;
env.OPENSEO_FRONTEND_ORIGIN ??= config.vars.OPENSEO_FRONTEND_ORIGIN;
env.NEXT_PUBLIC_BACKEND_URL ??= config.vars.OPENSEO_FRONTEND_ORIGIN;
env.NEXT_PUBLIC_CLOUD = "false";
env.NEXT_PUBLIC_LITE_DASHBOARD = "false";
env.NEXT_PUBLIC_DISABLE_SIGNUP = "true";
env.KEDI_CLOUDFLARE_BUILD = "true";
for (const key of ["NEXT_PUBLIC_BACKEND_URL", "KEDI_SEO_ADMIN_ORIGIN", "OPENSEO_FRONTEND_ORIGIN",
  "RYBBIT_INTERNAL_URL", "OPENSEO_BASE_URL", "OPENSEO_INTERNAL_URL"]) {
  if (!env[key]) continue;
  const url = new URL(env[key]);
  if (url.protocol !== "https:" || url.origin !== env[key])
    throw new Error(`${key} must be an HTTPS origin without a trailing slash`);
}
env.RAYON_NUM_THREADS ??= "2";
env.NODE_OPTIONS ??= "--max-old-space-size=2048";

function pnpm(...args) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
pnpm("--filter", "@rybbit/shared", "build");
pnpm("exec", "vite", "build");
if (action === "deploy") {
  const secretFile = process.env.KEDI_SEO_SECRETS_FILE;
  pnpm("exec", "wrangler", "deploy", ...(secretFile ? ["--secrets-file", secretFile] : []));
}
