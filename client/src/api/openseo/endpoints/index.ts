import { z } from "zod";

const auditSchema = z.object({
  id: z.string(),
  startUrl: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  pagesCrawled: z.number(),
  pagesTotal: z.number(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});
const sessionSchema = z.object({ userId: z.string(), email: z.string(), organizationId: z.string() });
const projectsSchema = z.array(z.object({ id: z.string(), name: z.string(), domain: z.string().nullable() }));
const statusSchema = auditSchema.extend({ currentPhase: z.string().nullable(), errorCode: z.string().nullable() });
const resultsSchema = z.object({
  audit: auditSchema.pick({ id: true, startUrl: true, status: true, pagesCrawled: true }),
  pages: z.array(
    z.object({ id: z.string(), url: z.string(), statusCode: z.number().nullable(), title: z.string().nullable() })
  ),
  issues: z.array(
    z.object({
      id: z.string(),
      pageUrl: z.string(),
      issueType: z.string(),
      severity: z.enum(["critical", "warning", "info"]),
    })
  ),
});

export class OpenSeoError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code);
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const response = await fetch(`/api/openseo/${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    headers: { "Content-Type": "application/json", "X-OpenSEO-Client": "rybbit" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OpenSeoError("OPENSEO_INVALID_RESPONSE", response.status);
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(payload);
    throw new OpenSeoError(error.success ? error.data.error : "OPENSEO_UNAVAILABLE", response.status);
  }
  const envelope = z.object({ data: z.unknown() }).safeParse(payload);
  if (!envelope.success) throw new OpenSeoError("OPENSEO_INVALID_RESPONSE", 502);
  const result = schema.safeParse(envelope.data.data);
  if (!result.success) throw new OpenSeoError("OPENSEO_INVALID_RESPONSE", 502);
  return result.data;
}

const projectPath = (projectId: string) => `projects/${encodeURIComponent(projectId)}/audits`;
export const fetchOpenSeoSession = (signal?: AbortSignal) => request("session", sessionSchema, { signal });
export const signInOpenSeo = (credentials: { email: string; password: string }) =>
  request("session", z.object({ connected: z.boolean() }), { method: "POST", body: credentials });
export const signOutOpenSeo = () => request("session", z.object({ connected: z.boolean() }), { method: "DELETE" });
export const fetchOpenSeoProjects = (signal?: AbortSignal) => request("projects", projectsSchema, { signal });
export const fetchSeoAudits = (projectId: string, signal?: AbortSignal) =>
  request(projectPath(projectId), z.array(auditSchema), { signal });
export const startSeoAudit = (projectId: string, input: { startUrl: string; maxPages: number }) =>
  request(projectPath(projectId), z.object({ auditId: z.string() }), {
    method: "POST",
    body: { ...input, lighthouseStrategy: "none", renderJavaScript: false },
  });
export const fetchSeoAuditStatus = (projectId: string, auditId: string, signal?: AbortSignal) =>
  request(`${projectPath(projectId)}/${encodeURIComponent(auditId)}`, statusSchema, { signal });
export const fetchSeoAuditResults = (projectId: string, auditId: string, signal?: AbortSignal) =>
  request(`${projectPath(projectId)}/${encodeURIComponent(auditId)}/results`, resultsSchema, { signal });
