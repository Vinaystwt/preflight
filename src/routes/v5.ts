import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { canonicalHash, type JsonValue } from "../contracts/canonical.js";
import { agentResolutionV1Schema, receiptEnvelopeV1Schema } from "../contracts/release-gate.js";
import { FreeCohortScanner, cohortPublicPayload } from "../cohort.js";
import { ReleaseRepository } from "../release/repository.js";
import { OnchainOsAgentResolver } from "../resolve/agent.js";
import { verifyReceiptSignature } from "../receipts/signer.js";

const offlineCommand = (base: string, receiptId: string) => `node --input-type=module -e 'import {createPublicKey,verify,createHash} from "node:crypto"; const base="${base}", r=await (await fetch(base+"/api/v1/receipts/${receiptId}")).json(), ks=await (await fetch(base+"/api/v1/pubkeys")).json(), c=x=>Array.isArray(x)?"["+x.map(c).join(",")+"]":x&&typeof x==="object"?"{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+c(x[k])).join(",")+"}":JSON.stringify(x), k=ks.keys.find(x=>x.key_id===r.key_id), ok=verify(null,Buffer.from(c(r.payload)),createPublicKey({key:Buffer.from(k.public_key_base64,"base64"),format:"der",type:"spki"}),Buffer.from(r.signature,"base64")); console.log({signature_valid:ok,payload_hash_matches:"sha256:"+createHash("sha256").update(c(r.payload)).digest("hex")===r.verify.payload_hash});'`;
export function passportBadgeSvg(agentId: string, status: "RELEASE" | "STALE", receiptId: string, issuedAt: string, policy: string) {
  const color = status === "RELEASE" ? "#38D996" : "#F2B84B";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="28" viewBox="0 0 88 28" role="img" aria-label="PreFlight ${status}"><metadata>receipt_id=${receiptId};issued_at=${issuedAt};policy_version=${policy}</metadata><rect width="87" height="27" x=".5" y=".5" rx="4" fill="#0B0E12" stroke="#303842"/><text x="7" y="18" fill="#fff" font-family="IBM Plex Mono,monospace" font-size="8" font-weight="700">PREFLIGHT</text><text x="60" y="18" fill="${color}" font-family="IBM Plex Mono,monospace" font-size="8" font-weight="700">${status === "RELEASE" ? "REL" : "STL"}</text></svg>`;
}

export function mountV5Routes(app: FastifyInstance, config: Config, repository: ReleaseRepository | null, scanner?: FreeCohortScanner): { scan(): Promise<unknown> } {
  const resolver = new OnchainOsAgentResolver(config.ONCHAINOS_COMMAND);
  const v5Scanner = scanner;
  const resolve = async (agentId: string) => {
    if (!repository) throw new Error("store unavailable");
    const cached = await repository.cachedAgentResolution(agentId); if (cached) return cached;
    const result = await resolver.resolve(agentId); await repository.cacheAgentResolution(result, config.AGENT_RESOLUTION_TTL_SECONDS); return result;
  };
  app.post("/api/v1/resolve", async (request, reply) => {
    if (!repository) return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "RELEASE_STORE_UNAVAILABLE", message: "Release storage is not ready." } });
    const parsed = z.object({ agent_id: z.string().min(1).max(200) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ schema_version: "preflight.error.v1", error: { code: "AGENT_ID_INVALID", message: "agent_id is required." } });
    const limit = await repository.reserveRateLimit("resolve_ip_hour", request.ip, 10, "hour");
    if (!limit.allowed) return reply.code(429).send({ schema_version: "preflight.error.v1", error: { code: "RESOLVE_RATE_LIMITED", message: "Agent resolution is limited to 10 requests per IP per hour." } });
    try { return agentResolutionV1Schema.parse(await resolve(parsed.data.agent_id)); }
    catch (cause) { return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "AGENT_DISCOVERY_UNAVAILABLE", message: cause instanceof Error ? cause.message : "Agent listing resolution is unavailable." } }); }
  });
  const receiptVerification = async (body: unknown, requestIp: string) => {
    if (!repository) return { status: 503, body: { schema_version: "preflight.error.v1", error: { code: "RELEASE_STORE_UNAVAILABLE", message: "Release storage is not ready." } } };
    const rate = await repository.reserveRateLimit("verify_receipt_ip_minute", requestIp, 60, "minute"); const global = await repository.reserveRateLimit("verify_receipt_global_minute", "global", 600, "minute");
    if (!rate.allowed || !global.allowed) return { status: 429, body: { schema_version: "preflight.error.v1", error: { code: "VERIFY_RECEIPT_RATE_LIMITED", message: "Receipt verification is temporarily rate limited." } } };
    const parsed = z.union([z.object({ receipt_id: z.string().min(1) }).strict(), z.object({ payload: z.unknown(), signature: z.string(), key_id: z.string() }).strict()]).safeParse(body);
    if (!parsed.success) return { status: 400, body: { schema_version: "preflight.error.v1", error: { code: "RECEIPT_INVALID", message: "Provide receipt_id or a receipt envelope." } } };
    let envelope: ReturnType<typeof receiptEnvelopeV1Schema.parse> | null = null;
    if ("receipt_id" in parsed.data) { const stored = await repository.getReceipt(parsed.data.receipt_id); if (stored) envelope = receiptEnvelopeV1Schema.parse({ receipt_id: stored.id, payload: stored.payload, signature: stored.signature, signature_alg: "Ed25519", key_id: stored.key_id, verify: { canonicalization: "preflight.canonical-json.v1", payload_hash: canonicalHash(stored.payload as unknown as JsonValue), pubkeys_url: `https://${config.PUBLIC_DOMAIN}/api/v1/pubkeys` } }); }
    else envelope = receiptEnvelopeV1Schema.safeParse({ ...parsed.data, receipt_id: (parsed.data.payload as { receipt_id?: unknown })?.receipt_id, signature_alg: "Ed25519", verify: { canonicalization: "preflight.canonical-json.v1", payload_hash: canonicalHash(parsed.data.payload as JsonValue), pubkeys_url: `https://${config.PUBLIC_DOMAIN}/api/v1/pubkeys` } }).success ? receiptEnvelopeV1Schema.parse({ ...parsed.data, receipt_id: (parsed.data.payload as { receipt_id: string }).receipt_id, signature_alg: "Ed25519", verify: { canonicalization: "preflight.canonical-json.v1", payload_hash: canonicalHash(parsed.data.payload as JsonValue), pubkeys_url: `https://${config.PUBLIC_DOMAIN}/api/v1/pubkeys` } }) : null;
    if (!envelope) return { status: 404, body: { schema_version: "preflight.error.v1", error: { code: "RECEIPT_NOT_FOUND", message: "Receipt is unavailable." } } };
    const key = (await repository.listPubkeys()).find((item) => item.key_id === envelope!.key_id); const signatureValid = Boolean(key && verifyReceiptSignature(envelope.payload, envelope.signature, key.public_key_base64)); const hashMatches = canonicalHash(envelope.payload as unknown as JsonValue) === envelope.verify.payload_hash;
    const scope = envelope.payload.scope ?? { proves: ["issuer_authenticity", "payload_integrity", "snapshot_binding", "policy_binding"], does_not_prove: ["semantic_correctness_of_delivery", "future_behaviour", "security_of_target", "marketplace_endorsement"], policy_version: envelope.payload.policy_version, snapshot_hash: envelope.payload.snapshot_hash, valid_until: new Date(Date.parse(envelope.payload.issued_at) + 30 * 86_400_000).toISOString() };
    return { status: 200, body: { signature_valid: signatureValid, issuer: `https://${config.PUBLIC_DOMAIN}`, key_id: envelope.key_id, key_status: key?.status ?? "retired", payload_hash_matches: hashMatches, not_expired: new Date(scope.valid_until) > new Date(), snapshot_binding: { manifest_hash: envelope.payload.manifest_hash, snapshot_hash: envelope.payload.snapshot_hash }, policy_version: envelope.payload.policy_version, scope, verified_at: new Date().toISOString(), how_to_verify_offline: offlineCommand(`https://${config.PUBLIC_DOMAIN}`, envelope.receipt_id) } };
  };
  app.post("/api/v1/verify-receipt", async (request, reply) => { const result = await receiptVerification(request.body, request.ip); return reply.code(result.status).send(result.body); });
  app.get("/api/v1/verify-receipt", async (request, reply) => { const receiptId = (request.query as { receipt_id?: string }).receipt_id; const result = await receiptVerification(receiptId ? { receipt_id: receiptId } : {}, request.ip); return reply.code(result.status).send(result.body); });
  app.get("/api/v1/cohort", async (_request, reply) => {
    if (!repository) return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "RELEASE_STORE_UNAVAILABLE", message: "Release storage is not ready." } });
    const [rows, latest, driftEvents24h] = await Promise.all([repository.latestCohortRows(), repository.latestCohortScan(), repository.driftEventsLast24h()]); return reply.header("Cache-Control", "public, max-age=600").send(cohortPublicPayload(rows, latest?.generated_at.toISOString() ?? new Date().toISOString(), driftEvents24h));
  });
  app.get("/api/v1/asp/:agentId", async (request, reply) => {
    if (!repository) return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "RELEASE_STORE_UNAVAILABLE", message: "Release storage is not ready." } });
    const row = await repository.cohortRow((request.params as { agentId: string }).agentId); if (!row) return reply.code(404).send({ schema_version: "preflight.asp.v1", state: "not_scanned", invitation: "No free discovery evidence is available yet. An owner can authorize a full check to publish a scoped passport." });
    if (row.decision === "RELEASE") return reply.header("Cache-Control", "public, max-age=600").send({ schema_version: "preflight.asp.v1", agent_id: row.agent_id, name: row.name, decision: row.decision, last_checked: row.checked_at.toISOString(), declared: row.declared, observed: row.observed });
    return reply.header("Cache-Control", "public, max-age=600").send({ schema_version: "preflight.asp.v1", agent_id: row.agent_id, runtime_evidence: "available", last_checked: row.checked_at.toISOString(), criterion_codes: row.criterion_codes, owner_claim_cta: "Are you the owner? Authorize a full check to publish a scoped passport." });
  });
  app.post("/api/v1/cohort/rescan", async (request, reply) => {
    const authorization = request.headers.authorization; if (!config.COHORT_OPERATOR_TOKEN || authorization !== `Bearer ${config.COHORT_OPERATOR_TOKEN}`) return reply.code(404).send({ schema_version: "preflight.error.v1", error: { code: "NOT_FOUND", message: "Not found." } });
    if (!v5Scanner) return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "COHORT_DISABLED", message: "Cohort scanning is unavailable." } });
    const ids = config.COHORT_SEED_AGENT_IDS.split(",").map((value) => value.trim()).filter(Boolean); return reply.code(202).send(await v5Scanner.scan(ids));
  });
  app.get("/api/v1/passport/:agentId", async (request, reply) => {
    if (!repository) return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "RELEASE_STORE_UNAVAILABLE", message: "Release storage is not ready." } });
    const passport = await repository.getPassport((request.params as { agentId: string }).agentId); if (!passport) return reply.code(404).send({ schema_version: "preflight.passport.v1", state: "none", message: "No owner-authorized passport has been issued." });
    const stale = Boolean(passport.revoked_at || passport.expires_at <= new Date()); return reply.header("Cache-Control", "public, max-age=300").send({ schema_version: "preflight.passport.v1", agent_id: passport.agent_id, decision: passport.decision, receipt_id: passport.receipt_id, policy_version: passport.policy_version, issued_at: passport.issued_at.toISOString(), expires_at: passport.expires_at.toISOString(), state: stale ? "STALE" : "RELEASE", revoked_at: passport.revoked_at?.toISOString() ?? null, revocation_reason: passport.revocation_reason, badge_url: `https://${config.PUBLIC_DOMAIN}/api/v1/badge/${passport.agent_id}.svg` });
  });
  app.get("/api/v1/benchmark", async (_request, reply) => {
    if (!repository) return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "RELEASE_STORE_UNAVAILABLE", message: "Release storage is not ready." } }); const run = await repository.latestBenchmark(); if (!run) return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "BENCHMARK_UNAVAILABLE", message: "Benchmark evidence has not been generated yet." } }); return reply.header("Cache-Control", "public, max-age=600").send({ schema_version: "preflight.benchmark.v1", policy_version: run.policy_version, generated_at: run.generated_at.toISOString(), total_fixtures: run.total, passing: run.passing, cases: run.cases });
  });
  app.get("/api/v1/self-check", async (_request, reply) => {
    if (!repository) return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "RELEASE_STORE_UNAVAILABLE", message: "Release storage is not ready." } });
    const check = await repository.latestSelfCheck();
    if (!check) return reply.code(503).send({ schema_version: "preflight.error.v1", error: { code: "SELF_CHECK_UNAVAILABLE", message: "No operator-funded self-check has been published yet." } });
    return reply.header("Cache-Control", "public, max-age=600").send({ schema_version: "preflight.self-check.v1", report_id: check.report_id, receipt_id: check.receipt_id, decision: check.decision, settlement_ref: check.settlement_ref, label: check.label, customer_demand: check.customer_demand, published_at: check.published_at.toISOString(), evidence: check.payload });
  });
  return { scan: async () => v5Scanner?.scan(config.COHORT_SEED_AGENT_IDS.split(",").map((value) => value.trim()).filter(Boolean)) ?? { status: "disabled" } };
}
