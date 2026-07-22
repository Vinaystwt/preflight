import { z } from "zod";

const price = z.string().regex(/^\d+(?:\.\d{1,6})?$/);
const defaultCohortSeedAgentIds = [
  "2013", "2023", "1965", "3345", "1891", "1958", "1973", "1445", "1719", "4183", "2135", "1500",
  "2161", "4543", "5421", "5137", "1409", "1828", "5776", "5175", "2012", "1421", "2118", "4442", "2327"
].join(",");

const environment = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_DOMAIN: z.string().default("api.usepreflight.xyz"),
  DATABASE_URL: z.string().url().optional(),
  OPERATOR_WALLET: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  OKX_API_KEY: z.string().min(1).optional(),
  OKX_SECRET_KEY: z.string().min(1).optional(),
  OKX_PASSPHRASE: z.string().min(1).optional(),
  BUILD_SHA: z.string().min(7).default("unknown"),
  LEGACY_ROUTES_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  PAYER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  PAYER_RATE_LIMIT_WINDOW_S: z.coerce.number().int().positive().default(60),
  TARGET_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(10),
  DEEP_CHECK_TARGET_DAILY_CAP_USDT: z.coerce.number().positive().default(2),
  DEEP_CHECK_GLOBAL_DAILY_CAP_USDT: z.coerce.number().positive().default(10),
  PRICE_CHECK_ENDPOINT: price.default("0.02"),
  PRICE_CHECK_X402: price.default("0.05"),
  PRICE_RUN_PREFLIGHT: price.default("0.10"),
  PRICE_DEEP_CHECK: price.default("0.50"),
  PRICE_WATCH_ENDPOINT: price.default("1.00"),
  PRICE_GET_WATCH_REPORT: price.default("0.02"),
  PRICE_PREFLIGHT_CERTIFIED: price.default("10.00"),
  PRICE_CERTIFIED: price.optional(),
  PRICE_WATCH: price.optional(),
  PRICE_WATCH_REPORT: price.optional(),
  PRICE_VERIFY_RELEASE: price.default("0.10"),
  RELEASE_PAYMENT_NETWORK: z.string().default("eip155:196"),
  RELEASE_PAYMENT_ASSET: z.string().default("0x779ded0c9e1022225f8e0630b35a9b54be713736"),
  BUYER_WALLET_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  BUYER_TARGET_DAILY_CAP_USDT: z.coerce.number().positive().default(2),
  BUYER_GLOBAL_DAILY_CAP_USDT: z.coerce.number().positive().default(10),
  ENABLE_STAGE3_TEST_FIXTURES: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  RECEIPTS_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  BADGES_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  GALLERY_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  MCP_TOOL_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  RECEIPT_SIGNING_KEY: z.string().min(32).optional(),
  RECEIPT_KEY_ID: z.string().min(3).max(120).default("preflight-receipts-v1"),
  RECEIPT_CHAIN_ANCHOR: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Comma-separated exact browser origins for the Release Gate frontend.
  // Keep this exact (rather than a permissive Vercel wildcard) so an
  // unrelated *.vercel.app deployment cannot read capability-token reports.
  FRONTEND_ORIGINS: z.string().default("").transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),
  REPORT_TOKEN_SECRET: z.string().min(32).optional(),
  REPORT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  // Retention is executed by the existing reconciliation loop. This controls
  // how often that loop performs the (potentially heavier) database sweep.
  RETENTION_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  FREE_DISCOVERY_CLIENT_DAILY: z.coerce.number().int().positive().default(20),
  FREE_DISCOVERY_TARGET_HOURLY: z.coerce.number().int().positive().default(10),
  FREE_DISCOVERY_GLOBAL_EMERGENCY_DAILY: z.coerce.number().int().positive().default(5_000),
  COHORT_TARGET_HOURLY: z.coerce.number().int().positive().default(10),
  COHORT_GLOBAL_DAILY: z.coerce.number().int().positive().default(500),
  PAID_VERIFICATION_PAYER_PER_MINUTE: z.coerce.number().int().positive().default(30),
  PAID_VERIFICATION_TARGET_PER_HOUR: z.coerce.number().int().positive().default(10),
  MONITOR_INTERVAL_S: z.coerce.number().int().positive().default(1_800),
  MONITOR_DURATION_DAYS: z.coerce.number().int().positive().default(7),
  MONITOR_SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(10_000),
  MONITOR_CONCURRENCY: z.coerce.number().int().positive().max(10).default(3),
  PLAYGROUND_PER_IP_DAILY: z.coerce.number().int().positive().default(3),
  PLAYGROUND_GLOBAL_DAILY: z.coerce.number().int().positive().default(200),
  AGENT_RESOLUTION_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  ONCHAINOS_COMMAND: z.string().min(1).default("onchainos"),
  COHORT_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(21_600_000),
  COHORT_SEED_AGENT_IDS: z.string().default(defaultCohortSeedAgentIds),
  COHORT_OPERATOR_TOKEN: z.string().min(24).optional(),
  COHORT_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  PASSPORT_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SELF_CHECK_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  X_LAYER_RPC_URL: z.string().url().default("https://xlayerrpc.okx.com")
});

export type Config = z.infer<typeof environment>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const config = environment.parse({ ...source, BUILD_SHA: source.BUILD_SHA ?? source.RAILWAY_GIT_COMMIT_SHA });
  if (config.NODE_ENV === "production" && ["dev", "unknown"].includes(config.BUILD_SHA.toLowerCase())) {
    throw new Error("Production requires an immutable BUILD_SHA");
  }
  return config;
}

export function hasPaymentConfig(config: Config): boolean {
  return Boolean(config.OPERATOR_WALLET && config.OKX_API_KEY && config.OKX_SECRET_KEY && config.OKX_PASSPHRASE);
}
