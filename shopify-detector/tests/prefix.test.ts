import { describe, expect, it } from "vitest";
import { parsePrefixPath } from "@/lib/prefix";

describe("parsePrefixPath", () => {
  it.each([
    [["allbirds.com"], "allbirds.com"],
    [["www.Allbirds.com"], "www.allbirds.com"],
    [["allbirds.com", "products", "shoes"], "allbirds.com"],
    [["https:", "allbirds.com"], "allbirds.com"],
    [["https:", "", "allbirds.com", "collections"], "allbirds.com"],
    [["https%3A%2F%2Fallbirds.com"], "allbirds.com"],
  ])("%j → %s", (segments, host) => {
    expect(parsePrefixPath(segments)).toBe(host);
  });

  it.each([
    [["api-docs"]],
    [["blog"]],
    [["Blogs"]],
    [["api", "unknown"]],
    [["_next", "static", "x.js"]],
    [["favicon.ico"]],
    [["wp-login.php"]],
    [["logo.png"]],
    [["not-a-domain"]],
    [["localhost"]],
    [["127.0.0.1"]],
    [[]],
  ])("%j → null", (segments) => {
    expect(parsePrefixPath(segments)).toBeNull();
  });
});
