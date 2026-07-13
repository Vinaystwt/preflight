"use client";

import Link from "next/link";
import { Link2, Download, RotateCcw, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Wordmark } from "@/components/nav/wordmark";
import { VerdictStamp } from "@/components/verdict-stamp";
import { cn } from "@/lib/utils";
import type { ReleaseReport } from "@/lib/contracts";
import { buildReportLink } from "@/lib/security/report-token";
import { formatTimestamp } from "@/lib/format";

export function ReportHeader({ report, token }: { report: ReleaseReport; token: string }) {
  const [copied, setCopied] = useState(false);
  const rel = report.manifest.canonical_manifest?.release as { service_name?: string; release_version?: string } | undefined;
  const name = rel?.service_name ?? "release";
  const version = rel?.release_version;

  function copyLink() {
    navigator.clipboard.writeText(buildReportLink(window.location.origin, report.report_id, token));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
    toast.success("Private link copied", { description: "Anyone with this link can read the report." });
  }
  function downloadJson() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.report_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border" style={{ background: "color-mix(in srgb, var(--canvas) 88%, transparent)", backdropFilter: "blur(8px)" }}>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Wordmark />
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <VerdictStamp decision={report.decision} size="sm" />
          <span className="hidden min-w-0 truncate t-ui text-secondary md:inline">
            {name}{version ? ` · ${version}` : ""} · {formatTimestamp(report.generated_at).slice(0, 10)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <HeaderBtn onClick={copyLink} icon={copied ? Check : Link2} label="Copy link" />
          <HeaderBtn onClick={downloadJson} icon={Download} label="JSON" />
          <Link href="/check" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 t-ui font-medium text-inverse transition-colors hover:bg-accent-hover">
            <RotateCcw className="size-3.5" aria-hidden />
            Rerun
          </Link>
        </div>
      </div>
    </header>
  );
}

function HeaderBtn({ onClick, icon: Icon, label }: { onClick: () => void; icon: typeof Link2; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 t-ui text-secondary transition-colors hover:bg-surface-2 hover:text-primary")}>
      <Icon className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
