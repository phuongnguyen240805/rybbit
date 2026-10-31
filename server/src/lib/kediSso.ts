import { jwtVerify } from "jose";
import { createAuthEndpoint, APIError, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { kediIdentity, parseKediClaims, kediPathAllowed } from "@rybbit/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { auth as Auth } from "./auth.js";
import { eq } from "drizzle-orm";
import { db } from "../db/postgres/postgres.js";
import { user, organization, member } from "../db/postgres/schema.js";
import { invalidateSitesAccessCache } from "./auth-utils.js";

export function kediSessionGuard(auth: typeof Auth) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const cookie = request.headers.cookie;
    if (!cookie?.includes("better-auth.session_token") || request.url.split("?")[0] === "/api/auth/kedi/exchange") return;
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session?.user.id.startsWith("kedi-")) return;
    try {
      const secret = process.env.KEDI_SEO_SSO_SECRET;
      if (!secret || secret.length < 32) throw new Error();
      const { payload } = await jwtVerify(String(request.headers["x-kedi-seo-grant"] ?? ""), new TextEncoder().encode(secret), {
        algorithms: ["HS256"], issuer: process.env.KEDI_SEO_ADMIN_ORIGIN,
        audience: "kedi-seo", requiredClaims: ["exp", "iat", "sub"],
      });
      const claims = parseKediClaims(payload);
      const identity = await kediIdentity(claims);
      if (claims.embedOrigin !== process.env.BASE_URL || identity.userId !== session.user.id ||
        (claims.role === "staff" && !["GET", "HEAD"].includes(request.method)) ||
        !kediPathAllowed(request.url.split("?")[0].replace(/^\/api\//, ""), request.method)) throw new Error();
    } catch { return reply.code(403).send({ error: "KEDI_SESSION_REQUIRED" }); }
  };
}

export function kediSsoPlugin() {
  return {
    id: "kedi-sso",
    endpoints: {
      kediExchange: createAuthEndpoint("/kedi/exchange", { method: "POST" }, async ctx => {
        const secret = process.env.KEDI_SEO_SSO_SECRET;
        const issuer = process.env.KEDI_SEO_ADMIN_ORIGIN;
        if (!secret || secret.length < 32 || !issuer) throw new APIError("NOT_FOUND");
        let claims;
        try {
          const token = ctx.headers?.get("authorization")?.replace(/^Bearer /, "") ?? "";
          const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
            algorithms: ["HS256"], issuer, audience: "kedi-seo", requiredClaims: ["exp", "iat", "sub"],
          });
          claims = parseKediClaims(payload);
          if (claims.embedOrigin !== process.env.BASE_URL) throw new Error();
        } catch { throw new APIError("UNAUTHORIZED"); }
        const identity = await kediIdentity(claims);
        const now = new Date().toISOString();
        const role = claims.role === "staff" ? "viewer" : "admin";
        // Namespace by issuer + app + tenant + subject. Email never links an
        // external identity to an existing password account or another tenant.
        await db.transaction(async tx => {
          await tx.insert(user).values({ id: identity.userId, email: identity.email,
            name: `Kedi ${claims.sub}`, emailVerified: true, createdAt: now, updatedAt: now,
          }).onConflictDoNothing({ target: user.id });
          await tx.insert(organization).values({ id: identity.organizationId,
            slug: identity.organizationId, name: `Kedi workspace ${claims.tenantId}`, createdAt: now,
          }).onConflictDoNothing({ target: organization.id });
          await tx.insert(member).values({ id: identity.userId, userId: identity.userId,
            organizationId: identity.organizationId, role, createdAt: now,
          }).onConflictDoUpdate({ target: member.id, set: { role } });
        });
        invalidateSitesAccessCache(identity.userId);
        const savedUser = await db.query.user.findFirst({ where: eq(user.id, identity.userId) });
        if (!savedUser || savedUser.banned) throw new APIError("FORBIDDEN");
        const current = await getSessionFromCtx(ctx);
        const sessionData = {
          activeOrganizationId: identity.organizationId,
          expiresAt: new Date(claims.exp * 1000),
        };
        const session = current?.user.id === identity.userId
          ? await ctx.context.internalAdapter.updateSession(current.session.token, sessionData)
          : await ctx.context.internalAdapter.createSession(identity.userId, false, sessionData);
        if (!session) throw new APIError("INTERNAL_SERVER_ERROR");
        await setSessionCookie(ctx, { session, user: { ...savedUser,
          createdAt: new Date(savedUser.createdAt), updatedAt: new Date(savedUser.updatedAt),
        } });
        // BFF captures the cookie; it is never returned to browser JavaScript.
        return ctx.json({ userId: identity.userId, organizationId: identity.organizationId });
      }),
    },
  };
}
