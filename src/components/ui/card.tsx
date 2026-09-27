import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fare ile uzerine gelindiginde hafifce yukselir (tiklanabilir kartlar icin). */
  interactive?: boolean;
  /** Zemine gomulu, daha sakin yuzey (ic ice kart / yardim blogu). */
  muted?: boolean;
}

export function Card({ className, interactive, muted, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-border",
        muted ? "bg-surface-2" : "bg-surface",
        "card-shadow",
        interactive && "cursor-pointer card-lift",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 px-5 pt-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[14.5px] font-bold tracking-[-0.015em] leading-snug text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[12px] text-muted leading-relaxed", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5 pt-2", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2 px-5 pb-5 pt-0", className)} {...props} />;
}
