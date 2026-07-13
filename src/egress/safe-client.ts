import { Resolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export class EgressPolicyError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "EgressPolicyError"; }
}

export interface SafeEgressOptions {
  deadlineMs?: number; maxResponseBytes?: number; maxCompressedBytes?: number; maxRedirects?: number; maxRequests?: number;
  userAgent?: string; resolver?: ResolverLike;
  requestOnce?: (url: URL, pinnedAddress: string, family: 4 | 6, body: Buffer, signal: AbortSignal, options: Required<Pick<SafeEgressOptions, "maxCompressedBytes" | "maxResponseBytes" | "userAgent">>) => Promise<RawResponse>;
}
export interface ResolverLike { resolve4(hostname: string): Promise<string[]>; resolve6(hostname: string): Promise<string[]> }
export interface RawResponse { status: number; headers: Record<string, string | string[] | undefined>; compressedBody: Buffer }
export interface SafeResponse { requestedUrl: string; finalUrl: string; status: number; headers: Record<string, string | string[] | undefined>; body: Buffer; redirects: string[]; resolvedAddresses: string[]; durationMs: number }

const blockedV4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
];
const blockedV6 = ["::", "::1", "fc00::", "fe80::", "ff00::", "2001:db8::"] as const;

function ipv4Number(address: string): number { return address.split(".").reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0); }
function inV4Subnet(address: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.some(([base, prefix]) => inV4Subnet(address, base, prefix));
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7));
    return !blockedV6.some((base) => base === "::" ? normalized === "::" : base === "::1" ? normalized === "::1" : normalized.startsWith(base.split("::")[0]!));
  }
  return false;
}

async function resolveAll(hostname: string, resolver: ResolverLike): Promise<Array<{ address: string; family: 4 | 6 }>> {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  const [v4, v6] = await Promise.all([resolver.resolve4(hostname).catch(() => []), resolver.resolve6(hostname).catch(() => [])]);
  const answers = [...v4.map((address) => ({ address, family: 4 as const })), ...v6.map((address) => ({ address, family: 6 as const }))];
  if (!answers.length) throw new EgressPolicyError("DNS_FAIL", "Target hostname returned no addresses");
  if (answers.some(({ address }) => !isPublicAddress(address))) throw new EgressPolicyError("DNS_PRIVATE_OR_MIXED", "Every resolved address must be public");
  return answers;
}

function header(headers: RawResponse["headers"], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]; return Array.isArray(value) ? value[0] : value;
}
function decompress(response: RawResponse, maxResponseBytes: number): Buffer {
  const encoding = header(response.headers, "content-encoding")?.toLowerCase();
  let body: Buffer;
  try { body = encoding === "gzip" ? gunzipSync(response.compressedBody) : encoding === "deflate" ? inflateSync(response.compressedBody) : encoding === "br" ? brotliDecompressSync(response.compressedBody) : response.compressedBody; }
  catch { throw new EgressPolicyError("DECOMPRESSION_FAILED", "Target response decompression failed"); }
  if (body.length > maxResponseBytes) throw new EgressPolicyError("RESPONSE_TOO_LARGE", "Target response exceeded the decompressed byte limit");
  return body;
}

async function nodeRequest(url: URL, pinnedAddress: string, family: 4 | 6, body: Buffer, signal: AbortSignal, options: Required<Pick<SafeEgressOptions, "maxCompressedBytes" | "maxResponseBytes" | "userAgent">>): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "POST", signal, servername: url.hostname, headers: { "content-type": "application/json", "content-length": body.length, "user-agent": options.userAgent, "accept-encoding": "gzip, deflate, br", "idempotency-key": "preflight-probe-request" },
      lookup: (_hostname, lookupOptions, callback) => {
        if (typeof lookupOptions === "object" && lookupOptions.all) return callback(null, [{ address: pinnedAddress, family }]);
        return callback(null, pinnedAddress, family);
      }
    }, (response) => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > options.maxCompressedBytes) request.destroy(new EgressPolicyError("RESPONSE_TOO_LARGE", "Target response exceeded the compressed byte limit")); else chunks.push(chunk); });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, compressedBody: Buffer.concat(chunks) }));
    });
    request.on("error", reject); request.end(body);
  });
}

export class SafeEgressClient {
  private readonly options: Required<Omit<SafeEgressOptions, "resolver" | "requestOnce">>;
  private readonly resolver: ResolverLike;
  private readonly requestOnce: NonNullable<SafeEgressOptions["requestOnce"]>;
  constructor(options: SafeEgressOptions = {}) {
    this.options = { deadlineMs: options.deadlineMs ?? 12_000, maxResponseBytes: options.maxResponseBytes ?? 1_000_000, maxCompressedBytes: options.maxCompressedBytes ?? 512_000, maxRedirects: options.maxRedirects ?? 3, maxRequests: options.maxRequests ?? 4, userAgent: options.userAgent ?? "PreFlight/2.0 (+https://usepreflight.xyz)" };
    this.resolver = options.resolver ?? new Resolver(); this.requestOnce = options.requestOnce ?? nodeRequest;
  }
  async postJson(target: string, value: unknown, redirectPolicy: "NONE" | "SAME_ORIGIN" = "NONE"): Promise<SafeResponse> {
    const requested = new URL(target);
    if (requested.protocol !== "https:" || requested.username || requested.password) throw new EgressPolicyError("TARGET_REJECTED", "Target must be HTTPS and contain no credentials");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.deadlineMs); const started = performance.now();
    const body = Buffer.from(JSON.stringify(value)); const redirects: string[] = []; const addresses = new Set<string>(); let current = requested;
    try {
      for (let count = 0; count < this.options.maxRequests; count += 1) {
        const answers = await resolveAll(current.hostname, this.resolver); answers.forEach(({ address }) => addresses.add(address));
        const pinned = answers[0]!;
        const raw = await this.requestOnce(current, pinned.address, pinned.family, body, controller.signal, this.options);
        if ([301, 302, 303, 307, 308].includes(raw.status)) {
          const location = header(raw.headers, "location");
          if (!location) throw new EgressPolicyError("REDIRECT_MALFORMED", "Redirect omitted Location");
          if (redirectPolicy === "NONE") throw new EgressPolicyError("REDIRECT_FORBIDDEN", "Manifest forbids redirects");
          if (redirects.length >= this.options.maxRedirects) throw new EgressPolicyError("REDIRECT_LIMIT", "Target exceeded redirect limit");
          const next = new URL(location, current);
          if (next.protocol !== "https:" || next.origin !== requested.origin || next.username || next.password) throw new EgressPolicyError("REDIRECT_ORIGIN_REJECTED", "Redirect must remain HTTPS and same-origin");
          if (redirects.includes(next.href) || next.href === current.href) throw new EgressPolicyError("REDIRECT_LOOP", "Redirect loop detected");
          redirects.push(next.href); current = next; continue;
        }
        return { requestedUrl: requested.href, finalUrl: current.href, status: raw.status, headers: raw.headers, body: decompress(raw, this.options.maxResponseBytes), redirects, resolvedAddresses: [...addresses], durationMs: Math.round(performance.now() - started) };
      }
      throw new EgressPolicyError("REQUEST_LIMIT", "Target exceeded maximum request count");
    } catch (error) {
      if (controller.signal.aborted) throw new EgressPolicyError("TIMEOUT", "Target request exceeded total deadline");
      throw error;
    } finally { clearTimeout(timer); }
  }
}
