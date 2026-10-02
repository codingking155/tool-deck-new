import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, LIMIT_PER_DAY, LIMIT_PER_MINUTE } from "@/lib/ratelimit";

describe("checkRateLimit (in-memory fallback)", () => {
  afterEach(() => vi.useRealTimers());

  it("allows 60 requests per minute, then blocks until the window resets", async () => {
    vi.useFakeTimers();
    const id = "ip-minute";
    for (let i = 0; i < LIMIT_PER_MINUTE; i++) expect((await checkRateLimit(id)).success).toBe(true);
    const blocked = await checkRateLimit(id);
    expect(blocked).toMatchObject({ success: false, remaining: 0, limit: LIMIT_PER_MINUTE });
    expect(blocked.reset).toBeGreaterThan(Date.now());

    vi.advanceTimersByTime(61_000);
    expect((await checkRateLimit(id)).success).toBe(true);
  });

  it("charges bulk requests by cost", async () => {
    const r = await checkRateLimit("ip-bulk", 50);
    expect(r).toMatchObject({ success: true, remaining: 10 });
    expect((await checkRateLimit("ip-bulk", 11)).success).toBe(false);
  });

  it("enforces the daily cap across minute windows", async () => {
    vi.useFakeTimers();
    const id = "ip-day";
    for (let used = 0; used < LIMIT_PER_DAY; used += 50) {
      expect((await checkRateLimit(id, 50)).success).toBe(true);
      vi.advanceTimersByTime(61_000);
    }
    const r = await checkRateLimit(id);
    expect(r).toMatchObject({ success: false, limit: LIMIT_PER_DAY });
  });
});
