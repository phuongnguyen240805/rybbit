# Docker local integration QA — 2026-10-31

Scope: standalone Rybbit frontend plus Rybbit analytics backend and the modified
OpenSEO audit backend. Kedi Admin and production websites were not changed.

## Environment

- Compose project: `kedi-seo-local`, isolated application volumes.
- Rybbit frontend: `http://localhost:3002` (production Next.js image).
- Rybbit backend: upstream revision `877e3c6b9020a4d4b19181cd5034ad73b3a9ce46`.
- OpenSEO: `http://127.0.0.1:3003`, standalone 0.1.22 runtime with the modified
  checkout's compiled JS/WASM bundle.
- Local test accounts and a private Rybbit site for `example.com`; no production
  credentials or live customer data.

## Verified

- New local databases initialized through the applications' normal startup
  migrations. Existing Docker projects and databases were not reused.
- OpenSEO and Rybbit email/password login work with distinct hostnames/cookies.
- Rybbit's SEO screen signs in through its BFF, lists authorized OpenSEO projects,
  starts an audit, polls its workflow and displays completed results.
- Browser-driven audit `29dd3be0-5abc-485b-a5d8-1ce6b96b1a49`: **completed**, one
  crawled page and four reported issues from `https://example.com/`. This is a
  real crawl of a sample website, not production-store analytics.
- The browser cannot read the secondary OpenSEO cookie with `document.cookie`.
- Rybbit API routes and the tracking script are served through the frontend
  origin, while `/api/openseo/*` remains the dedicated local BFF. The read-only
  check `node client/scripts/check-seo-local.mjs` covers this boundary.
- Unauthenticated local integration API requests return 401 and private/no-store
  cache headers.
- 44 targeted automated tests passed across both checkouts: API authorization,
  audit behavior, encrypted session isolation, Origin/redirect controls and UI.
- Production frontend and standalone OpenSEO builds completed with type checks.
- Five read-only HTTP smoke checks passed on the final Docker image, including
  the API/page routing boundary, tracking script and rejection of an untrusted
  Origin. The final browser check displayed navigation and completed results.

## Issues resolved during actual startup

- Empty French translations hid the SEO sidebar label and new form text. Blank
  or missing translations now fall back to English while preserving completed
  translations. A French-locale browser check verified the SEO link, heading and
  project label remain visible.

- Windows path separators bypassed the standalone packager's `.assetsignore`
  filter. Using `path.basename` fixes the artifact; celld then deploys it.
- Next.js's internal bind origin differs from the browser origin in Docker.
  `OPENSEO_FRONTEND_ORIGIN` supplies a fixed, validated CSRF origin.
- Four celld runtime slots were insufficient for nested audit/DO calls and caused
  `CapacityExhausted`. Sixteen slots allow the audited workflow to finish while
  retaining bounded memory.
- Rybbit's startup needed a longer initial health-check window while its fresh
  database initialized.
- The browser session store must initialize only in the browser, not issue an
  unauthenticated SSR request to a public loopback URL inside a container.
- The Rybbit API proxy must run before dynamic page matching and explicitly
  exclude OpenSEO. A fallback proxy lets `/api/user/organizations` match the user
  profile page and breaks the organization selector.
- SEO auditing does not require an analytics pageview; its screen no longer
  displays Rybbit's first-pageview installation banner.
- Self-hosting has no Stripe publishable key. The optional checkout module now
  initializes Stripe only when a key exists, avoiding an uncaught browser error
  on unrelated pages.

## Limits

This validates the audit MVP. Persistent Rybbit-site/OpenSEO-project mapping,
Kedi SSO, external-tenant rollout, other SEO screens, GSC/provider credentials,
commerce conversion events and production tracking remain subsequent work.
Analytics for the newly created local site is initially empty.

One repeated browser run emitted React #418 hydration recovery warnings. The
page recovered and displayed completed results, and subsequent API checks passed.
Investigating this hydration mismatch remains a frontend release-hardening task;
this local audit MVP is not an external-tenant production release.

The celld runtime also reported four restarts during this session's longer run.
At inspection it was healthy, the last recorded exit code was 0, and Docker did
not report an OOM. The cause is not established. Completed audit data survived;
investigate these restarts and perform a longer stability test before enabling
customer traffic or embedding the application into Kedi.

Container memory/CPU limits are defined in `compose.openseo.local.yaml`. A runtime
snapshot during the pilot was approximately 1.5 GiB across the application stack;
usage varies with requests, retained cells and ClickHouse work. Build-time usage
is additional. See `OPENSEO_INTEGRATION.md` for lifecycle commands.
