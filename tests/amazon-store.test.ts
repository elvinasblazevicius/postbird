import { describe, expect, it } from "vitest";
import { amazonBookUrl, amazonStoreFor } from "@/lib/amazon-store";
import { countryFromHeaders } from "@/lib/visitor-country";

describe("the Amazon store for a visitor's country", () => {
  it("uses the country's own store where there is one", () => {
    expect(amazonStoreFor("DE")).toBe("amazon.de");
    expect(amazonStoreFor("fr")).toBe("amazon.fr");
    expect(amazonStoreFor("BE")).toBe("amazon.com.be");
    expect(amazonStoreFor("GB")).toBe("amazon.co.uk");
    expect(amazonStoreFor("US")).toBe("amazon.com");
  });

  it("uses a nearby store for countries without one, and amazon.com otherwise", () => {
    expect(amazonStoreFor("AT")).toBe("amazon.de");
    expect(amazonStoreFor("DK")).toBe("amazon.de");
    expect(amazonStoreFor("PT")).toBe("amazon.es");
    expect(amazonStoreFor("KE")).toBe("amazon.com");
    expect(amazonStoreFor(null)).toBe("amazon.com");
    expect(amazonStoreFor("")).toBe("amazon.com");
  });

  it("builds the book's address", () => {
    expect(amazonBookUrl("B0HP6MWFDB", "IT")).toBe("https://www.amazon.it/dp/B0HP6MWFDB");
  });
});

describe("the visitor's country from the host's headers", () => {
  it("reads Netlify's geolocation header, plain or base64", () => {
    const json = JSON.stringify({ city: "Brussels", country: { code: "BE", name: "Belgium" } });
    expect(countryFromHeaders(new Headers({ "x-nf-geo": json }))).toBe("BE");
    expect(countryFromHeaders(new Headers({ "x-nf-geo": Buffer.from(json).toString("base64") }))).toBe("BE");
  });

  it("falls back to other hosts' headers and ignores placeholders", () => {
    expect(countryFromHeaders(new Headers({ "x-country": "de" }))).toBe("DE");
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(countryFromHeaders(new Headers())).toBeNull();
  });
});
