import { NextRequest } from "next/server";
import { handleOpenSeoProxy } from "@/api/openseo/server/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handleOpenSeoProxy(request, (await context.params).path);
}

export { handle as GET, handle as POST, handle as DELETE };
