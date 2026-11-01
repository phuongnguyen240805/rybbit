import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { exchangeKediSession, readKediSession, kediCookie } from "./session";
import { kediIdentity, kediPathAllowed, kediReadOnlyRequest, parseKediClaims } from "@rybbit/shared";
import { handleOpenSeoProxy } from "@/api/openseo/server/proxy";
import { GET as proxyRybbit, POST as proxyPost } from "@/app/api/[...kediProxy]/route";

const secret = "local-test-key-never-use-outside-tests-123456";
const issuer = "https://admin.example.com";
const frontend = "https://seo.example.com";
const organizationId = "63e88734-ce1f-4afb-a3ce-b1dce2e5d15c";
const network = vi.fn<typeof fetch>();
async function grant(overrides: Record<string, unknown> = {}, signingKey = secret) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ organizationId, tenantId: 1, appCode: "kedipage", role: "owner",
    embedOrigin: frontend, sub: "12", iss: issuer, aud: "kedi-seo", iat: now, exp: now + 60, ...overrides,
  }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(signingKey));
}
function request(token: string, origin = frontend) {
  return new NextRequest(`${frontend}/api/kedi-seo/session`, { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
}
beforeEach(() => {
  vi.stubEnv("KEDI_SEO_SSO_SECRET", secret);
  vi.stubEnv("KEDI_SEO_ADMIN_ORIGIN", issuer);
  vi.stubEnv("OPENSEO_FRONTEND_ORIGIN", frontend);
  vi.stubEnv("OPENSEO_SESSION_SECRET", secret);
  vi.stubEnv("OPENSEO_BASE_URL", "https://openseo.example.com");
  vi.stubEnv("RYBBIT_INTERNAL_URL", "http://backend:3001");
  network.mockReset();
  network.mockResolvedValue(Response.json({}, { headers: {
    "Set-Cookie": "better-auth.session_token=private-native-token; HttpOnly; Path=/",
  } }));
  vi.stubGlobal("fetch", network);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Kedi SSO boundary", () => {
  it("exchanges a signed grant into an encrypted HttpOnly session", async () => {
    const token = await grant();
    const response = await exchangeKediSession(request(token));
    expect(response.status).toBe(200);
    const value = response.cookies.get(kediCookie)!;
    expect(value.httpOnly).toBe(true);
    expect(value.secure).toBe(true);
    expect(value.value).not.toContain("private-native-token");
    expect(JSON.stringify(await response.json())).not.toContain(token);
    const session = await readKediSession(new NextRequest(frontend, { headers: {
      Cookie: `${kediCookie}=${value.value}`,
    } }));
    expect(session?.claims.sub).toBe("12");
    expect(session?.cookie).toBe("better-auth.session_token=private-native-token");
  });
  it.each([
    ["expired", { exp: 1 }], ["wrong audience", { aud: "other" }],
    ["wrong issuer", { iss: "https://evil.example.com" }], ["wrong frontend", { embedOrigin: "https://evil.example.com" }],
    ["excessive lifetime", { exp: Math.floor(Date.now() / 1000) + 3600 }],
  ])("rejects %s grants before calling the backend", async (_name, overrides) => {
    expect((await exchangeKediSession(request(await grant(overrides)))).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects signature tampering and cross-origin exchange", async () => {
    expect((await exchangeKediSession(request(await grant({}, "wrong-key-long-enough-but-incorrect")))).status).toBe(401);
    expect((await exchangeKediSession(request(await grant(), "https://evil.example.com"))).status).toBe(403);
    expect(network).not.toHaveBeenCalled();
  });
  it("bounds streamed exchange bodies even without Content-Length", async () => {
    const response = await exchangeKediSession(request("x".repeat(5000)));
    expect(response.status).toBe(413);
    expect(network).not.toHaveBeenCalled();
  });
  it("renews an existing private session without revoking in-flight requests", async () => {
    const token = await grant();
    const first = await exchangeKediSession(request(token));
    const cookie = first.cookies.get(kediCookie)!;
    const renewal = request(token);
    renewal.cookies.set(kediCookie, cookie.value);
    const response = await exchangeKediSession(renewal);
    expect(response.status).toBe(200);
    expect((await response.json()).switched).toBe(false);
    expect(new Headers(network.mock.calls[1][1]?.headers).get("cookie")).toBe("better-auth.session_token=private-native-token");
    expect(network).toHaveBeenCalledTimes(2);
  });
  it("removes native session credentials from the browser-facing session DTO", async () => {
    const first = await exchangeKediSession(request(await grant()));
    const cookie = first.cookies.get(kediCookie)!;
    network.mockResolvedValueOnce(Response.json({ user: { id: "person" }, session: {
      token: "must-stay-private", activeOrganizationId: "org", id: "session-id",
    } }));
    const response = await proxyRybbit(new NextRequest(`${frontend}/api/auth/get-session`, {
      headers: { Cookie: `${kediCookie}=${cookie.value}` },
    }), { params: Promise.resolve({ kediProxy: ["auth", "get-session"] }) });
    expect(await response.json()).toEqual({ user: { id: "person" }, session: {
      activeOrganizationId: "org", id: "session-id",
    } });
  });
  it("separates identities across tenants and subjects without email linking", async () => {
    const base = { iss: issuer, sub: "12", organizationId, tenantId: 1, appCode: "kedipage",
      role: "owner", embedOrigin: frontend, iat: 1, exp: 61 };
    const first = await kediIdentity(parseKediClaims(base));
    const otherTenant = await kediIdentity(parseKediClaims({ ...base, tenantId: 2 }));
    const colleague = await kediIdentity(parseKediClaims({ ...base, sub: "13" }));
    expect(otherTenant.organizationId).not.toBe(first.organizationId);
    expect(otherTenant.userId).not.toBe(first.userId);
    expect(colleague.organizationId).toBe(first.organizationId);
    expect(colleague.userId).not.toBe(first.userId);
  });
  it("does not fall back to an existing native account when delegated cookies are invalid", async () => {
    const response = await handleOpenSeoProxy(new NextRequest(`${frontend}/api/openseo/session`, {
      headers: { Cookie: `${kediCookie}=corrupt; better-auth.session_token=native-other-user` },
    }), ["session"]);
    expect(response.status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
  it("keeps password, membership and credential management in Kedi", () => {
    expect(kediPathAllowed("auth/change-password", "POST")).toBe(false);
    expect(kediPathAllowed("organizations/org/users", "POST")).toBe(false);
    expect(kediPathAllowed("organizations/org/sites", "POST")).toBe(true);
    expect(kediPathAllowed("sites/1/transfer", "POST")).toBe(false);
    expect(kediPathAllowed("analytics", "GET")).toBe(true);
  });
  it.each(["site-cards", "site-cards-lite"])("forwards read-only POST %s with the user's proof and query body", async endpoint => {
    const first = await exchangeKediSession(request(await grant({ role: "staff" })));
    const cookie = first.cookies.get(kediCookie)!;
    network.mockResolvedValueOnce(Response.json({ data: { 2: { current: { sessions: 0, users: 0 }, series: [] } } }));
    const path = `organizations/${organizationId}/${endpoint}`;
    const body = { siteIds: [2], comparison: null };
    const response = await proxyPost(new NextRequest(`${frontend}/api/${path}?bucket=hour`, {
      method: "POST", headers: { Cookie: `${kediCookie}=${cookie.value}`, Origin: frontend, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ kediProxy: path.split("/") }) });
    expect(response.status).toBe(200);
    expect(new Headers(network.mock.calls[1][1]?.headers).get("x-kedi-seo-grant")).toBeTruthy();
    expect(JSON.parse(Buffer.from(network.mock.calls[1][1]?.body as Uint8Array).toString())).toEqual(body);
  });
  it("does not classify nearby organization mutations as reads", () => {
    expect(kediReadOnlyRequest("organizations/org/sites", "POST")).toBe(false);
    expect(kediReadOnlyRequest("organizations/org/members", "POST")).toBe(false);
    expect(kediPathAllowed("organizations/org/site-cards/delete", "POST")).toBe(false);
    expect(kediReadOnlyRequest("organizations/org/site-cards", "DELETE")).toBe(false);
  });
});
