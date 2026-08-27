import { Moon, Sun } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTheme } from "@/shared/theme/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { dark, toggle } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      className={cn(
        "hover:bg-accent inline-flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors",
        className,
      )}
      onClick={toggle}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
