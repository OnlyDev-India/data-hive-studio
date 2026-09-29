import { useId, type CSSProperties } from "react";
import { cn } from "@/shared/lib/utils";

export type BrandMarkMotion = "pulse" | "enter" | "none";

const BANDS = [
  "M6 12.5A22 7.5 0 0 1 50 12.5A22 7.5 0 0 1 6 12.5ZM6 14.3A22 7.5 0 0 0 50 14.3V25.5A22 7.5 0 0 1 6 25.5Z",
  "M6 27.3A22 7.5 0 0 0 50 27.3V38.5A22 7.5 0 0 1 6 38.5Z",
  "M6 40.3A22 7.5 0 0 0 50 40.3V51.5A22 7.5 0 0 1 6 51.5Z",
];

const LENS = { cx: 42, cy: 42.4, r: 11.5 };
const HANDLE = "M50.1 50.5L56.5 56.9";

const PULSE_DELAYS = ["0s", "0.2s", "0.4s"];
const ENTER_DELAYS = ["0ms", "60ms", "120ms"];
const ENTER_LENS_DELAY = "180ms";
const ENTER = "animate-mark-enter motion-reduce:animate-none";

const delay = (animationDelay: string): CSSProperties => ({ animationDelay });

/** The app icon's stacked database and magnifier, drawn in theme colors. */
export function BrandMark({
  motion,
  className,
}: {
  motion: BrandMarkMotion;
  className?: string;
}) {
  const maskId = useId();

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
      data-testid="brand-mark"
      className={className}
    >
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="64"
        height="64"
      >
        <rect width="64" height="64" fill="white" />
        <circle {...LENS} fill="black" stroke="black" strokeWidth="6.6" />
        <path d={HANDLE} stroke="black" strokeWidth="7" strokeLinecap="round" />
      </mask>
      <g mask={`url(#${maskId})`}>
        {BANDS.map((d, i) => (
          <path
            key={i}
            d={d}
            data-band
            className={cn(
              "fill-foreground",
              motion === "pulse" && "animate-mark-pulse",
              motion === "enter" && ENTER,
            )}
            style={
              motion === "pulse"
                ? delay(PULSE_DELAYS[i])
                : motion === "enter"
                  ? delay(ENTER_DELAYS[i])
                  : undefined
            }
            data-essential-motion={motion === "pulse" ? "" : undefined}
          />
        ))}
      </g>
      <g
        data-lens
        className={cn("stroke-primary fill-none", motion === "enter" && ENTER)}
        style={motion === "enter" ? delay(ENTER_LENS_DELAY) : undefined}
        strokeLinecap="round"
      >
        <circle {...LENS} strokeWidth="3" />
        <path d={HANDLE} strokeWidth="3.5" />
      </g>
    </svg>
  );
}
