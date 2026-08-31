import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTheme, type ThemeMode } from "@/shared/theme/theme";
import { listAccents, type AccentId } from "@/shared/theme/accent";

const THEMES: {
  id: ThemeMode;
  label: string;
  icon: typeof Sun;
}[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "Auto", icon: Monitor },
];

/** macOS-style appearance page: a light/dark/auto theme picker with preview
 *  swatches that reflect the selected mode. */
export function AppearanceSection() {
  const { mode, setMode, accent } = useTheme();

  return (
    <div className="flex h-full flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Choose how the app looks.
        </p>
      </header>

      {/* macOS-style settings rows: label column on the left, options on the
          right. */}
      <div className="divide-y divide-border rounded-xl border">
        <SettingRow label="Theme">
          <div className="flex justify-end gap-3">
            {THEMES.map(({ id, label, icon: Icon }) => {
              const active = mode === id;
              return (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-2 text-sm transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:border-foreground/20 hover:bg-muted/40",
                  )}
                >
                  <ThemeSwatch mode={id} active={active} />
                  <span className="flex items-center gap-1 font-medium">
                    <Icon className="size-3.5" />
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow label="Accent color">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {listAccents().map((acc) => (
              <AccentSwatch
                key={acc.id}
                id={acc.id}
                color={acc.base}
                active={accent === acc.id}
              />
            ))}
          </div>
        </SettingRow>
      </div>
    </div>
  );
}

/** A two-column "label | options" settings row. */
function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-6 px-4 py-3">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

/** A mini window preview used by the theme picker. */
function ThemeSwatch({ mode, active }: { mode: ThemeMode; active: boolean }) {
  const { dark } = useTheme();
  // Show a preview reflecting the RESOLVED value of this option: system folds
  // into the current resolved dark state.
  const previewDark = mode === "system" ? dark : mode === "dark";
  return (
    <div
      className={cn(
        "flex h-11 w-18 flex-col gap-0.5 rounded-md border p-1 transition-shadow",
        active && "border-primary shadow-sm",
      )}
    >
      <div
        className={cn(
          "flex h-1.5 items-center gap-0.5 rounded-sm px-0.5",
          previewDark ? "bg-neutral-700" : "bg-neutral-200",
        )}
      >
        <span
          className={cn(
            "h-0.5 w-0.5 rounded-full",
            previewDark ? "bg-neutral-400" : "bg-neutral-400",
          )}
        />
        <span
          className={cn(
            "h-0.5 w-0.5 rounded-full",
            previewDark ? "bg-neutral-500" : "bg-neutral-400",
          )}
        />
        <span
          className={cn(
            "ml-auto h-0.5 w-1 rounded-sm",
            previewDark ? "bg-neutral-400" : "bg-neutral-300",
          )}
        />
      </div>
      <div
        className={cn(
          "flex-1 rounded-sm",
          previewDark ? "bg-neutral-800" : "bg-white",
        )}
      />
    </div>
  );
}

function AccentSwatch({
  id,
  color,
  active,
}: {
  id: AccentId;
  color: string;
  active: boolean;
}) {
  const { setAccent } = useTheme();
  // Graphite is the default monochrome accent — no accent color stored, so
  // render it as a neutral gray swatch with a diagonal slash.
  const isGraphite = id === "graphite";
  return (
    <button
      aria-label={`Accent ${id}`}
      aria-pressed={active}
      onClick={() => setAccent(id)}
      className={cn(
        "flex size-6 items-center justify-center rounded-full border transition-transform hover:scale-110",
        active
          ? "border-foreground ring-2 ring-primary/30 ring-offset-1"
          : "border-border hover:border-foreground/40",
      )}
      style={isGraphite ? undefined : { backgroundColor: color }}
      title={id}
    >
      {isGraphite && (
        <span
          className="block size-6 rounded-full"
          style={{
            background:
              "repeating-linear-gradient(45deg, transparent 0 3px, currentColor 3px 4px)",
            color: "var(--muted-foreground)",
            opacity: 0.55,
          }}
        />
      )}
    </button>
  );
}
