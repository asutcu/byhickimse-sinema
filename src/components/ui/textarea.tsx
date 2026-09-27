import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[72px] w-full rounded-[11px] border border-border bg-surface px-3.5 py-2.5 text-[13px] text-foreground placeholder:text-muted-2",
        "shadow-[0_1px_2px_rgba(15,40,90,0.05)] hover:border-border-strong",
        "focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/12 resize-y leading-relaxed",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-2",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
