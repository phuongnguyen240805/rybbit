import { useQuery } from "@tanstack/react-query";
import {
  fetchOpenSeoProjects,
  fetchOpenSeoSession,
  fetchSeoAudits,
  fetchSeoAuditResults,
  fetchSeoAuditStatus,
} from "../endpoints";

export const openSeoKey = ["openseo"] as const;

export function useOpenSeoSession(rybbitUserId: string) {
  return useQuery({
    queryKey: [...openSeoKey, "session", rybbitUserId],
    queryFn: ({ signal }) => fetchOpenSeoSession(signal),
    retry: false,
    staleTime: 0,
  });
}

export function useOpenSeoProjects(identity: string | undefined) {
  return useQuery({
    queryKey: [...openSeoKey, identity, "projects"],
    queryFn: ({ signal }) => fetchOpenSeoProjects(signal),
    enabled: !!identity,
    retry: false,
  });
}

export function useSeoAudits(identity: string, projectId: string) {
  return useQuery({
    queryKey: [...openSeoKey, identity, projectId, "audits"],
    queryFn: ({ signal }) => fetchSeoAudits(projectId, signal),
    enabled: !!projectId,
    retry: false,
    refetchInterval: query => (query.state.data?.some(audit => audit.status === "running") ? 5000 : false),
  });
}

export function useSeoAuditStatus(identity: string, projectId: string, auditId: string) {
  return useQuery({
    queryKey: [...openSeoKey, identity, projectId, auditId, "status"],
    queryFn: ({ signal }) => fetchSeoAuditStatus(projectId, auditId, signal),
    enabled: !!projectId && !!auditId,
    retry: false,
    refetchInterval: query => (query.state.error ? false : query.state.data?.status === "running" ? 3000 : false),
  });
}

export function useSeoAuditResults(identity: string, projectId: string, auditId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...openSeoKey, identity, projectId, auditId, "results"],
    queryFn: ({ signal }) => fetchSeoAuditResults(projectId, auditId, signal),
    enabled: !!projectId && !!auditId && enabled,
    retry: false,
  });
}
