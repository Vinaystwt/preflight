import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";

export const metadata: Metadata = {
  title: "CLI",
  description: "Run PreFlight from your terminal or CI. Exit codes carry the decision.",
};

export default function CliLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
