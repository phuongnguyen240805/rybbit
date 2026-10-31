import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleOpenSeoProxy } from "./proxy";

const network = vi.fn<typeof fetch>();
const projectId = "63e88734-ce1f-4afb-a3ce-b1dce2e5d15c";
const browserCookie = "better-auth.session_token=rybbit-token";
let rybbitUser = "rybbit-a";
let upstream: (url: string, init?: RequestInit) => Response;

function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = browserCookie,
  origin = "https://analytics.example.com"
) {
  return new NextRequest(`https://analytics.example.com/api/openseo/${path}`, {
    method,
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "X-OpenSEO-Client": "rybbit" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function connect() {
  upstream = () =>
    Response.json(
      { token: "must-not-reach-browser" },
      { headers: { "Set-Cookie": "__Secure-better-auth.session_token=openseo-token; Max-Age=3600; Secure; HttpOnly" } }
    );
  return handleOpenSeoProxy(request("session", "POST", { email: "person@example.com", password: "password" }), [
    "session",
  ]);
}

beforeEach(() => {
  vi.stubEnv("OPENSEO_BASE_URL", "https://seo.example.com");
  vi.stubEnv("OPENSEO_SESSION_SECRET", "a-private-test-secret-of-at-least-32-characters");
  vi.stubEnv("RYBBIT_INTERNAL_URL", "https://rybbit-backend.example.com");
  rybbitUser = "rybbit-a";
  upstream = () => Response.json({ data: [] });
  network.mockReset();
  network.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "https://rybbit-backend.example.com/api/auth/get-session")
      return Response.json({ user: { id: rybbitUser } });
    return upstream(url, init);
  });
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OpenSEO BFF", () => {
  it("stores an encrypted HttpOnly session and never returns the upstream token", async () => {
    const response = await connect();
    expect(await response.json()).toEqual({ data: { connected: true } });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).toContain("Path=/api/openseo");
    expect(cookie).not.toContain("openseo-token");
  });

  it("requires a live Rybbit session even when OpenSEO credentials are supplied", async () => {
    const response = await handleOpenSeoProxy(
      request("session", "POST", { email: "a@b.com", password: "password" }, ""),
      ["session"]
    );
    expect(response.status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });

  it("blocks cross-origin login CSRF before any upstream request", async () => {
    const response = await handleOpenSeoProxy(
      request("session", "POST", {}, browserCookie, "https://attacker.example"),
      ["session"]
    );
    expect(response.status).toBe(403);
    expect(network).not.toHaveBeenCalled();
  });

  it("forwards only the OpenSEO cookie to the fixed SEO backend", async () => {
    const login = await connect();
    const encrypted = login.cookies.get("openseo_session")!.value;
    network.mockClear();
    const response = await handleOpenSeoProxy(
      request("projects", "GET", undefined, `${browserCookie}; openseo_session=${encrypted}`),
      ["projects"]
    );
    expect(response.status).toBe(200);
    const seoCall = network.mock.calls.find(([url]) => String(url).startsWith("https://seo.example.com/"))!;
    expect(new Headers(seoCall[1]?.headers).get("Cookie")).toBe("__Secure-better-auth.session_token=openseo-token");
    const rybbitCall = network.mock.calls[0];
    expect(new Headers(rybbitCall[1]?.headers).get("Cookie")).toBe(browserCookie);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("refuses the previous Rybbit user's secondary session after an account switch", async () => {
    const login = await connect();
    const encrypted = login.cookies.get("openseo_session")!.value;
    network.mockClear();
    rybbitUser = "rybbit-b";
    const response = await handleOpenSeoProxy(
      request("projects", "GET", undefined, `${browserCookie}; openseo_session=${encrypted}`),
      ["projects"]
    );
    expect(response.status).toBe(401);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("rejects cookie tampering", async () => {
    expect(
      (
        await handleOpenSeoProxy(request("projects", "GET", undefined, `${browserCookie}; openseo_session=forged`), [
          "projects",
        ])
      ).status
    ).toBe(401);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("does not expose arbitrary upstream routes or accept a user-selected host", async () => {
    expect((await handleOpenSeoProxy(request("auth/admin"), ["auth", "admin"])).status).toBe(404);
    expect((await handleOpenSeoProxy(request("projects?url=https://attacker.example"), ["projects"])).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects upstream redirects instead of following them with credentials", async () => {
    const login = await connect();
    const encrypted = login.cookies.get("openseo_session")!.value;
    upstream = () => new Response(null, { status: 302, headers: { Location: "https://attacker.example" } });
    const response = await handleOpenSeoProxy(
      request(`projects/${projectId}/audits`, "GET", undefined, `${browserCookie}; openseo_session=${encrypted}`),
      ["projects", projectId, "audits"]
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "OPENSEO_REDIRECT_REJECTED" });
  });

  it("preserves rate limiting on sign-in", async () => {
    upstream = () => new Response("slow down", { status: 429 });
    expect(
      (
        await handleOpenSeoProxy(request("session", "POST", { email: "person@example.com", password: "password" }), [
          "session",
        ])
      ).status
    ).toBe(429);
  });

  it("returns a safe outage response", async () => {
    const login = await connect();
    const encrypted = login.cookies.get("openseo_session")!.value;
    upstream = () => {
      throw new Error("private network details");
    };
    const response = await handleOpenSeoProxy(
      request("projects", "GET", undefined, `${browserCookie}; openseo_session=${encrypted}`),
      ["projects"]
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "OPENSEO_UNAVAILABLE" });
  });

  it("revokes the upstream session and clears the local cookie on disconnect", async () => {
    const login = await connect();
    const encrypted = login.cookies.get("openseo_session")!.value;
    network.mockClear();
    upstream = () => Response.json({ success: true });
    const response = await handleOpenSeoProxy(
      request("session", "DELETE", undefined, `${browserCookie}; openseo_session=${encrypted}`),
      ["session"]
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(String(network.mock.calls[1][0])).toBe("https://seo.example.com/api/auth/sign-out");
  });
});
