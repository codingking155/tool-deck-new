// Choose email/WhatsApp providers from env. The mock must be asked for
// explicitly (EMAIL_PROVIDER=mock): an unset variable means delivery isn't set
// up, so sends fail visibly instead of a mock marking alerts "sent".
import {
  createMockEmailProvider, createMockWhatsappProvider, createUnconfiguredProvider,
} from "../../../shared/priceAlertsCore/providersMock.mjs";
import { createResendProvider } from "./email/resend.ts";
import { createMetaWhatsappProvider } from "./whatsapp/meta.ts";

export function getEmailProvider() {
  const v = Deno.env.get("EMAIL_PROVIDER");
  if (v === "resend") return createResendProvider();
  if (v === "mock") return createMockEmailProvider();
  return createUnconfiguredProvider("Email", "EMAIL_PROVIDER");
}

export function getWhatsappProvider() {
  const v = Deno.env.get("WHATSAPP_PROVIDER");
  if (v === "meta") return createMetaWhatsappProvider();
  if (v === "mock") return createMockWhatsappProvider();
  return createUnconfiguredProvider("WhatsApp", "WHATSAPP_PROVIDER");
}
