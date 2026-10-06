"use client";

import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="clipdeck-theme">
      {/* Honour the OS "reduce motion" setting for every Framer Motion animation. */}
      <MotionConfig reducedMotion="user">
        {children}
        <Toaster />
      </MotionConfig>
    </ThemeProvider>
  );
}
