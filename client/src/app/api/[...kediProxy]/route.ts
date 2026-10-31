import { NextRequest, NextResponse } from "next/server";
import { kediCookie, readKediSession } from "@/api/kedi/server/session";
import { kediPathAllowed } from "@rybbit/shared";
import { readBoundedBody, RequestBodyTooLarge } from "@/api/kedi/server/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, context: { params: Promise<{ kediProxy: string[] }> }) {
  const path = (await context.params).kediProxy.join("/");
  const denied = (status: number) => NextResponse.json({ error: "KEDI_SESSION_REQUIRED" }, {
    status, headers: { "Cache-Control": "private, no-store" },
  });
  if (path.includes("..") || path.includes("\\") || path === "auth/kedi/exchange") return denied(404);
  let cookie = (request.headers.get("cookie") ?? "").split(";")
    .map(value => value.trim()).filter(value => /^(?:__Secure-)?better-auth\./.test(value)).join("; ");
  const delegated = request.cookies.has(kediCookie);
  let grant: string | undefined;
  if (delegated) {
    try {
      const session = await readKediSession(request);
      if (!session) return denied(401);
      cookie = session.cookie;
      grant = session.grant;
      if (!kediPathAllowed(path, request.method)) return denied(403);
    } catch { return denied(401); }
  }
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== process.env.OPENSEO_FRONTEND_ORIGIN) return denied(403);
  const backend = process.env.RYBBIT_INTERNAL_URL;
  if (!backend) return denied(503);
  const headers = new Headers();
  for (const name of ["accept", "content-type", "x-private-key", "x-api-key", "authorization", "user-agent", "origin"])
    if (request.headers.has(name)) headers.set(name, request.headers.get(name)!);
  if (delegated) { headers.delete("authorization"); headers.delete("x-api-key"); headers.delete("x-private-key"); }
  if (cookie) headers.set("cookie", cookie);
  if (grant) headers.set("x-kedi-seo-grant", grant);
  try {
    const upstream = await fetch(new URL(`/api/${path}${request.nextUrl.search}`, backend), {
      method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : Uint8Array.from(await readBoundedBody(request, 10 * 1024 * 1024)),
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(60000),
    });
    const responseHeaders = new Headers({ "Cache-Control": "private, no-store" });
    for (const name of ["content-type", "content-disposition", "location"])
      if (upstream.headers.has(name)) responseHeaders.set(name, upstream.headers.get(name)!);
    if (!delegated) for (const value of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", value);
    if (delegated && path === "auth/get-session") {
      const value = await upstream.json();
      // Better Auth's session DTO includes its raw database token. The SDK
      // needs identity/organization data, never that private credential.
      if (value?.session) delete value.session.token;
      return NextResponse.json(value, { status: upstream.status, headers: responseHeaders });
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (cause) { return denied(cause instanceof RequestBodyTooLarge ? 413 : 502); }
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as HEAD, proxy as OPTIONS };
