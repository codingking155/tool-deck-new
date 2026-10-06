import { Clock3, PhoneCall, ShoppingBag, Gauge, Globe, TrendingDown, Braces, LockKeyhole, KeyRound, Sparkles, ImageDown, ShieldAlert, FileStack } from "lucide-react";

/* One consistent line-icon set for the tool tiles (emoji render differently on every OS).
   The emoji in toolsMeta stay for text-only places like the command palette. */
const ICONS = {
  utc: Clock3, phone: PhoneCall, shopifydetector: ShoppingBag, speed: Gauge, ip: Globe,
  price: TrendingDown, json: Braces, ssl: LockKeyhole, password: KeyRound, prompt: Sparkles,
  image: ImageDown, breach: ShieldAlert, pdf: FileStack,
};

export default function ToolIcon({ tool, size = 22 }) {
  const Icon = ICONS[tool.id];
  if (!Icon) return <span className="ticon-emoji">{tool.icon}</span>;
  return <Icon className="ticon" size={size} strokeWidth={1.9} aria-hidden="true" />;
}
