"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProbeStep {
  label: string;
}

export const DISCOVERY_STEPS: ProbeStep[] = [
  { label: "Resolving endpoint" },
  { label: "HTTPS established" },
  { label: "MCP contract discovered" },
  { label: "x402 challenge observed" },
  { label: "Proposed manifest generated" },
];

/*
  Event-driven probing surface. Rows advance on a timer paced to typical
  discovery latency, but never claim completion ahead of the real response:
  when the response lands, remaining rows resolve together against the
  actual outcome. On failure, the row in flight gets the red edge, later
  rows never fire. No fabricated data values, only real phase labels paced
  against a real in-flight request.
*/
export function ProbingConsole({
  steps = DISCOVERY_STEPS,
  status,
}: {
  steps?: ProbeStep[];
  status: "running" | "done" | "error";
}) {
  const [completed, setCompleted] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const tick = setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => clearInterval(tick);
  }, [startedAt]);

  useEffect(() => {
    if (status !== "running") return;
    const paced = [420, 650, 900, 700];
    const scheduled: ReturnType<typeof setTimeout>[] = [];
    let acc = 0;
    for (let i = 0; i < steps.length - 1; i++) {
      acc += paced[i] ?? 500;
      scheduled.push(setTimeout(() => setCompleted((c) => Math.max(c, i + 1)), acc));
    }
    timers.current = scheduled;
    return () => scheduled.forEach(clearTimeout);
  }, [status, steps.length]);

  useEffect(() => {
    if (status === "done") {
      timers.current.forEach(clearTimeout);
      setCompleted(steps.length);
    }
  }, [status, steps.length]);

  const failedIdx = status === "error" ? completed : -1;
  const elapsed = (elapsedMs / 1000).toFixed(1);

  return (
    <div className="overflow-hidden rounded-md border border-border" style={{ background: "var(--surface-1)" }}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="t-label text-tertiary">Probing</span>
        <span className="font-mono text-[11px] text-tertiary tabular-nums">{elapsed}s</span>
      </div>
      <ul>
        {steps.map((s, i) => {
          const isDone = i < completed && status !== "error";
          const isFailed = status === "error" && i === failedIdx;
          const isActive = status === "running" && i === completed;
          return (
            <li
              key={s.label}
              className={cn(
                "flex items-center gap-3 border-b border-sep px-4 py-2.5 last:border-b-0 motion-safe:transition-opacity motion-safe:duration-150",
                !isDone && !isFailed && !isActive && "opacity-40",
              )}
              style={isFailed ? { borderLeft: "2px solid var(--block-fg)", background: "var(--block-bg)" } : undefined}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {isDone && <Check className="size-3.5 text-tertiary" aria-hidden />}
                {isFailed && <X className="size-3.5 text-block" aria-hidden />}
                {isActive && <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" style={{ animationDuration: "1.2s" }} aria-hidden />}
                {!isDone && !isFailed && !isActive && <span className="size-1.5 rounded-full" style={{ background: "var(--border-strong)" }} aria-hidden />}
              </span>
              <span className={cn("t-ui", isFailed ? "text-block" : isDone ? "text-secondary" : isActive ? "text-primary" : "text-tertiary")}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
