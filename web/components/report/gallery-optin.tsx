"use client";

import { useState } from "react";
import Link from "next/link";
import { Share2, Eye, RotateCcw } from "lucide-react";
import type { ReleaseReport } from "@/lib/contracts";

/*
  Gallery opt-in for BLOCK reports. The backend accepts include_in_gallery only
  on the original verify_release request, so post-hoc contribution is presented
  as guidance (re-run with contribution enabled), never a control that silently
  fails. "Preview anonymization" shows exactly which fields would publish.
*/
export function GalleryOptIn({ report }: { report: ReleaseReport }) {
  const [preview, setPreview] = useState(false);
  const codes = report.criterion_groups
    .flatMap((g) => g.criteria)
    .filter((c) => c.state === "CONTRADICTION")
    .map((c) => c.code);

  return (
    <section className="rounded-md border border-border p-5" style={{ background: "var(--surface-1)" }}>
      <div className="flex items-center gap-2">
        <Share2 className="size-4 text-tertiary" aria-hidden />
        <h2 className="t-label text-tertiary">Contribute an anonymized archetype</h2>
      </div>
      <p className="mt-2 max-w-2xl t-body text-[14px] text-secondary">
        Share this criterion failure to the public corpus without exposing your service, endpoint,
        full addresses, or report link. Contribution is enabled on the check request, so to publish
        this failure, re-run the check with gallery contribution turned on.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setPreview((p) => !p)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 t-ui text-secondary transition-colors hover:bg-surface-2 hover:text-primary">
          <Eye className="size-3.5" aria-hidden />
          {preview ? "Hide preview" : "Preview anonymization"}
        </button>
        <Link href="/check" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 t-ui font-medium text-inverse hover:bg-accent-hover">
          <RotateCcw className="size-3.5" aria-hidden />
          Re-run with contribution
        </Link>
      </div>

      {preview && (
        <div className="mt-4 rounded-md border border-border p-4" style={{ background: "var(--base)" }}>
          <p className="t-label mb-2 text-tertiary">Only these fields would publish</p>
          <dl className="grid gap-x-6 gap-y-2 t-evidence sm:grid-cols-2">
            <Row t="criterion_codes" v={codes.join(", ") || "the failing criteria"} />
            <Row t="decision" v={report.decision} />
            <Row t="policy_version" v={report.policy_version} />
            <Row t="why / fix" v="plain-language consequence and remediation" />
          </dl>
          <p className="mt-3 t-evidence text-tertiary">Never published: endpoint, full addresses, payer, manifest, snapshot, report token.</p>
        </div>
      )}
    </section>
  );
}

function Row({ t, v }: { t: string; v: string }) {
  return (
    <>
      <dt className="text-tertiary">{t}</dt>
      <dd className="text-secondary">{v}</dd>
    </>
  );
}
