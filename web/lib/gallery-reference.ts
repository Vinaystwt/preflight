/*
  Synthetic reference archetypes for taxonomy education. Clearly labelled
  "REFERENCE ARCHETYPES / Synthetic" in the UI and NEVER counted in the real
  corpus counters. These are not real reports.
*/
export interface ReferenceArchetype {
  id: string;
  family: GalleryFamily;
  code: string;
  title: string;
  why: string;
  declared: string;
  observed: string;
  fix: string;
  decision: "BLOCK" | "UNKNOWN";
}

export type GalleryFamily =
  | "TARGET"
  | "INTERFACE"
  | "MCP"
  | "PAYMENT"
  | "SETTLEMENT"
  | "DELIVERY"
  | "REPLAY";

export const FAMILIES: GalleryFamily[] = [
  "TARGET",
  "INTERFACE",
  "MCP",
  "PAYMENT",
  "SETTLEMENT",
  "DELIVERY",
  "REPLAY",
];

/** Map a criterion code to a family (used for real entries too). */
export function familyOf(code: string): GalleryFamily {
  const c = code.toUpperCase();
  if (c.startsWith("TARGET")) return "TARGET";
  if (c.startsWith("INTERFACE") || c.startsWith("REDIRECT")) return "INTERFACE";
  if (c.startsWith("MCP")) return "MCP";
  if (c.startsWith("PAY")) return "PAYMENT";
  if (c.startsWith("BUYER_SETTLEMENT") || c.startsWith("SETTLE")) return "SETTLEMENT";
  if (c.startsWith("BUYER_DELIVERY") || c.startsWith("DEL") || c.startsWith("RESPONSE") || c.startsWith("CONTRACT")) return "DELIVERY";
  if (c.startsWith("REPLAY") || c.includes("REPLAY")) return "REPLAY";
  return "PAYMENT";
}

export const REFERENCE: ReferenceArchetype[] = [
  {
    id: "ref-pay-04",
    family: "PAYMENT",
    code: "PAY-04",
    title: "Unexpected payee",
    why: "Buyers would settle to an address the operator did not declare. Funds leave to the wrong wallet.",
    declared: "payTo 0x71A8…45E2",
    observed: "payTo 0x442B…9C07",
    fix: "Point the endpoint payTo to the declared address, then rerun.",
    decision: "BLOCK",
  },
  {
    id: "ref-pay-01",
    family: "PAYMENT",
    code: "PAY-01",
    title: "Price mismatch",
    why: "The live 402 demands a different amount than the listing declares. A buyer's agent refuses to sign.",
    declared: "0.10 USDT",
    observed: "1.00 USDT",
    fix: "Set the x402 atomic amount to the declared value.",
    decision: "BLOCK",
  },
  {
    id: "ref-settle-terms",
    family: "SETTLEMENT",
    code: "BUYER_SETTLEMENT",
    title: "Terms changed mid-purchase",
    why: "PreFlight could not prove a real buyer can complete payment; the terms changed during the flow.",
    declared: "settlement to declared payTo",
    observed: "BUYER_TERMS_CHANGED",
    fix: "Fix the target payment replay/settlement flow, then rerun with buyer proof.",
    decision: "BLOCK",
  },
  {
    id: "ref-del-02",
    family: "DELIVERY",
    code: "DEL-02",
    title: "Paid, not delivered",
    why: "Payment settles but the declared response field is missing, so a buyer pays and receives nothing usable.",
    declared: "quote_id present",
    observed: "field absent",
    fix: "Return the declared response contract after payment.",
    decision: "BLOCK",
  },
  {
    id: "ref-replay",
    family: "REPLAY",
    code: "REPLAY-01",
    title: "Duplicate replay accepted",
    why: "A duplicate payment authorization is accepted, so a buyer can be charged twice for one delivery.",
    declared: "duplicate replay rejected",
    observed: "duplicate accepted (200)",
    fix: "Reject duplicate payment payloads (respond 409).",
    decision: "BLOCK",
  },
  {
    id: "ref-mcp",
    family: "MCP",
    code: "MCP-03",
    title: "No tools exposed",
    why: "The MCP handshake succeeds but tools/list is empty, so an agent cannot actually call the service.",
    declared: "at least one tool",
    observed: "0 tools",
    fix: "Expose the declared tools in tools/list.",
    decision: "UNKNOWN",
  },
];
