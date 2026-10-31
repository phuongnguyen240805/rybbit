import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const cookieName = "openseo_session";
const id = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const auditPath = new RegExp(`^projects/${id}/audits(?:/${id}(?:/results)?)?$`);
const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(1024) }).strict();

function publicOrigin(value: string) {
  const url = new URL(value);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !localHttp)
  )
    throw new Error("Invalid public origin");
  return url;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function sessionCookie(request: NextRequest, userId: string, secret: string): string | null {
  const encoded = request.cookies.get(cookieName)?.value;
  if (!encoded || encoded.length > 4096) return null;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      bytes.subarray(0, 12)
    );
    decipher.setAuthTag(bytes.subarray(12, 28));
    const value = z
      .object({ userId: z.string(), cookie: z.string() })
      .parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
    return value.userId === userId && /^(?:__Secure-)?better-auth\.session_token=[^;\r\n]+$/.test(value.cookie)
      ? value.cookie
      : null;
  } catch {
    return null;
  }
}

function sealSession(cookie: string, userId: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ cookie, userId })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

async function readBody(request: Request) {
  if (!request.body) throw new Error("Invalid body");
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) throw new Error("Body too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel();
  }
}

// Only this fixed, operator-configured origin receives OpenSEO credentials.
// Do not use authedFetch here: that would forward Rybbit's private-link header.
export async function handleOpenSeoProxy(request: NextRequest, segments: string[]) {
  const path = segments.join("/");
  const method = request.method;
  const isSession = path === "session";
  const allowed = isSession
    ? ["GET", "POST", "DELETE"].includes(method)
    : (method === "GET" && (path === "projects" || auditPath.test(path))) ||
      (method === "POST" && new RegExp(`^projects/${id}/audits$`).test(path));
  if (!allowed || request.nextUrl.search) return jsonError("NOT_FOUND", 404);
  let frontendOrigin: URL;
  try {
    frontendOrigin = publicOrigin(process.env.OPENSEO_FRONTEND_ORIGIN ?? request.nextUrl.origin);
  } catch {
    return jsonError("OPENSEO_NOT_CONFIGURED", 503);
  }
  if (
    method !== "GET" &&
    (request.headers.get("origin") !== frontendOrigin.origin || request.headers.get("x-openseo-client") !== "rybbit")
  )
    return jsonError("FORBIDDEN", 403);
  const secureCookie = process.env.NODE_ENV === "production" && frontendOrigin.protocol === "https:";

  let base: URL;
  let target: URL;
  const secret = process.env.OPENSEO_SESSION_SECRET ?? "";
  try {
    if (secret.length < 32) throw new Error();
    base = publicOrigin(process.env.OPENSEO_BASE_URL ?? "");
    target = new URL(process.env.OPENSEO_INTERNAL_URL ?? base.origin);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.pathname !== "/" ||
      target.search ||
      target.hash
    )
      throw new Error();
  } catch {
    return jsonError("OPENSEO_NOT_CONFIGURED", 503);
  }

  // Bind the secondary session to the current, server-verified Rybbit user.
  // Logging out of Rybbit or switching accounts cannot reuse another user's
  // OpenSEO session left in this browser. Never send that cookie to Rybbit.
  const rybbitCookie = (request.headers.get("cookie") ?? "")
    .split(";")
    .map(value => value.trim())
    .filter(value => /^(?:__Secure-)?better-auth\./.test(value))
    .join("; ");
  if (!rybbitCookie) return jsonError("UNAUTHENTICATED", 401);
  let userId: string;
  try {
    const backend = new URL(process.env.RYBBIT_INTERNAL_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? "");
    const session = await fetch(new URL("/api/auth/get-session", backend), {
      headers: { Cookie: rybbitCookie },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = z.object({ user: z.object({ id: z.string() }) }).safeParse(await session.json());
    if (!session.ok || !parsed.success) return jsonError("UNAUTHENTICATED", 401);
    userId = parsed.data.user.id;
  } catch {
    return jsonError("RYBBIT_AUTH_UNAVAILABLE", 502);
  }

  const cookie = sessionCookie(request, userId, secret);
  if (!cookie && !(isSession && method === "POST")) return jsonError("UNAUTHENTICATED", 401);
  let body: string | undefined;
  if (method === "POST") {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonError("VALIDATION_ERROR", 400);
    try {
      const input = await readBody(request);
      body = JSON.stringify(isSession ? credentialsSchema.parse(input) : input);
    } catch {
      return jsonError("VALIDATION_ERROR", 400);
    }
  }

  const upstreamPath =
    isSession && method === "POST"
      ? "/api/auth/sign-in/email"
      : isSession && method === "DELETE"
        ? "/api/auth/sign-out"
        : `/api/integrations/v1/${path}`;
  try {
    const upstream = await fetch(new URL(upstreamPath, target), {
      method: method === "DELETE" ? "POST" : method,
      headers: {
        "Content-Type": "application/json",
        "X-OpenSEO-Client": "rybbit",
        Origin: base.origin,
        ...(cookie && !(isSession && method === "POST") ? { Cookie: cookie } : {}),
      },
      body: method === "DELETE" ? "{}" : body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (upstream.status >= 300 && upstream.status < 400) return jsonError("OPENSEO_REDIRECT_REJECTED", 502);
    let response: NextResponse;
    if (isSession && method === "POST") {
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return jsonError(
          upstream.status === 429 ? "RATE_LIMITED" : upstream.status >= 500 ? "OPENSEO_UNAVAILABLE" : "SIGN_IN_FAILED",
          upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 401
        );
      }
      const setCookie = upstream.headers
        .getSetCookie()
        .find(value => /^(?:__Secure-)?better-auth\.session_token=/.test(value));
      await upstream.body?.cancel();
      if (!setCookie) return jsonError("OPENSEO_SESSION_MISSING", 502);
      response = NextResponse.json({ data: { connected: true } });
      const maxAge = Number(setCookie.match(/;\s*Max-Age=(\d+)/i)?.[1] ?? 3600);
      response.cookies.set(cookieName, sealSession(setCookie.split(";")[0], userId, secret), {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "strict",
        path: "/api/openseo",
        maxAge: Math.min(maxAge, 7 * 24 * 3600),
      });
    } else if (isSession && method === "DELETE") {
      await upstream.body?.cancel();
      response = NextResponse.json({ data: { connected: false } }, { status: upstream.ok ? 200 : 502 });
      response.cookies.set(cookieName, "", {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "strict",
        path: "/api/openseo",
        maxAge: 0,
      });
    } else {
      if (!upstream.headers.get("content-type")?.includes("application/json")) {
        await upstream.body?.cancel();
        return jsonError("OPENSEO_INVALID_RESPONSE", 502);
      }
      response = new NextResponse(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    const response = jsonError("OPENSEO_UNAVAILABLE", 502);
    if (isSession && method === "DELETE") response.cookies.set(cookieName, "", { path: "/api/openseo", maxAge: 0 });
    return response;
  }
}
