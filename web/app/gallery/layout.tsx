import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Anonymized archetypes of release failures PreFlight has caught. Private by default; public only by opt-in.",
};

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
