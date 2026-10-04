import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectionResult } from "@/lib/detect";

const detectShopify = vi.fn<(input: string) => Promise<DetectionResult>>();
vi.mock("@/lib/detect", async (orig) => ({ ...(await orig<typeof import("@/lib/detect")>()), detectShopify }));

const { runCheck } = await import("@/lib/check-service");
const { getCached } = await import("@/lib/cache");

const result = (host: string, is_shopify: boolean): DetectionResult => ({
  input_url: host,
  final_url: `https://${host}/`,
  is_shopify,
  confidence: is_shopify ? 0.95 : 0,
  shop_domain: null,
  detected_signals: [],
  headers_sample: {},
  elapsed_ms: 100,
});

describe("runCheck", () => {
  beforeEach(() => detectShopify.mockReset());

  it("caches by normalized host and marks hits as cached", async () => {
    detectShopify.mockResolvedValueOnce(result("cache-a.example", true));
    const first = await runCheck("https://Cache-A.example/some/page");
    expect(first.cached).toBe(false);

    const second = await runCheck("cache-a.example");
    expect(second).toMatchObject({ cached: true, input_url: "cache-a.example", is_shopify: true });
    expect(detectShopify).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache with fresh", async () => {
    detectShopify.mockResolvedValue(result("cache-b.example", false));
    await runCheck("cache-b.example");
    const again = await runCheck("cache-b.example", { fresh: true });
    expect(again.cached).toBe(false);
    expect(detectShopify).toHaveBeenCalledTimes(2);
  });

  it("uses a 24h TTL for positives and 6h for negatives", async () => {
    vi.useFakeTimers();
    try {
      detectShopify.mockResolvedValueOnce(result("ttl-pos.example", true)).mockResolvedValueOnce(result("ttl-neg.example", false));
      await runCheck("ttl-pos.example");
      await runCheck("ttl-neg.example");
      vi.advanceTimersByTime(7 * 60 * 60 * 1000);
      expect(await getCached("ttl-pos.example")).not.toBeNull();
      expect(await getCached("ttl-neg.example")).toBeNull();
      vi.advanceTimersByTime(18 * 60 * 60 * 1000);
      expect(await getCached("ttl-pos.example")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cache errors", async () => {
    detectShopify.mockRejectedValueOnce(new Error("boom"));
    await expect(runCheck("err.example")).rejects.toThrow("boom");
    expect(await getCached("err.example")).toBeNull();
  });

  it("shares one detection between concurrent checks of the same host", async () => {
    let resolve!: (r: DetectionResult) => void;
    detectShopify.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const a = runCheck("dedupe.example", { fresh: true });
    const b = runCheck("https://dedupe.example/", { fresh: true });
    resolve(result("dedupe.example", true));
    await Promise.all([a, b]);
    expect(detectShopify).toHaveBeenCalledTimes(1);
  });
});
