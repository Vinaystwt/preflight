import { GalleryFeed } from "@/components/gallery/gallery-feed";

export default function GalleryPage() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-5 py-16 sm:px-6 lg:py-20">
      <span className="t-label text-accent">Failure gallery</span>
      <h1 className="t-h1 mt-3 text-primary">What a real customer runs into.</h1>
      <p className="t-lead mt-4 max-w-2xl text-secondary">
        When an operator opts in, the contradiction that blocked their release is published here
        anonymized: the criterion, why it matters, and the fix. No endpoint, address, payer, or report
        link. It is a catalog of the ways a deployed service is not yet sellable.
      </p>
      <div className="mt-10">
        <GalleryFeed />
      </div>
    </div>
  );
}
