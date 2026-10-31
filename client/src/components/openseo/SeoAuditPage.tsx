"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, LogOut, RefreshCw, SearchCheck } from "lucide-react";
import { useExtracted } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { useGetSite } from "@/api/admin/hooks/useSites";
import { OpenSeoError, signInOpenSeo, signOutOpenSeo, startSeoAudit } from "@/api/openseo/endpoints";
import {
  openSeoKey,
  useOpenSeoProjects,
  useOpenSeoSession,
  useSeoAudits,
  useSeoAuditResults,
  useSeoAuditStatus,
} from "@/api/openseo/hooks/useOpenSeo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth";

function ErrorMessage({ error }: { error: Error | null }) {
  const t = useExtracted();
  if (!error) return null;
  let message = t("The request could not be completed. Check your connection and try again.");
  if (error instanceof OpenSeoError) {
    switch (error.code) {
      case "OPENSEO_NOT_CONFIGURED":
        message = t("OpenSEO is not configured. Contact your administrator.");
        break;
      case "RATE_LIMITED":
        message = t("Too many requests. Please try again later.");
        break;
      case "AUDIT_ALREADY_RUNNING":
        message = t("An audit is already running. Refresh the history to follow its progress.");
        break;
      case "AUDIT_CAPACITY_REACHED":
        message = t(
          "Your OpenSEO audit capacity has been reached. Manage your audits in OpenSEO before starting another."
        );
        break;
      case "AUDIT_PAGE_LIMIT_EXCEEDED":
        message = t("Reduce the maximum number of pages for your OpenSEO plan.");
        break;
      default:
        if (error.status === 401) message = t("Sign in to OpenSEO again to continue.");
        if (error.status === 403 || error.status === 404)
          message = t("This OpenSEO project or operation is not available to your account.");
    }
  }
  return (
    <p role="alert" className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
      <AlertCircle size={16} />
      {message}
    </p>
  );
}

function OpenSeoLogin({ onConnected }: { onConnected: () => Promise<unknown> }) {
  const t = useExtracted();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: signInOpenSeo,
    onSuccess: async () => {
      setPassword("");
      await onConnected();
    },
    onError: () => setPassword(""),
  });
  return (
    <Card className="max-w-lg p-6 space-y-4">
      <h2 className="text-base font-semibold">{t("Connect your OpenSEO account")}</h2>
      <p className="text-sm text-neutral-500">
        {t("Use your OpenSEO email and password. Analytics continues to use your Rybbit account.")}
      </p>
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          login.mutate({ email, password });
        }}
      >
        <label className="block text-sm space-y-1">
          <span>{t("Email")}</span>
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm space-y-1">
          <span>{t("Password")}</span>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
          />
        </label>
        <ErrorMessage error={login.error} />
        <Button variant="accent" type="submit" loading={login.isPending}>
          {t("Connect OpenSEO")}
        </Button>
      </form>
    </Card>
  );
}

function AuditResults({ identity, projectId, auditId }: { identity: string; projectId: string; auditId: string }) {
  const t = useExtracted();
  const status = useSeoAuditStatus(identity, projectId, auditId);
  const results = useSeoAuditResults(
    identity,
    projectId,
    auditId,
    status.data?.status === "completed" || status.data?.status === "failed"
  );
  const [page, setPage] = useState(0);
  const issues = results.data?.issues ?? [];
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-2" aria-live="polite">
        <h3 className="font-semibold">{t("Audit progress")}</h3>
        {status.isPending && <p>{t("Loading...")}</p>}
        <ErrorMessage error={status.error} />
        {status.data && (
          <>
            <p className="break-all text-sm">{status.data.startUrl}</p>
            <p className="text-sm">
              {status.data.status} · {status.data.pagesCrawled} / {status.data.pagesTotal} {t("Pages")}
            </p>
            {status.data.status === "running" && (
              <p className="text-sm text-neutral-500">{t("The audit is running. Progress updates automatically.")}</p>
            )}
            {status.data.status === "failed" && (
              <p role="alert" className="text-sm text-red-500">
                {t("The audit failed. You can review partial results or start another audit.")} {status.data.errorCode}
              </p>
            )}
          </>
        )}
      </Card>
      <ErrorMessage error={results.error} />
      {results.isFetching && <p className="text-sm">{t("Loading results...")}</p>}
      {results.data && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4">
              <p className="text-sm text-neutral-500">{t("Pages crawled")}</p>
              <p className="text-2xl font-semibold">{results.data.pages.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-neutral-500">{t("Issues found")}</p>
              <p className="text-2xl font-semibold">{issues.length}</p>
            </Card>
          </div>
          <Card className="p-4 space-y-3">
            <h3 className="font-semibold">{t("SEO issues")}</h3>
            {!issues.length && (
              <p className="text-sm text-neutral-500">{t("No issues were reported for this audit.")}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b dark:border-neutral-800">
                    <th className="p-2">{t("Severity")}</th>
                    <th className="p-2">{t("Issue")}</th>
                    <th className="p-2">{t("Page")}</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.slice(page * 50, (page + 1) * 50).map(issue => (
                    <tr key={issue.id} className="border-b dark:border-neutral-800">
                      <td className="p-2">{issue.severity}</td>
                      <td className="p-2">{issue.issueType.replaceAll("_", " ")}</td>
                      <td className="p-2 break-all">{issue.pageUrl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {issues.length > 50 && (
              <div className="flex items-center gap-3">
                <Button disabled={page === 0} onClick={() => setPage(value => value - 1)}>
                  {t("Previous")}
                </Button>
                <span>
                  {page + 1} / {Math.ceil(issues.length / 50)}
                </span>
                <Button disabled={(page + 1) * 50 >= issues.length} onClick={() => setPage(value => value + 1)}>
                  {t("Next")}
                </Button>
              </div>
            )}
          </Card>
          <Card className="p-4 space-y-3">
            <h3 className="font-semibold">{t("Crawled pages")}</h3>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="p-2">{t("Page")}</th>
                    <th className="p-2">{t("Status")}</th>
                    <th className="p-2">{t("Title")}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.data.pages.map(item => (
                    <tr key={item.id} className="border-t dark:border-neutral-800">
                      <td className="p-2 break-all">{item.url}</td>
                      <td className="p-2">{item.statusCode ?? "—"}</td>
                      <td className="p-2">{item.title ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function ProjectAudits({
  identity,
  projectId,
  domain,
}: {
  identity: string;
  projectId: string;
  domain: string | null;
}) {
  const t = useExtracted();
  const client = useQueryClient();
  const [startUrl, setStartUrl] = useState(domain ? (domain.startsWith("http") ? domain : `https://${domain}`) : "");
  const [maxPages, setMaxPages] = useState(50);
  const [selectedAuditId, setSelectedAuditId] = useState("");
  const history = useSeoAudits(identity, projectId);
  const start = useMutation({
    mutationFn: () => startSeoAudit(projectId, { startUrl, maxPages }),
    onSuccess: async data => {
      setSelectedAuditId(data.auditId);
      await client.invalidateQueries({ queryKey: [...openSeoKey, identity, projectId] });
    },
  });
  const auditId = selectedAuditId || history.data?.[0]?.id || "";
  return (
    <div className="space-y-5">
      <Card className="p-4 space-y-4">
        <h2 className="font-semibold">{t("Start a site audit")}</h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={event => {
            event.preventDefault();
            start.mutate();
          }}
        >
          <label className="flex-1 min-w-48 space-y-1 text-sm">
            <span>{t("Website URL")}</span>
            <Input type="url" value={startUrl} onChange={event => setStartUrl(event.target.value)} required />
          </label>
          <label className="w-28 space-y-1 text-sm">
            <span>{t("Max pages")}</span>
            <Input
              type="number"
              min={10}
              max={500}
              value={maxPages}
              onChange={event => setMaxPages(Number(event.target.value))}
              required
            />
          </label>
          <Button
            type="submit"
            variant="accent"
            loading={start.isPending}
            disabled={history.isPending || history.isError || history.data?.some(audit => audit.status === "running")}
          >
            <SearchCheck />
            {t("Run SEO audit")}
          </Button>
        </form>
        <ErrorMessage error={start.error} />
      </Card>
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("Audit history")}</h2>
          <Button size="sm" onClick={() => history.refetch()} loading={history.isFetching}>
            <RefreshCw />
            {t("Refresh")}
          </Button>
        </div>
        <ErrorMessage error={history.error} />
        {history.isPending && <p className="text-sm">{t("Loading...")}</p>}
        {history.data?.length === 0 && (
          <p className="text-sm text-neutral-500">{t("No audits yet. Start an audit to see real SEO results.")}</p>
        )}
        {!!history.data?.length && (
          <select
            aria-label={t("Select audit")}
            className="w-full rounded-lg border p-2 text-sm dark:bg-neutral-900 dark:border-neutral-700"
            value={auditId}
            onChange={event => setSelectedAuditId(event.target.value)}
          >
            {history.data.map(audit => (
              <option key={audit.id} value={audit.id}>
                {audit.startedAt} · {audit.status} · {audit.startUrl}
              </option>
            ))}
          </select>
        )}
      </Card>
      {auditId && <AuditResults key={auditId} identity={identity} projectId={projectId} auditId={auditId} />}
    </div>
  );
}

function ConnectedSeo({ identity }: { identity: string }) {
  const t = useExtracted();
  const projects = useOpenSeoProjects(identity);
  const [projectId, setProjectId] = useQueryState("seoProject", parseAsString.withDefault(""));
  const project = projects.data?.find(item => item.id === projectId);
  return (
    <div className="space-y-5">
      <label className="block max-w-xl space-y-2 text-sm">
        <span>{t("OpenSEO project")}</span>
        <select
          className="w-full rounded-lg border p-2 dark:bg-neutral-900 dark:border-neutral-700"
          value={project?.id ?? ""}
          onChange={event => setProjectId(event.target.value)}
        >
          <option value="">{t("Select an authorized OpenSEO project")}</option>
          {projects.data?.map(item => (
            <option key={item.id} value={item.id}>
              {item.name} {item.domain ? `· ${item.domain}` : ""}
            </option>
          ))}
        </select>
      </label>
      <ErrorMessage error={projects.error} />
      {projects.isPending && <p className="text-sm">{t("Loading...")}</p>}
      {projects.data?.length === 0 && (
        <p className="text-sm text-neutral-500">
          {t("No OpenSEO projects are available. Create a project in OpenSEO first.")}
        </p>
      )}
      {project && <ProjectAudits key={project.id} identity={identity} projectId={project.id} domain={project.domain} />}
    </div>
  );
}

export function SeoAuditPage({ siteId }: { siteId: string }) {
  const t = useExtracted();
  const { data: rybbitSession, isPending: sessionPending } = authClient.useSession();
  const site = useGetSite(siteId);
  // Public/private-link dashboards never mount the session or SEO queries.
  if (site.isPending || sessionPending) return <p className="p-6">{t("Loading...")}</p>;
  if (!site.data?.role || !rybbitSession?.user)
    return <p className="p-6">{t("Sign in with access to this site to use SEO tools.")}</p>;
  return (
    <SeoAccount
      key={`${rybbitSession.user.id}:${siteId}`}
      rybbitUserId={rybbitSession.user.id}
      siteName={site.data.name}
    />
  );
}

function SeoAccount({ siteName, rybbitUserId }: { siteName: string; rybbitUserId: string }) {
  const t = useExtracted();
  const client = useQueryClient();
  const session = useOpenSeoSession(rybbitUserId);
  const refreshSession = async () => {
    await client.cancelQueries({ queryKey: openSeoKey });
    client.removeQueries({ predicate: query => query.queryKey[0] === "openseo" && query.queryKey[1] !== "session" });
    await client.resetQueries({ queryKey: [...openSeoKey, "session", rybbitUserId], exact: true });
  };
  const logout = useMutation({ mutationFn: signOutOpenSeo, onSettled: refreshSession });
  const identity = session.data ? `${rybbitUserId}:${session.data.userId}:${session.data.organizationId}` : "";
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      <header className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("SEO Audit")}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {siteName} · {t("SEO data from OpenSEO. Traffic and events remain in Rybbit.")}
          </p>
        </div>
        {session.data && (
          <div className="flex items-center gap-3 text-sm">
            <span>{session.data.email}</span>
            <Button onClick={() => logout.mutate()} loading={logout.isPending}>
              <LogOut />
              {t("Disconnect OpenSEO")}
            </Button>
          </div>
        )}
      </header>
      <ErrorMessage error={logout.error} />
      {session.isPending ? (
        <p>{t("Loading...")}</p>
      ) : session.data && !session.isError ? (
        <ConnectedSeo key={identity} identity={identity} />
      ) : (
        <>
          {session.error instanceof OpenSeoError && session.error.status !== 401 && (
            <ErrorMessage error={session.error} />
          )}
          <OpenSeoLogin onConnected={refreshSession} />
        </>
      )}
    </div>
  );
}
