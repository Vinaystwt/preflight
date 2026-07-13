"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldX, ShieldQuestion } from "lucide-react";
import { getReport } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { readReportToken, stripTokenFromUrl } from "@/lib/security/report-token";
import { deriveRail } from "@/lib/report-rail";
import { formatTimestamp, hostOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Decision, ReleaseReport } from "@/lib/contracts";
import { ExecutionRail } from "@/components/execution-rail";
import { ReportHeader } from "./report-header";
import { ReportBody } from "./report-body";
import { SnapshotMeta } from "./snapshot-meta";
import { ArtifactsStrip } from "./artifacts-strip";
import { ReceiptInspector } from "./receipt-inspector";
import { BadgeEmbed } from "./badge-embed";
import { GalleryOptIn } from "./gallery-optin";
import { ReportLoading, ReportNeedsLink, ReportUnavailable, ReportExpired, ReportFailed } from "./report-states";

const TONE: Record<Decision, { text: string; bg: string; border: string; Icon: typeof ShieldCheck }> = {
  RELEASE: { text: "text-release", bg: "var(--release-bg)", border: "var(--release-border)", Icon: ShieldCheck },
  BLOCK: { text: "text-block", bg: "var(--block-bg)", border: "var(--block-border)", Icon: ShieldX },
  UNKNOWN: { text: "text-warning", bg: "var(--warning-bg)", border: "var(--warning-border)", Icon: ShieldQuestion },
};

export function ReportView({ id }: { id: string }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [report, setReport] = useState<ReleaseReport | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "needs-link" | "expired" | "unavailable" | "failed">("loading");
  const [phase, setPhase] = useState<"validating" | "fetching">("validating");
  const [requestId, setRequestId] = useState<string | undefined>();

  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get("state");
    if (forced === "loading") return;
    if (forced === "expired") { setStatus("expired"); return; }
    if (forced === "invalid") { setStatus("unavailable"); return; }
    if (forced === "needs-link") { setStatus("needs-link"); return; }

    const t = readReportToken();
    setToken(t);
    if (t) stripTokenFromUrl();
    if (!t) { setStatus("needs-link"); return; }

    setPhase("fetching");
    const controller = new AbortController();
    getReport(id, t, controller.signal)
      .then((r) => { setReport(r); setStatus("ok"); })
      .catch((e) => {
        if (e instanceof ApiError) {
          setRequestId(e.requestId);
          if (e.kind === "report_access") {
            setStatus(/EXPIR/i.test(e.code) ? "expired" : "unavailable");
          } else setStatus("failed");
        } else setStatus("failed");
      });
    return () => controller.abort();
  }, [id]);

  const loadingLabel = phase === "validating" ? "Validating access" : "Fetching sealed report";
  if (status === "loading") return <ReportLoading label={loadingLabel} />;
  if (status === "needs-link") return <ReportNeedsLink />;
  if (status === "expired") return <ReportExpired requestId={requestId} />;
  if (status === "unavailable") return <ReportUnavailable requestId={requestId} />;
  if (status === "failed") return <ReportFailed requestId={requestId} />;
  if (!report || token == null) return <ReportLoading label={loadingLabel} />;

  const t = TONE[report.decision];
  const Icon = t.Icon;
  const rail = deriveRail(report);
  const host = hostOf(report.runtime_snapshot.requested_url);
  const scope =
    report.decision === "RELEASE"
      ? `Every mandatory supported criterion matched the runtime snapshot captured ${formatTimestamp(report.runtime_snapshot.captured_at)}.`
      : report.decision === "BLOCK"
        ? `${report.summary.contradictions} mandatory ${report.summary.contradictions === 1 ? "criterion contradicts" : "criteria contradict"} what is live. Resolve before publishing.`
        : `${report.summary.unknown} mandatory ${report.summary.unknown === 1 ? "criterion could" : "criteria could"} not be observed, so this release is not confirmed.`;

  return (
    <>
      <ReportHeader report={report} token={token} />
      <main id="main" className="mx-auto w-full max-w-[1200px] px-5 py-8 sm:px-6">
        {/* verdict banner */}
        <section className={cn("rounded-md border p-6 sm:p-7")} style={{ background: t.bg, borderColor: t.border }}>
          <div className="flex items-start gap-4">
            <span className={cn("mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-md", t.text)} style={{ background: "var(--canvas)" }} aria-hidden>
              <Icon className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="t-label text-tertiary">Decision</p>
              <h1 className={cn("t-h1 mt-0.5", t.text)}>{report.decision}</h1>
              <p className="t-body mt-2 max-w-2xl text-primary">{scope}</p>
              <p className="t-evidence mt-2 text-tertiary">PreFlight acted as a buyer of <span className="text-secondary">{host}</span>.</p>
            </div>
          </div>
          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t pt-4" style={{ borderColor: "var(--sep)" }}>
            <Metric t="Matched" v={report.summary.matched} />
            <Metric t="Blocked" v={report.summary.contradictions} tone={report.summary.contradictions > 0 ? "text-block" : undefined} />
            <Metric t="Unknown" v={report.summary.unknown} tone={report.summary.unknown > 0 ? "text-warning" : undefined} />
            <Metric t="Not applicable" v={report.summary.not_applicable} />
          </dl>
        </section>

        {/* issued artifacts (P0.2) */}
        <div className="mt-5">
          <ArtifactsStrip report={report} />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_200px]">
          <div className="min-w-0 order-2 lg:order-1 flex flex-col gap-10">
            <ReportBody report={report} />
            {report.decision === "BLOCK" && <GalleryOptIn report={report} />}
            {report.receipt && <ReceiptInspector receipt={report.receipt} reportHashes={{ manifest_hash: report.manifest?.manifest_hash, snapshot_hash: report.runtime_snapshot?.snapshot_hash }} />}
            {report.decision === "RELEASE" && <BadgeEmbed report={report} token={token} />}
            <SnapshotMeta report={report} />
          </div>
          <aside className="order-1 lg:order-2">
            <div className="panel sticky top-20 rounded-md px-4 py-4">
              <span className="t-label mb-3 block text-tertiary">EXECUTION</span>
              <ExecutionRail nodes={rail} />
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

function Metric({ t, v, tone }: { t: string; v: number; tone?: string }) {
  return (
    <div>
      <dt className="t-label text-tertiary">{t}</dt>
      <dd className={cn("t-metric", tone ?? "text-primary")}>{v}</dd>
    </div>
  );
}
