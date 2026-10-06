import { cn } from "@/lib/utils";

export const PRODUCT_NAME = "ClipDeck";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M16 8.5v10.25m0 0-4-4m4 4 4-4M10 23h12"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-[17px]">{PRODUCT_NAME}</span>
    </span>
  );
}
