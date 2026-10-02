import { describe, expect, it } from "vitest";
import { normalizeInput } from "@/lib/detect/normalize";
import { DetectionError } from "@/lib/detect/errors";

describe("normalizeInput", () => {
  it.each([
    ["example.com", "example.com"],
    ["  Example.COM  ", "example.com"],
    ["www.example.com", "www.example.com"],
    ["https://example.com/path?q=1#x", "example.com"],
    ["http://shop.example.co.uk/", "shop.example.co.uk"],
    ["example.com.", "example.com"],
    ["https://user:pass@example.com", "example.com"],
    ["example.com:443", "example.com"],
    ["\"example.com\"", "example.com"],
    ["xn--bcher-kva.example", "xn--bcher-kva.example"],
    ["bücher.de", "xn--bcher-kva.de"],
  ])("normalizes %j to https://%s/", (input, host) => {
    expect(normalizeInput(input)).toEqual({ host, url: `https://${host}/` });
  });

  it.each([
    ["", /enter a website/i],
    ["   ", /enter a website/i],
    ["not a url", /valid/i],
    ["example", /valid domain/i],
    ["ftp://example.com", /only http/i],
    ["javascript:alert(1)", /valid/i],
    ["127.0.0.1", /ip address/i],
    ["http://2130706433", /ip address/i],
    ["http://0x7f.1", /ip address/i],
    ["[::1]", /ip address/i],
    ["localhost", /local/i],
    ["router.local", /local/i],
    ["metadata.google.internal", /local/i],
    ["example.com:8080", /ports/i],
    ["-bad-.com", /valid domain/i],
    ["example.123", /valid/i],
  ])("rejects %j", (input, message) => {
    let caught: unknown;
    try {
      normalizeInput(input);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DetectionError);
    expect((caught as DetectionError).code).toBe("invalid_url");
    expect((caught as DetectionError).message).toMatch(message);
  });
});
