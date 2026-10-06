"use client";

import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/** Determinate when `value` is a number, indeterminate (animated sweep) when null. */
function Progress({
  className,
  value,
  ...props
}: Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, "value"> & { value: number | null }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      {value == null ? (
        <div className="absolute inset-y-0 w-1/3 animate-[progress-sweep_1.4s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-40" />
      ) : (
        <ProgressPrimitive.Indicator
          className="h-full w-full rounded-full bg-primary transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value))}%)` }}
        />
      )}
    </ProgressPrimitive.Root>
  );
}

export { Progress };
