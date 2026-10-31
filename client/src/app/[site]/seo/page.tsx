import { SeoAuditPage } from "@/components/openseo/SeoAuditPage";

export default async function Page({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  return <SeoAuditPage siteId={site} />;
}
