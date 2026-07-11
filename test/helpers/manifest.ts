export const manifestFixture = {
  schema_version: "preflight.release-manifest.v1" as const,
  release: { service_name: "Example", release_version: "1.0.0" },
  target: { endpoint: "https://example.com/api", method: "POST" as const, interface_mode: "X402_HTTP" as const, redirect_policy: "NONE" as const },
  payment: { mode: "X402" as const, network: "eip155:196", asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736", amount_atomic: "100000", pay_to: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2" },
  request_contract: { content_type: "application/json" as const, schema: { type: "object" as const, properties: { target: { type: "string" as const } }, required: ["target"] } }
};
