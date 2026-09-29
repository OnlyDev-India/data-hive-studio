import { BrandMark } from "@/shared/components/brand-mark";

/** Covers the first paint while `runStartupBootstrap` loads saved state and,
 *  on desktop, opens a file the OS handed over. */
export function SplashScreen({ status }: { status?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-background text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-3 select-none"
    >
      <BrandMark motion="pulse" className="size-16" />
      <span className="text-body">{status ?? "Loading"}</span>
    </div>
  );
}
