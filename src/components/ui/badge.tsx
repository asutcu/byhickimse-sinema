import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap leading-none tracking-[-0.005em]",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-3 text-muted",
        primary: "border-primary/20 bg-primary-soft text-primary-strong",
        success: "border-success/20 bg-success-soft text-success",
        warning: "border-warning/20 bg-warning-soft text-warning",
        danger: "border-danger/20 bg-danger-soft text-danger",
        info: "border-info/20 bg-info-soft text-info",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

const DOT_COLORS: Record<string, string> = {
  default: "bg-muted-2",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Metnin solunda renkli durum noktasi gosterir. */
  dot?: boolean;
  /** Nokta yanip soner (devam eden islem). */
  pulse?: boolean;
}

export function Badge({ className, variant, dot, pulse, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", DOT_COLORS[variant ?? "default"], pulse && "pulse-dot")} />
      )}
      {children}
    </span>
  );
}
