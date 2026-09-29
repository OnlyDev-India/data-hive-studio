import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTheme, type ThemeMode } from "@/shared/theme/theme";
import { listAccents, type AccentId } from "@/shared/theme/accent";
import { listFonts, type FontId } from "@/shared/theme/font";
import { listCornerStyles, type CornerStyleId } from "@/shared/theme/corners";

const THEMES: {
  id: ThemeMode;
  label: string;
  icon: typeof Sun;
}[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "Auto", icon: Monitor },
];

/** Fixed percent stops for the Scaling row — a handful of round numbers,
 *  not a free-form input, matching the Theme/Accent/Font rows' own
 *  pick-one-of-a-few pattern. */
const SCALES: { percent: number; label: string }[] = [
  { percent: 90, label: "Small" },
  { percent: 100, label: "Default" },
  { percent: 110, label: "Large" },
  { percent: 125, label: "Larger" },
  { percent: 150, label: "Largest" },
];

/** macOS-style appearance page: a light/dark/auto theme picker with preview
 *  swatches that reflect the selected mode. */
export function AppearanceSection() {
  const { mode, setMode, dark, accent, font, scale, cornerStyle } = useTheme();

  return (
    <div className="flex h-full flex-col gap-6">
      <header>
        <h2 className="text-heading font-semibold">Appearance</h2>
        <p className="text-muted-foreground text-body mt-0.5">
          Choose how the app looks.
        </p>
      </header>

      {/* Bento-style grid: Theme gets the full width (its preview swatches
          need the room), the rest pair up two-to-a-row instead of every
          setting stacking as its own full-width strip. */}
      <div className="grid grid-cols-2 gap-3">
        <SettingCard label="Theme" className="col-span-2" horizontal>
          <div className="flex gap-3">
            {THEMES.map(({ id, label, icon: Icon }) => {
              const active = mode === id;
              return (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={cn(
                    "rounded-surface text-body flex flex-col items-center gap-1 border p-2 transition-colors",
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
        </SettingCard>

        <SettingCard label="Accent color">
          <div className="flex flex-wrap gap-2">
            {listAccents().map((acc) => (
              <AccentSwatch
                key={acc.id}
                id={acc.id}
                name={acc.name}
                color={dark ? acc.swatch.dark : acc.swatch.light}
                active={accent === acc.id}
              />
            ))}
          </div>
        </SettingCard>

        <SettingCard label="Corners">
          <div className="flex flex-wrap gap-2">
            {listCornerStyles().map((c) => (
              <CornerSwatch
                key={c.id}
                id={c.id}
                name={c.name}
                radius={c.surface}
                active={cornerStyle === c.id}
              />
            ))}
          </div>
        </SettingCard>

        <SettingCard label="Font">
          <div className="flex flex-wrap gap-2">
            {listFonts().map((f) => (
              <FontSwatch
                key={f.id}
                id={f.id}
                stack={f.stack}
                name={f.name}
                active={font === f.id}
              />
            ))}
          </div>
        </SettingCard>

        <SettingCard label="Scaling">
          <div className="flex flex-wrap gap-2">
            {SCALES.map((s) => (
              <ScaleSwatch
                key={s.percent}
                percent={s.percent}
                label={s.label}
                active={scale === s.percent}
              />
            ))}
          </div>
        </SettingCard>
      </div>
    </div>
  );
}

/** A bento-grid settings card. Default is label-on-top, options-below — fits
 *  comfortably at half width so two cards can share a row. `horizontal`
 *  switches to label-left, options-right instead, for a card that already
 *  spans the full row and has the room to spare. */
function SettingCard({
  label,
  className,
  horizontal,
  children,
}: {
  label: string;
  className?: string;
  horizontal?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        // `bg-card` is identical to `bg-background` in light mode here (both
        // pure white) — `bg-muted/40` stays visibly distinct from the page
        // in both themes instead.
        "bg-muted/40 rounded-dialog border p-4",
        horizontal
          ? "flex items-start justify-between gap-6"
          : "flex flex-col gap-2.5",
        className,
      )}
    >
      <span className="text-body font-medium">{label}</span>
      {children}
    </div>
  );
}

/** One theme drawn with its real tokens. The `.light` / `.dark` class
 *  redeclares that theme (and the current accent) for this subtree, so no
 *  `dark:` variant may appear inside. */
function PreviewPane({ scope }: { scope: "light" | "dark" }) {
  return (
    <div className={cn(scope, "bg-chrome flex flex-1 flex-col gap-0.5 p-1")}>
      <div className="flex h-1.5 items-center gap-0.5 px-0.5">
        <span className="bg-muted-foreground h-0.5 w-0.5 rounded-full" />
        <span className="bg-muted-foreground h-0.5 w-0.5 rounded-full" />
        <span className="bg-primary rounded-inset ml-auto h-0.5 w-1" />
      </div>
      <div className="bg-background rounded-inset flex-1 border" />
    </div>
  );
}

/** A mini window preview used by the theme picker. */
function ThemeSwatch({ mode, active }: { mode: ThemeMode; active: boolean }) {
  const scopes = mode === "system" ? (["dark", "light"] as const) : [mode];
  return (
    <div
      className={cn(
        "rounded-control flex h-11 w-18 overflow-hidden border transition-shadow",
        active && "border-primary shadow-sm",
      )}
    >
      {scopes.map((s) => (
        <PreviewPane key={s} scope={s} />
      ))}
    </div>
  );
}

function AccentSwatch({
  id,
  name,
  color,
  active,
}: {
  id: AccentId;
  name: string;
  color: string;
  active: boolean;
}) {
  const { setAccent } = useTheme();
  return (
    <button
      aria-label={`Accent ${name}`}
      aria-pressed={active}
      onClick={() => setAccent(id)}
      className={cn(
        "flex size-6 items-center justify-center rounded-full border transition-transform hover:scale-110",
        active
          ? "border-foreground ring-primary/30 ring-2 ring-offset-1"
          : "border-border hover:border-foreground/40",
      )}
      style={{ backgroundColor: color }}
      title={name}
    />
  );
}

function FontSwatch({
  id,
  stack,
  name,
  active,
}: {
  id: FontId;
  stack: string;
  name: string;
  active: boolean;
}) {
  const { setFont } = useTheme();
  return (
    <button
      aria-label={`Font ${name}`}
      aria-pressed={active}
      onClick={() => setFont(id)}
      title={name}
      className={cn(
        "rounded-surface text-body flex flex-col items-center gap-1 border p-2 transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "text-muted-foreground hover:border-foreground/20 hover:bg-muted/40",
      )}
    >
      <span className="text-title leading-none" style={{ fontFamily: stack }}>
        Ag
      </span>
      <span className="text-caption font-medium">{name}</span>
    </button>
  );
}

function CornerSwatch({
  id,
  name,
  radius,
  active,
}: {
  id: CornerStyleId;
  name: string;
  radius: string;
  active: boolean;
}) {
  const { setCornerStyle } = useTheme();
  return (
    <button
      aria-label={`Corners ${name}`}
      aria-pressed={active}
      onClick={() => setCornerStyle(id)}
      title={name}
      className={cn(
        "rounded-surface text-body flex flex-col items-center gap-1 border p-2 transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "text-muted-foreground hover:border-foreground/20 hover:bg-muted/40",
      )}
    >
      <span
        className="border-foreground/50 block size-5 border-2"
        style={{ borderRadius: radius }}
      />
      <span className="text-caption font-medium">{name}</span>
    </button>
  );
}

function ScaleSwatch({
  percent,
  label,
  active,
}: {
  percent: number;
  label: string;
  active: boolean;
}) {
  const { setScale } = useTheme();
  return (
    <button
      aria-label={`Scale ${label} (${percent}%)`}
      aria-pressed={active}
      onClick={() => setScale(percent)}
      title={`${label} — ${percent}%`}
      className={cn(
        "rounded-surface text-body flex flex-col items-center gap-1 border p-2 transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "text-muted-foreground hover:border-foreground/20 hover:bg-muted/40",
      )}
    >
      <span
        className="leading-none"
        style={{ fontSize: `${13 * (percent / 100)}px` }}
      >
        Aa
      </span>
      <span className="text-caption font-medium">{percent}%</span>
    </button>
  );
}
