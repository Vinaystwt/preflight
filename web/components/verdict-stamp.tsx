import { ShieldCheck, ShieldX, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Decision } from "@/lib/contracts";

const META: Record<
  Decision,
  { label: string; Icon: typeof ShieldCheck; fg: string; bg: string; border: string }
> = {
  RELEASE: { label: "RELEASE", Icon: ShieldCheck, fg: "text-release", bg: "var(--release-bg)", border: "var(--release-border)" },
  BLOCK: { label: "BLOCK", Icon: ShieldX, fg: "text-block", bg: "var(--block-bg)", border: "var(--block-border)" },
  UNKNOWN: { label: "UNKNOWN", Icon: ShieldQuestion, fg: "text-warning", bg: "var(--warning-bg)", border: "var(--warning-border)" },
};

const SIZE = {
  sm: "h-7 gap-1.5 px-2.5 text-[12px]",
  md: "h-9 gap-2 px-3.5 text-[13px]",
  lg: "h-12 gap-2.5 px-5 text-[15px]",
};

/** Verdict block — icon + text, semantic color only, engraved 1px border. */
export function VerdictStamp({
  decision,
  size = "md",
}: {
  decision: Decision;
  size?: "sm" | "md" | "lg";
}) {
  const m = META[decision];
  const Icon = m.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border font-mono font-medium tracking-wide",
        m.fg,
        SIZE[size],
      )}
      style={{ background: m.bg, borderColor: m.border, boxShadow: "inset 0 1px 0 0 var(--top-highlight)" }}
    >
      <Icon className={size === "lg" ? "size-5" : size === "md" ? "size-4" : "size-3.5"} aria-hidden />
      {m.label}
    </span>
  );
}
