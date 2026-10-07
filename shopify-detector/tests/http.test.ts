import { describe, expect, it, vi } from "vitest";

const undiciFetch = vi.fn();
vi.mock("undici", async (orig) => ({ ...(await orig<typeof import("undici")>()), fetch: undiciFetch }));

const { fetchPage } = await import("@/lib/detect/http");

describe("fetchPage redirects", () => {
  // Sockets skip DNS lookup for IP literals, so safeLookup never sees them.
  it.each(["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/", "http://[::1]/"])(
    "refuses a redirect to a private IP literal (%s)",
    async (location) => {
      undiciFetch.mockReset();
      undiciFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
      await expect(fetchPage("https://example.com/", { timeoutMs: 1000, maxBytes: 1000 })).rejects.toMatchObject({
        code: "invalid_url",
      });
      expect(undiciFetch).toHaveBeenCalledTimes(1);
    },
  );
});
