# OpenSEO integration: standalone audit MVP

Rybbit keeps its existing frontend, tracking pipeline and analytics backend.
The new `/{siteId}/seo` screen uses a same-origin Next.js BFF at
`/api/openseo/*` to call OpenSEO. There is no iframe and no Kedi code change.

## Implemented scope

- Sign in and disconnect an existing OpenSEO email/password account.
- List projects visible to the signed-in OpenSEO organization.
- Explicitly select an SEO project for the current Rybbit site screen.
- Start a technical audit, poll progress, review history, issues and crawled pages.
- Technical audits start without paid Lighthouse or JavaScript rendering.
- Analytics, funnels, events and replay continue to call the existing Rybbit backend.

This is a pilot with two account systems. An OpenSEO project selection is a URL
preference (`seoProject`), not a shared, persisted tenant/site mapping. Both APIs
authorize independently. Choose the project for the intended website. Kedi SSO,
provisioning, persisted site/project mapping, keyword/rank/backlink/GSC/AI screens
and SaaS quotas are subsequent work, before customer rollout.

## Prerequisites

1. A working Rybbit backend and database stack, with an existing user and site.
2. The paired OpenSEO checkout with the `/api/integrations/v1/*` changes.
3. OpenSEO configured with `AUTH_MODE=password`, its database migrations applied
   through its documented setup, and both audit Workers/bindings configured.
4. An OpenSEO account with access to a project for the pilot website.

The BFF intentionally does not support `local_noauth`, Cloudflare Access login,
Every App identity, hosted CAPTCHA login, or arbitrary authentication plugins.
Use the password self-host deployment for this pilot. Do not disable authentication.

## Local configuration

Keep the existing Rybbit backend on port 3001 and frontend on 3002. Run OpenSEO
on **127.0.0.1:3003** so it does not clash with Rybbit's backend. Using different
hostnames for direct OpenSEO setup and Rybbit also avoids their default Better
Auth cookies overwriting each other during initial account setup.

In the OpenSEO local environment set `PORT=3003`, `AUTH_MODE=password`,
`BETTER_AUTH_URL=http://127.0.0.1:3003` and its normal authentication/database
bindings. Follow OpenSEO's self-host guide for infrastructure; this integration
does not provision it or run Rybbit migrations.

Merge `client/.env.openseo.example` into your existing `client/.env.local`.
Generate a real secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set `OPENSEO_SESSION_SECRET` to the output. The origin and encryption secret are
server-only runtime settings; never put credentials in `NEXT_PUBLIC_*` variables.
`RYBBIT_INTERNAL_URL` is the origin of Rybbit's own backend, not OpenSEO. In
production use HTTPS for `OPENSEO_BASE_URL` and a stable secret on all frontend
instances. Rotating the secret disconnects existing OpenSEO sessions.

From the Rybbit repository root:

```powershell
pnpm install --frozen-lockfile
pnpm dev:client
```

Open `http://localhost:3002`, sign in to Rybbit and select your site. Open
**SEO Audit** in the site sidebar, connect your OpenSEO account, select the
matching OpenSEO project and run an audit. An empty project list requires creating
or joining the project in OpenSEO first.

## API boundary

| BFF route                                               | OpenSEO upstream                       |
| ------------------------------------------------------- | -------------------------------------- |
| `POST /api/openseo/session`                             | `POST /api/auth/sign-in/email`         |
| `GET /api/openseo/session`                              | `GET /api/integrations/v1/session`     |
| `DELETE /api/openseo/session`                           | `POST /api/auth/sign-out`              |
| `GET /api/openseo/projects`                             | `GET /api/integrations/v1/projects`    |
| `GET, POST /api/openseo/projects/:id/audits`            | Same path under `/api/integrations/v1` |
| `GET /api/openseo/projects/:id/audits/:auditId`         | Same path under `/api/integrations/v1` |
| `GET /api/openseo/projects/:id/audits/:auditId/results` | Same path under `/api/integrations/v1` |

The BFF verifies the current Rybbit session server-side on every request. It
encrypts the secondary OpenSEO session using AES-256-GCM in a separate HttpOnly,
SameSite=Strict cookie scoped to `/api/openseo`, bound to that Rybbit user ID.
It forwards neither Rybbit private-link keys nor Rybbit session cookies to
OpenSEO. Switching Rybbit users cannot reuse the previous user's SEO session.

Writes require the frontend Origin and a custom request header. Upstream hosts
are operator-configured, routes are allowlisted, redirects are refused, and
responses are `private, no-store`. OpenSEO resolves live memberships and checks
the project organization before calling existing audit services. Existing
capacity, URL validation, workflow execution and billing checks remain in place.
API response DTOs omit crawler credential IDs and raw provider payloads.

The UI hides SEO on public/private-link dashboards. This is a navigation rule;
authorization comes from the independently verified backend sessions.

## Validation and release gate

Run client lint, typecheck, build and the tests under `src/api/openseo` and
`src/components/openseo`. In OpenSEO run its integration API tests and typecheck.
Automated fixtures exercise the contract and security boundaries; they are not
evidence of a production audit.

Before deploying, verify a real audit on one authorized website, revoked sessions,
two independent OpenSEO organizations, a backend outage and disconnect/reconnect.
Only then integrate the standalone application into Kedi. No CSP/frame-ancestor
changes are included in this phase.

Rybbit's AGPL license and notices remain applicable. This integration does not
relicense Rybbit or authorize a closed-source distribution.
