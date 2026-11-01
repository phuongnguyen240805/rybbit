import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { jwtVerify } from "jose";
import { parseKediClaims, kediIdentity } from "@rybbit/shared";
import { NextRequest, NextResponse } from "next/server";
import { readBoundedBody, RequestBodyTooLarge } from "./body";

export const kediCookie = "kedi_seo_session";
type Session = { grant: string; cookie: string };
const key = () => {
  const secret = process.env.OPENSEO_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Missing session encryption key");
  return createHash("sha256").update(secret).digest();
};
export async function verifyKediGrant(token: string) {
  const secret = process.env.KEDI_SEO_SSO_SECRET;
  const issuer = process.env.KEDI_SEO_ADMIN_ORIGIN;
  if (!secret || secret.length < 32 || !issuer) throw new Error("SSO disabled");
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"], issuer, audience: "kedi-seo", requiredClaims: ["exp", "iat", "sub"],
  });
  const claims = parseKediClaims(payload);
  if (claims.embedOrigin !== process.env.OPENSEO_FRONTEND_ORIGIN) throw new Error("Wrong audience origin");
  return claims;
}
export async function readKediSession(request: NextRequest) {
  const encoded = request.cookies.get(kediCookie)?.value;
  if (!encoded) return null;
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.length > 8192) throw new Error("Invalid session");
  const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  const session: Session = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
  if (typeof session.grant !== "string" || typeof session.cookie !== "string" ||
    !/^(?:__Secure-)?better-auth\.session_token=[^;\r\n]+$/.test(session.cookie)) throw new Error("Invalid session");
  const claims = await verifyKediGrant(session.grant);
  return { ...session, claims, identity: await kediIdentity(claims) };
}
function seal(value: Session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export async function exchangeKediSession(request: NextRequest) {
  const error = (status: number) => NextResponse.json({ error: "KEDI_SESSION_REQUIRED" }, {
    status, headers: { "Cache-Control": "private, no-store" },
  });
  if (request.headers.get("origin") !== process.env.OPENSEO_FRONTEND_ORIGIN ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json") return error(403);
  try {
    const text = (await readBoundedBody(request, 4096)).toString("utf8");
    const { token } = JSON.parse(text);
    const claims = await verifyKediGrant(token);
    const identity = await kediIdentity(claims);
    let previous;
    try { previous = await readKediSession(request); } catch { /* expired grant is replaceable */ }
    const backend = process.env.RYBBIT_INTERNAL_URL;
    if (!backend) return error(503);
    const upstream = await fetch(new URL("/api/auth/kedi/exchange", backend), {
      method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: claims.embedOrigin,
        "Content-Type": "application/json", ...(previous ? { Cookie: previous.cookie } : {}) },
      body: "{}", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const sessionCookie = upstream.headers.getSetCookie().find(value => /^(?:__Secure-)?better-auth\.session_token=/.test(value));
    await upstream.body?.cancel();
    if (!upstream.ok || !sessionCookie) return error(502);
    const response = NextResponse.json({ switched: previous?.identity.userId !== identity.userId,
      expiresAt: claims.exp * 1000 }, { headers: { "Cache-Control": "private, no-store" } });
    response.cookies.set(kediCookie, seal({ grant: token, cookie: sessionCookie.split(";")[0] }), {
      httpOnly: true, secure: claims.embedOrigin.startsWith("https:"), sameSite: "lax", path: "/",
      // Keep an expired marker: never fall back to another native login.
      maxAge: 8 * 3600,
    });
    // Renew the same native session. Revoking it during renewal races API
    // requests already in flight and can incorrectly sign the iframe out.
    return response;
  } catch (cause) { return error(cause instanceof RequestBodyTooLarge ? 413 : 401); }
}
