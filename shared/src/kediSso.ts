export interface KediClaims {
  iss: string;
  sub: string;
  organizationId: string;
  tenantId: number;
  appCode: string;
  role: "owner" | "admin" | "staff";
  embedOrigin: string;
  iat: number;
  exp: number;
}

// These POST endpoints query analytics; the native route guards still check
// membership, site access and read-only SQL. Do not treat every POST as a write.
export function kediReadOnlyRequest(path: string, method: string) {
  if (["GET", "HEAD"].includes(method)) return true;
  if (method !== "POST") return false;
  return /^organizations\/[^/]+\/(?:site-cards(?:-lite)?|analytics\/query)$/.test(path) ||
    /^sites\/[^/]+\/(?:funnels\/analyze|funnels\/\d+\/sessions|dashboards\/run-card|feature-flags\/evaluate)$/.test(path);
}

export function kediPathAllowed(path: string, method: string) {
  if (path.startsWith("auth/")) return ["auth/get-session", "auth/sign-out", "auth/organization/list",
    "auth/organization/get-full-organization", "auth/organization/set-active"].includes(path);
  if (method === "POST" && /^organizations\/[^/]+\/sites$/.test(path)) return true;
  if (/^sites\/[^/]+\/transfer(?:\/|$)/.test(path)) return false;
  return kediReadOnlyRequest(path, method) || !(/api-keys|members|teams|invitations/.test(path) ||
    /^(?:admin|user|organizations)(?:\/|$)/.test(path));
}

// Called only AFTER signature, issuer and audience verification.
export function parseKediClaims(value: Record<string, unknown>): KediClaims {
  const strings = ["iss", "sub", "organizationId", "appCode", "embedOrigin"];
  if (strings.some(key => typeof value[key] !== "string" || !(value[key] as string).length || (value[key] as string).length > 256) ||
    !Number.isSafeInteger(value.tenantId) || Number(value.tenantId) <= 0 ||
    !["owner", "admin", "staff"].includes(String(value.role)) ||
    typeof value.iat !== "number" || typeof value.exp !== "number" ||
    value.exp <= value.iat || value.exp - value.iat > 60 ||
    value.iat > Math.floor(Date.now() / 1000) + 5) throw new Error("Invalid Kedi grant");
  return value as unknown as KediClaims;
}

export async function kediIdentity(claims: KediClaims) {
  const digest = async (value: string) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  };
  const org = await digest(JSON.stringify([claims.iss, claims.appCode, claims.organizationId, claims.tenantId]));
  const person = await digest(JSON.stringify([org, claims.sub]));
  return { organizationId: `kedi-${org}`, userId: `kedi-${person}`, email: `${person}@sso.kedi.invalid` };
}
