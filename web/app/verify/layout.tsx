import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";

export const metadata: Metadata = {
  title: "Verify a receipt",
  description: "Public receipt verifier. Confirm a PreFlight Signed Receipt v1 was issued by PreFlight, has not been altered, and applies to the identified runtime snapshot and policy version. No account required.",
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
