import { detectShopify, normalizeInput, type DetectionResult } from "./detect";
import { getCached, setCached } from "./cache";

export type CheckResult = DetectionResult & { cached: boolean };

const inflight = new Map<string, Promise<DetectionResult>>();

/** Cache-aware check. Concurrent checks of the same host share one fetch. Throws DetectionError. */
export async function runCheck(raw: string, { fresh = false }: { fresh?: boolean } = {}): Promise<CheckResult> {
  const { host } = normalizeInput(raw);
  const input_url = raw.trim();

  if (!fresh) {
    const hit = await getCached(host);
    if (hit) return { ...hit, input_url, cached: true };
  }

  let pending = inflight.get(host);
  if (!pending) {
    pending = detectShopify(raw).finally(() => inflight.delete(host));
    inflight.set(host, pending);
  }
  const result = await pending;
  await setCached(host, result);
  return { ...result, input_url, cached: false };
}
