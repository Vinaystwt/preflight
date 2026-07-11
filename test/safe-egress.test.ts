import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EgressPolicyError, SafeEgressClient, isPublicAddress, type RawResponse } from "../src/egress/safe-client.js";

const publicResolver = { resolve4: async () => ["93.184.216.34"], resolve6: async () => [] };
const raw = (status: number, body = "{}", headers: RawResponse["headers"] = {}): RawResponse => ({ status, headers, compressedBody: Buffer.from(body) });

describe("hardened safe egress", () => {
  it("blocks private, loopback, link-local, documentation and mapped addresses", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"]) expect(isPublicAddress(address)).toBe(false);
    expect(isPublicAddress("93.184.216.34")).toBe(true);
  });

  it("rejects mixed DNS answers before making a request", async () => {
    const requestOnce = async () => raw(200); const client = new SafeEgressClient({ resolver: { resolve4: async () => ["93.184.216.34", "127.0.0.1"], resolve6: async () => [] }, requestOnce });
    await expect(client.postJson("https://example.com", {})).rejects.toMatchObject({ code: "DNS_PRIVATE_OR_MIXED" });
  });

  it("pins validated DNS and permits only same-origin redirects when declared", async () => {
    const seen: string[] = [];
    const client = new SafeEgressClient({ resolver: publicResolver, requestOnce: async (url, address) => { seen.push(`${url.href}|${address}`); return seen.length === 1 ? raw(307, "", { location: "/final" }) : raw(200, '{"ok":true}'); } });
    const response = await client.postJson("https://example.com/start", {}, "SAME_ORIGIN");
    expect(response.finalUrl).toBe("https://example.com/final"); expect(seen).toEqual(["https://example.com/start|93.184.216.34", "https://example.com/final|93.184.216.34"]);
  });

  it("rejects redirect loops and cross-origin redirects", async () => {
    const loop = new SafeEgressClient({ resolver: publicResolver, requestOnce: async () => raw(307, "", { location: "/start" }) });
    await expect(loop.postJson("https://example.com/start", {}, "SAME_ORIGIN")).rejects.toMatchObject({ code: "REDIRECT_LOOP" });
    const cross = new SafeEgressClient({ resolver: publicResolver, requestOnce: async () => raw(307, "", { location: "https://evil.example/final" }) });
    await expect(cross.postJson("https://example.com/start", {}, "SAME_ORIGIN")).rejects.toMatchObject({ code: "REDIRECT_ORIGIN_REJECTED" });
  });

  it("revalidates DNS on every redirect hop and blocks a private second answer", async () => {
    let resolutions = 0;
    const client = new SafeEgressClient({ resolver: { resolve4: async () => (++resolutions === 1 ? ["93.184.216.34"] : ["127.0.0.1"]), resolve6: async () => [] }, requestOnce: async () => raw(307, "", { location: "/final" }) });
    await expect(client.postJson("https://example.com/start", {}, "SAME_ORIGIN")).rejects.toMatchObject({ code: "DNS_PRIVATE_OR_MIXED" });
  });

  it("bounds decompressed bodies", async () => {
    const client = new SafeEgressClient({ resolver: publicResolver, maxResponseBytes: 32, requestOnce: async () => ({ status: 200, headers: { "content-encoding": "gzip" }, compressedBody: gzipSync(Buffer.alloc(1_000, 65)) }) });
    await expect(client.postJson("https://example.com", {})).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("uses one total cancellation deadline", async () => {
    const client = new SafeEgressClient({ resolver: publicResolver, deadlineMs: 10, requestOnce: async (_url, _address, _family, _body, signal) => await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) });
    await expect(client.postJson("https://example.com", {})).rejects.toEqual(new EgressPolicyError("TIMEOUT", "Target request exceeded total deadline"));
  });
});
