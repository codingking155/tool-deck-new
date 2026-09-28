// Amazon marketplaces the tracker understands, keyed by retail domain.
//
// paapiHost/region: Product Advertising API 5.0 endpoint + SigV4 region for
// that locale. keepaDomain: Keepa's numeric domain id (history provider).
// A marketplace without a keepaDomain simply gets no imported history.

export const AMAZON_MARKETPLACES = {
  "amazon.in":     { currency: "INR", paapiHost: "webservices.amazon.in",     region: "eu-west-1", keepaDomain: 10 },
  "amazon.com":    { currency: "USD", paapiHost: "webservices.amazon.com",    region: "us-east-1", keepaDomain: 1 },
  "amazon.co.uk":  { currency: "GBP", paapiHost: "webservices.amazon.co.uk",  region: "eu-west-1", keepaDomain: 2 },
  "amazon.de":     { currency: "EUR", paapiHost: "webservices.amazon.de",     region: "eu-west-1", keepaDomain: 3 },
  "amazon.fr":     { currency: "EUR", paapiHost: "webservices.amazon.fr",     region: "eu-west-1", keepaDomain: 4 },
  "amazon.co.jp":  { currency: "JPY", paapiHost: "webservices.amazon.co.jp",  region: "us-west-2", keepaDomain: 5 },
  "amazon.ca":     { currency: "CAD", paapiHost: "webservices.amazon.ca",     region: "us-east-1", keepaDomain: 6 },
  "amazon.it":     { currency: "EUR", paapiHost: "webservices.amazon.it",     region: "eu-west-1", keepaDomain: 8 },
  "amazon.es":     { currency: "EUR", paapiHost: "webservices.amazon.es",     region: "eu-west-1", keepaDomain: 9 },
  "amazon.com.mx": { currency: "MXN", paapiHost: "webservices.amazon.com.mx", region: "us-east-1", keepaDomain: 11 },
  "amazon.com.br": { currency: "BRL", paapiHost: "webservices.amazon.com.br", region: "us-east-1", keepaDomain: 12 },
  "amazon.com.au": { currency: "AUD", paapiHost: "webservices.amazon.com.au", region: "us-west-2" },
  "amazon.ae":     { currency: "AED", paapiHost: "webservices.amazon.ae",     region: "eu-west-1" },
  "amazon.sg":     { currency: "SGD", paapiHost: "webservices.amazon.sg",     region: "us-west-2" },
  "amazon.nl":     { currency: "EUR", paapiHost: "webservices.amazon.nl",     region: "eu-west-1" },
  "amazon.se":     { currency: "SEK", paapiHost: "webservices.amazon.se",     region: "eu-west-1" },
  "amazon.pl":     { currency: "PLN", paapiHost: "webservices.amazon.pl",     region: "eu-west-1" },
  "amazon.sa":     { currency: "SAR", paapiHost: "webservices.amazon.sa",     region: "eu-west-1" },
  "amazon.com.tr": { currency: "TRY", paapiHost: "webservices.amazon.com.tr", region: "eu-west-1" },
  "amazon.eg":     { currency: "EGP", paapiHost: "webservices.amazon.eg",     region: "eu-west-1" },
};

export function marketplaceInfo(marketplace) {
  return AMAZON_MARKETPLACES[marketplace] || null;
}
