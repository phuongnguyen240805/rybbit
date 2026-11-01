import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { kediIdentity, type KediClaims } from "@rybbit/shared";
import { kediSessionGuard } from "./kediSso.js";

vi.mock("../db/postgres/postgres.js", () => ({ db: {} }));
vi.mock("./auth-utils.js", () => ({ invalidateSitesAccessCache: vi.fn() }));
const secret = "a-test-key-for-kedi-read-only-post-routes-at-least-32";
const origin = "http://localhost:3002";
const issuer = "http://localhost:3000";
const claims: KediClaims = { iss: issuer, sub: "staff", organizationId: "org", tenantId: 1,
  appCode: "kedi", role: "staff", embedOrigin: origin, iat: 0, exp: 60 };

beforeEach(() => {
  vi.stubEnv("KEDI_SEO_SSO_SECRET", secret);
  vi.stubEnv("KEDI_SEO_ADMIN_ORIGIN", issuer);
  vi.stubEnv("BASE_URL", origin);
});
afterEach(() => vi.unstubAllEnvs());

async function appFor(role: KediClaims["role"]) {
  const now = Math.floor(Date.now() / 1000);
  const value = { ...claims, role, iat: now, exp: now + 60 };
  const identity = await kediIdentity(value);
  const token = await new SignJWT(value).setProtectedHeader({ alg: "HS256" }).setAudience("kedi-seo")
    .sign(new TextEncoder().encode(secret));
  const auth = { api: { getSession: async () => ({ user: { id: identity.userId } }) } };
  const app = Fastify();
  app.addHook("preHandler", kediSessionGuard(auth as unknown as Parameters<typeof kediSessionGuard>[0]));
  app.post("/api/organizations/:id/:endpoint", async () => ({ reachedNativeGuard: true }));
  return { app, headers: { cookie: "better-auth.session_token=private", "x-kedi-seo-grant": token } };
}

describe("Kedi SSO read-only POSTs", () => {
  it.each(["owner", "admin", "staff"] as const)("allows %s to reach native analytics guards", async role => {
    const { app, headers } = await appFor(role);
    try {
      for (const endpoint of ["site-cards", "site-cards-lite"]) {
        const response = await app.inject({ method: "POST", url: `/api/organizations/org/${endpoint}`, headers, payload: {} });
        expect(response.statusCode).toBe(200);
      }
    } finally { await app.close(); }
  });
  it("still blocks staff writes and missing proofs", async () => {
    const { app, headers } = await appFor("staff");
    try {
      expect((await app.inject({ method: "POST", url: "/api/organizations/org/sites", headers, payload: {} })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/api/organizations/org/site-cards", headers: { cookie: headers.cookie }, payload: {} })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
