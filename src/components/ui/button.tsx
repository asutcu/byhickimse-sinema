"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[11px] text-[13px] font-semibold select-none cursor-pointer",
    "tracking-[-0.01em] focus-ring active:translate-y-px [&_svg]:shrink-0",
    "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:active:translate-y-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "brand-gradient text-white",
        secondary:
          "border border-primary/15 bg-primary-soft text-primary-strong hover:border-primary/30 hover:bg-[#dfe9ff]",
        outline:
          "border border-border bg-surface text-foreground shadow-[0_1px_2px_rgba(15,40,90,0.06)] hover:border-primary/35 hover:text-primary-strong hover:bg-[#f6f9ff]",
        ghost: "text-muted hover:text-primary-strong hover:bg-primary-soft",
        danger: "border border-danger/20 bg-danger-soft text-danger hover:border-danger/40 hover:bg-[#fde6e6]",
        success: "border border-success/20 bg-success-soft text-success hover:border-success/40 hover:bg-[#d9f3e7]",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-[12px] rounded-[10px]",
        lg: "h-11 px-6 text-[14px] rounded-[12px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export { buttonVariants };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
);
Button.displayName = "Button";
