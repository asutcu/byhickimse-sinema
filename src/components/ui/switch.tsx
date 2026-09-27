"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-surface-4",
      "shadow-[inset_0_1px_2px_rgba(15,40,90,0.08)] transition-colors",
      "data-[state=checked]:border-primary-strong data-[state=checked]:bg-gradient-to-b data-[state=checked]:from-[#3b82f6] data-[state=checked]:to-[#1d4ed8] data-[state=checked]:shadow-[0_6px_14px_-8px_rgba(37,99,235,0.8)]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(15,40,90,0.25)] ring-0 transition-transform",
        "data-[state=checked]:translate-x-[19px] data-[state=unchecked]:translate-x-px"
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
