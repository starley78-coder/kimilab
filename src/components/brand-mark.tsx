import { useId } from "react";

import { cn } from "@/lib/utils";

/** Kimi Lab mark: a crescent moon with a small "lab" signal spark. Theme-aware. */
export function BrandMark({ className }: { className?: string }) {
  const id = useId();
  const maskId = `kimi-mask-${id.replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8 shrink-0", className)} aria-hidden="true">
      <defs>
        <mask id={maskId}>
          <rect width="64" height="64" fill="white" />
          <circle cx="40" cy="25" r="14.5" fill="black" />
        </mask>
      </defs>
      <rect width="64" height="64" rx="17" className="fill-primary" />
      <circle
        cx="29.5"
        cy="34"
        r="17.5"
        className="fill-primary-foreground"
        mask={`url(#${maskId})`}
      />
      <circle cx="44.5" cy="20.5" r="4.6" className="fill-signal" />
    </svg>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark className="size-7" />
      <span className="text-[0.95rem] font-semibold tracking-tight">
        Kimi <span className="text-muted-foreground">Lab</span>
      </span>
    </span>
  );
}
