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

// Stand-in when a channel's provider env var is unset in a deployment: every
// send fails with the reason, so the alert retries and records why instead of
// being marked "sent" by a mock that never delivers anything.
export function createUnconfiguredProvider(channel, envVar) {
  const error = `${channel} delivery isn't configured — set ${envVar}.`;
  return {
    name: `unconfigured-${channel}`,
    async send() { return { ok: false, error, provider: `unconfigured-${channel}` }; },
  };
}
