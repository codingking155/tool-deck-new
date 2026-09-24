import { describe, expect, it } from "vitest";
import { assertPublicHost, isBlockedIp } from "@/lib/detect/ssrf";
import { DetectionError } from "@/lib/detect/errors";

describe("isBlockedIp", () => {
  it.each([
    "10.0.0.1",
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "127.0.0.1",
    "127.10.0.3",
    "0.0.0.0",
    "169.254.169.254",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::10.0.0.1",
    "2002:c0a8:0101::1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["23.227.38.65", "8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::6810:84e5", "::ffff:23.227.38.65"])("allows %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("assertPublicHost", () => {
  const resolverFor = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("passes for public addresses", async () => {
    await expect(assertPublicHost("shop.example", resolverFor("23.227.38.65"))).resolves.toBeUndefined();
  });

  it("rejects a domain that resolves to a private address", async () => {
    await expect(assertPublicHost("evil.example", resolverFor("10.0.0.5"))).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("rejects when any one record is private (mixed answers)", async () => {
    await expect(assertPublicHost("mixed.example", resolverFor("23.227.38.65", "169.254.169.254"))).rejects.toMatchObject({
      code: "invalid_url",
    });
  });

  it("maps DNS failures to unreachable/dns", async () => {
    const failing = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
    };
    const err = await assertPublicHost("missing.example", failing).catch((e) => e);
    expect(err).toBeInstanceOf(DetectionError);
    expect(err).toMatchObject({ code: "unreachable", reason: "dns", status: 422 });
  });
});
