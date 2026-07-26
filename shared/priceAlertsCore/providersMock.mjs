// In-memory providers for development and tests. `opts.fail` forces failures so
// retry/fallback paths can be exercised.

export function createMockEmailProvider(opts = {}) {
  const sent = [];
  return {
    name: "mock-email",
    sent,
    async send(msg) {
      if (opts.fail) return { ok: false, error: "mock email failure", provider: "mock-email" };
      sent.push(msg);
      return { ok: true, id: "email-" + sent.length, provider: "mock-email" };
    },
  };
}

export function createMockWhatsappProvider(opts = {}) {
  const sent = [];
  return {
    name: "mock-whatsapp",
    sent,
    async send(msg) {
      if (opts.fail) return { ok: false, error: "mock whatsapp failure", provider: "mock-whatsapp" };
      sent.push(msg);
      return { ok: true, id: "wa-" + sent.length, provider: "mock-whatsapp" };
    },
  };
}
