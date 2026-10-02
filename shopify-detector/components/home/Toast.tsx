"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(null), 2000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const node = (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return { show, node };
}
