import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SeoAuditPage } from "./SeoAuditPage";

const state = vi.hoisted(() => ({ userId: "rybbit-a", role: "owner" as string | null, selectedProject: "project-a" }));
vi.mock("next-intl", () => ({ useExtracted: () => (message: string) => message }));
vi.mock("@/api/admin/hooks/useSites", () => ({
  useGetSite: () => ({ data: { name: "My store", role: state.role }, isPending: false }),
}));
vi.mock("@/lib/auth", () => ({
  authClient: { useSession: () => ({ data: { user: { id: state.userId } }, isPending: false }) },
}));
vi.mock("nuqs", () => ({
  parseAsString: { withDefault: () => ({}) },
  useQueryState: () => [state.selectedProject, vi.fn()],
}));

const network = vi.fn<typeof fetch>();
let connected = false;
let running = false;
let hasHistory = false;
let client: QueryClient;

function page() {
  return (
    <QueryClientProvider client={client}>
      <SeoAuditPage siteId="1" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  state.userId = "rybbit-a";
  state.role = "owner";
  state.selectedProject = "project-a";
  connected = false;
  running = false;
  hasHistory = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  network.mockReset();
  network.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/session") && init?.method === "POST") {
      connected = true;
      return Response.json({ data: { connected: true } });
    }
    if (url.endsWith("/session"))
      return connected
        ? Response.json({ data: { userId: "seo-a", email: "person@example.com", organizationId: "org-a" } })
        : Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    if (url.endsWith("/projects"))
      return Response.json({ data: [{ id: "project-a", name: "Store SEO", domain: "store.example" }] });
    if (url.endsWith("/audits") && init?.method === "POST") {
      running = true;
      return Response.json({ data: { auditId: "audit-a" } });
    }
    const audit = {
      id: "audit-a",
      startUrl: "https://store.example",
      status: running ? "running" : "completed",
      pagesCrawled: 1,
      pagesTotal: 50,
      startedAt: "2026-10-31T00:00:00Z",
      completedAt: running ? null : "2026-10-31T00:01:00Z",
    };
    if (url.endsWith("/audits")) return Response.json({ data: running || hasHistory ? [audit] : [] });
    if (url.endsWith("/results"))
      return Response.json({
        data: {
          audit,
          pages: [{ id: "page-a", url: "https://store.example", statusCode: 200, title: "Store" }],
          issues: [
            { id: "issue-a", pageUrl: "https://store.example", issueType: "missing_description", severity: "warning" },
          ],
        },
      });
    return Response.json({ data: { ...audit, currentPhase: "crawl", errorCode: null } });
  });
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

describe("standalone SEO audit flow", () => {
  it("connects an account and starts a real API operation without optimistic KPI data", async () => {
    render(page());
    await screen.findByText("Connect your OpenSEO account");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Connect OpenSEO" }).closest("form")!);
    const run = await screen.findByRole("button", { name: "Run SEO audit" });
    await waitFor(() => expect(run.hasAttribute("disabled")).toBe(false));
    fireEvent.submit(run.closest("form")!);
    await screen.findByText("The audit is running. Progress updates automatically.");
    expect(screen.queryByText("Issues found")).toBeNull();
    const start = network.mock.calls.find(([url, init]) => String(url).endsWith("/audits") && init?.method === "POST");
    expect(JSON.parse(String(start?.[1]?.body))).toEqual({
      startUrl: "https://store.example",
      maxPages: 50,
      lighthouseStrategy: "none",
      renderJavaScript: false,
    });
  });

  it("never requests SEO data for a public site viewer", async () => {
    state.role = null;
    render(page());
    screen.getByText("Sign in with access to this site to use SEO tools.");
    expect(network).not.toHaveBeenCalled();
  });

  it("renders completed audit issues and pages returned by OpenSEO", async () => {
    connected = true;
    hasHistory = true;
    render(page());
    await screen.findByText("missing description");
    screen.getByText("warning");
    screen.getByRole("heading", { name: "Crawled pages" });
    screen.getByText("Store");
  });

  it("does not reuse the previous Rybbit user's cached OpenSEO account", async () => {
    connected = true;
    const view = render(page());
    await screen.findByText("person@example.com");
    connected = false;
    state.userId = "rybbit-b";
    view.rerender(page());
    await screen.findByText("Connect your OpenSEO account");
    expect(screen.queryByText("person@example.com")).toBeNull();
  });
});
