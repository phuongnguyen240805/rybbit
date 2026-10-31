# Kedi Admin integration

Kedi Admin's `/ai-seo` page can embed this dashboard using delegated login. Analytics keeps the Rybbit backend; SEO Audit continues through the existing OpenSEO BFF. No service password is shared with the browser.

Configure these server-only values in Rybbit client and backend:

```dotenv
KEDI_SEO_ADMIN_ORIGIN=http://localhost:3000
KEDI_SEO_SSO_SECRET=<same random 32+ character secret as Kedi Admin and OpenSEO>
```

The client also needs the existing `OPENSEO_SESSION_SECRET`, `OPENSEO_FRONTEND_ORIGIN`, `OPENSEO_BASE_URL`, `OPENSEO_INTERNAL_URL` and `RYBBIT_INTERNAL_URL`. The backend's `BASE_URL` must equal the public Rybbit origin. OpenSEO requires `KEDI_SEO_ADMIN_ORIGIN`, `KEDI_SEO_FRONTEND_ORIGIN` (the Rybbit origin) and the shared secret. The standalone runtime configuration whitelist includes these values; the local compose overlay supplies them to initialization.

Build both Rybbit services from the integration source, not the unmodified published backend:

```sh
docker compose -p kedi-seo-local --env-file ../.local/stack.env -f docker-compose.yml -f ../open-seo/deploy/standalone/compose.yaml -f compose.openseo.local.yaml build backend client
docker compose -p kedi-seo-local --env-file ../.local/stack.env -f docker-compose.yml -f ../open-seo/deploy/standalone/compose.yaml -f compose.openseo.local.yaml up -d
```

The OpenSEO bundle must also be rebuilt from the integration source before initialization. This integration introduces no schema migration. Build sequentially on machines with limited memory. The local smoke used host-compiled backend JavaScript layered over the matching published backend to reuse its native Linux dependencies; the normal backend Dockerfile remains the source build path.

Kedi Admin must include `POST /api/kedi-seo/session` and its Nest backend must include `GET /account/seo-context`. The issuer validates the current source session and live membership before signing a 60-second HS256 JWT. Claims are bound to the configured issuer, audience `kedi-seo`, subject, app, organization, tenant and Rybbit origin. The parent sends the grant to the exact iframe origin via `postMessage`, never in a URL, every 25 seconds. Both parent and child validate message origin and window source.

Rybbit exchanges the grant into an encrypted HttpOnly cookie containing a private native session and the grant. All delegated API calls revalidate expiry; the backend independently requires the grant and matching user. Renewal reuses the native session so in-flight requests remain valid and session rows do not multiply on every heartbeat. An expired/corrupt delegated cookie never falls back to another native account. OpenSEO independently verifies the grant on its integration facade and scopes project/audit access to the derived organization.

Identity mapping is deterministic: SHA-256 of JSON `[issuer, appCode, organizationId, tenantId]`, then of `[organizationDigest, subject]`. User/organization IDs use a `kedi-` prefix. Synthetic email identities never link existing accounts by email. Colleagues share one tenant organization, while different tenants have distinct users and organizations. Existing pilot data is not automatically migrated. Owner/admin map to Rybbit admin; staff are read-only. Credential, membership and cross-organization transfer operations remain managed outside the delegated session.

Use HTTPS subdomains under one site in deployment. Arbitrary cross-site third-party cookie embedding is not supported. Frame ancestors are restricted to the configured Kedi Admin origin. Logout/revocation has a maximum 60-second delegation window. Backends should remain private.

## Local verification, 2026-10-31

- Rybbit integration tests: 30; OpenSEO integration tests: 18; Kedi BFF and Nest membership tests: 8. The Rybbit frontend production Docker build, OpenSEO standalone build and backend TypeScript compilation passed.
- Headless browser mounted the actual Kedi iframe component with a signed isolated issuer fixture, then used the real Docker Rybbit/OpenSEO services. It verified the shared identity, no secondary login, website creation, project selection, a completed example.com audit (one page, four issues), and successful requests after heartbeat renewal.
- Kedi's real unauthenticated issuance route and Nest context route returned 401. The browser smoke did not log into a real Kedi account; final account-specific acceptance is separate from the isolated integration smoke.
- Real API checks rejected cross-tenant SEO history with 404 and analytics access with 403, rejected staff writes to both services with 403, and rejected both services with 401 after the 60-second delegation expired.
- Existing recoverable React hydration #418 warnings can still occur. Kedi's report-only CSP reports local HTTP framing; HTTPS production framing is already allowed by that policy. These did not prevent the tested audit flow.
