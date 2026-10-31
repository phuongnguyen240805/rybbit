import assert from "node:assert/strict";

const origin = "http://localhost:3002";
const checks = [
  { path: "/api/health", status: 200 },
  { path: "/api/script.js", status: 200, type: "javascript" },
  // A fallback rewrite can accidentally render the dynamic profile page here.
  { path: "/api/user/organizations", status: 401, type: "application/json" },
  { path: "/api/openseo/session", status: 401, type: "application/json", noStore: true },
  { path: "/api/openseo/session", method: "POST", status: 403, type: "application/json" },
];

await Promise.all(
  checks.map(async check => {
    const response = await fetch(`${origin}${check.path}`, {
      method: check.method ?? "GET",
      ...(check.method === "POST"
        ? {
            headers: {
              Origin: "https://untrusted.example",
              "X-OpenSEO-Client": "rybbit",
              "Content-Type": "application/json",
            },
            body: "{}",
          }
        : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, check.status, `${check.method ?? "GET"} ${check.path}`);
    if (check.type) assert.ok(response.headers.get("content-type")?.includes(check.type), `${check.path} content type`);
    if (check.noStore) assert.ok(response.headers.get("cache-control")?.includes("no-store"));
    await response.body?.cancel();
    console.log(`PASS ${check.method ?? "GET"} ${check.path} -> ${response.status}`);
  })
);
