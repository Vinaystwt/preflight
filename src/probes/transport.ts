import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import { URL } from "node:url";
import type { Finding, ProbeResult } from "../types.js";

const USER_AGENT = "PreFlight/1.0 (+https://usepreflight.xyz)";
const TIMEOUT_MS = 10_000;

export class TargetRejectedError extends Error {}

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = ip.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fe80:") ||
    value.startsWith("fc") || value.startsWith("fd") || value.startsWith("::ffff:127.") ||
    value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
}

export async function assertPublicHttps(value: string): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new TargetRejectedError("target must be an absolute URL"); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new TargetRejectedError("target must be a credential-free https URL");
  }
  let records: Array<{ address: string }>;
  try { records = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true, verbatim: true }); }
  catch (error) { throw new TargetRejectedError(`target DNS resolution failed: ${error instanceof Error ? error.message : "unknown error"}`); }
  if (!records.length || records.some((record) => privateIp(record.address))) {
    throw new TargetRejectedError("target resolves to a private, loopback, link-local, or multicast address");
  }
  return url;
}

export interface HttpResult { status: number; headers: Record<string, string | string[] | undefined>; body: string; latencyMs: number; tls: { authorized: boolean; validTo?: string; subject?: string }; }

export async function httpsRequest(input: URL, options: { method?: string; body?: string; headers?: Record<string, string>; redirects?: number } = {}): Promise<HttpResult> {
  await assertPublicHttps(input.toString());
  const redirects = options.redirects ?? 0;
  if (redirects > 3) throw new Error("redirect limit exceeded");
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = https.request(input, { method: options.method ?? "GET", headers: { "user-agent": USER_AGENT, ...options.headers }, timeout: TIMEOUT_MS,
      lookup: async (host, lookupOptions, callback) => {
        try {
          const records = await lookup(host, { all: true, verbatim: true });
          if (!records.length || records.some((record) => privateIp(record.address))) return callback(new TargetRejectedError("DNS lookup returned a private or no address"), "", 4);
          if (typeof lookupOptions === "object" && lookupOptions.all) {
            (callback as unknown as (error: Error | null, addresses: typeof records) => void)(null, records);
          } else {
            const first = records[0]!;
            callback(null, first.address, first.family);
          }
        } catch (error) { callback(error as Error, "", 4); }
      } }, (response) => {
      const chunks: Buffer[] = [];
      const socket = response.socket as import("node:tls").TLSSocket;
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", async () => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          try { const next = new URL(location, input); if (next.protocol !== "https:") throw new Error("redirect changed protocol");
            resolve(await httpsRequest(next, { ...options, redirects: redirects + 1 })); } catch (error) { reject(error); }
          return;
        }
        const cert = socket.getPeerCertificate();
        const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]));
        resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8"), latencyMs: Math.round(performance.now() - started),
          tls: { authorized: socket.authorized, validTo: cert.valid_to, subject: Array.isArray(cert.subject?.CN) ? cert.subject.CN.join(", ") : cert.subject?.CN } });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export async function probeTransport(target: string): Promise<ProbeResult> {
  const findings: Finding[] = [];
  try {
    const url = await assertPublicHttps(target);
    const samples = await Promise.all(Array.from({ length: 3 }, () => httpsRequest(url)));
    const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
    const first = samples[0]!;
    if (!first.tls.authorized) findings.push({ code: "TLS_INVALID", severity: "high", evidence: "TLS certificate was not authorized", fix: "Install a publicly trusted TLS certificate." });
    const expiry = first.tls.validTo ? Math.floor((new Date(first.tls.validTo).getTime() - Date.now()) / 86_400_000) : undefined;
    if (expiry !== undefined && expiry < 14) findings.push({ code: "TLS_EXPIRING", severity: "high", evidence: `Certificate expires in ${expiry} days`, fix: "Renew the TLS certificate before it expires." });
    return { findings, evidence: { median_latency_ms: latencies[1], status: first.status, tls: first.tls, samples_ms: latencies } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown transport error";
    const code = message.includes("timeout") ? "TIMEOUT" : message.includes("private") || message.includes("https") ? "SSRF_REJECTED" : "DNS_FAIL";
    findings.push({ code, severity: "high", evidence: message, fix: "Use a public HTTPS endpoint with valid DNS and TLS." });
    return { findings, evidence: { error: message } };
  }
}
