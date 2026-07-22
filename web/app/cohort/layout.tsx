import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";

export const metadata: Metadata = {
  title: "The OKX.AI agent cohort",
  description: "Runtime evidence from free discovery across listed OKX.AI ASPs. No permission required, no money spent. Conforming services are named; contradictions are reported as aggregate criterion codes only.",
};

export default function CohortLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
