/*
  Central API client. Request id, abort timeout, typed error category, bearer
  support, URL/token redaction in logs, no auto-retry on paid mutations.
*/
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "https://api.usepreflight.xyz";

export type ErrorKind =
  | "field"
  | "payment"
  | "rate_limit"
  | "dependency"
  | "internal"
  | "report_access";

export class ApiError extends Error {
  constructor(
    public kind: ErrorKind,
    public code: string,
    message: string,
    public httpStatus: number,
    public requestId?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

function redact(url: string): string {
  try {
    const u = new URL(url, API_BASE);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "[url]";
  }
}

const CATEGORY: Record<string, ErrorKind> = {
  VALIDATION: "field",
  PAYMENT: "payment",
  RATE_LIMIT: "rate_limit",
  DEPENDENCY: "dependency",
  INTERNAL: "internal",
  REPORT_ACCESS: "report_access",
};

export async function apiRequest<T>(
  parse: (data: unknown) => T,
  opts: {
    method?: "GET" | "POST";
    path: string;
    body?: unknown;
    bearer?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<T> {
  const { method = "GET", path, body, bearer, timeoutMs = 20_000, signal } = opts;
  const reqId = `c_${crypto.randomUUID()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "x-client-request-id": reqId,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    console.warn(`[api] request failed for ${redact(path)}`);
    throw new TransportError(controller.signal.aborted ? "request timed out" : "network request failed");
  }
  clearTimeout(timer);

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const err = (json as { error?: Record<string, unknown> } | undefined)?.error;
    if (err && typeof err.code === "string") {
      throw new ApiError(
        CATEGORY[String(err.category)] ?? "internal",
        String(err.code),
        String(err.message ?? "request failed"),
        res.status,
        typeof err.request_id === "string" ? err.request_id : undefined,
        err.details as Record<string, unknown> | undefined,
      );
    }
    console.warn(`[api] untyped ${res.status} for ${redact(path)}`);
    throw new TransportError(`unexpected ${res.status}`);
  }

  return parse(json);
}
