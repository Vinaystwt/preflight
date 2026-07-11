import { z } from "zod";

const price = z.string().regex(/^\d+(?:\.\d{1,6})?$/);

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
  REPORT_TOKEN_SECRET: z.string().min(32).optional(),
  REPORT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  FREE_DRAFT_IP_DAILY: z.coerce.number().int().positive().default(5),
  FREE_DRAFT_TARGET_DAILY: z.coerce.number().int().positive().default(10),
  FREE_DRAFT_GLOBAL_DAILY: z.coerce.number().int().positive().default(60),
  MONITOR_INTERVAL_S: z.coerce.number().int().positive().default(1_800),
  MONITOR_DURATION_DAYS: z.coerce.number().int().positive().default(7),
  MONITOR_SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(10_000),
  MONITOR_CONCURRENCY: z.coerce.number().int().positive().max(10).default(3),
  PLAYGROUND_PER_IP_DAILY: z.coerce.number().int().positive().default(3),
  PLAYGROUND_GLOBAL_DAILY: z.coerce.number().int().positive().default(200),
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
