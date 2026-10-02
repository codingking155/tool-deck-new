import { track } from "@vercel/analytics";

export type CheckOutcome = "shopify" | "not_shopify" | "error";

export function trackCheck(result: CheckOutcome, code?: string) {
  try {
    track("check_performed", code ? { result, code } : { result });
  } catch {
    // Analytics must never break the checker.
  }
}
