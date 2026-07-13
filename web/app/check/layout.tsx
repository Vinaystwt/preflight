import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";

export const metadata: Metadata = {
  title: "Run a check",
  description: "Discover what your agent service actually does, free. The full paid check runs from your agent.",
};

export default function CheckLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
