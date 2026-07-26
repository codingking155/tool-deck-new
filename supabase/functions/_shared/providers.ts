// Choose email/WhatsApp providers from env. Defaults to mock so dev/test never
// sends real messages by accident.
import { createMockEmailProvider, createMockWhatsappProvider } from "../../../shared/priceAlertsCore/providersMock.mjs";
import { createResendProvider } from "./email/resend.ts";
import { createMetaWhatsappProvider } from "./whatsapp/meta.ts";

export function getEmailProvider() {
  return (Deno.env.get("EMAIL_PROVIDER") ?? "mock") === "resend"
    ? createResendProvider()
    : createMockEmailProvider();
}

export function getWhatsappProvider() {
  return (Deno.env.get("WHATSAPP_PROVIDER") ?? "mock") === "meta"
    ? createMetaWhatsappProvider()
    : createMockWhatsappProvider();
}
