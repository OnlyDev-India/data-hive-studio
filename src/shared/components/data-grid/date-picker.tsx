import { CalendarIcon, ClockIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

interface DatePickerProps {
  value: string | null;
  withTime?: boolean;
  onChange: (value: string | null) => void;
  className?: string;
  /** Open the calendar automatically on mount. */
  autoOpen?: boolean;
  /** Write ISO 8601 (`2026-08-20T02:08:00.000Z`, as Mongo dates read) instead
   *  of the SQLite style `YYYY-MM-DD HH:MM:SS`. */
  iso?: boolean;
}

/** A calendar popover that edits a `date` or `datetime` cell value and keeps
 * the value in the SQLite-friendly format (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS). */
export function DatePicker({
  value,
  withTime,
  onChange,
  className,
  autoOpen,
  iso,
}: DatePickerProps) {
  const [open, setOpen] = useState(autoOpen ?? false);
  const parsed = parseDate(value);
  const selected: Date | undefined = parsed?.valid ? parsed.date : undefined;
  const hh = parsed?.valid ? parsed.hh : 0;
  const mm = parsed?.valid ? parsed.mm : 0;
  // Seconds and milliseconds the picker has no control for are kept, so
  // changing the day or the hour does not wipe them.
  const tail = value
    ? /[T ]\d{2}:\d{2}:(\d{2})(?:\.(\d{1,3}))?/.exec(value)
    : null;
  const sec = tail?.[1] ?? "00";
  const ms = (tail?.[2] ?? "").padEnd(3, "0") || "000";

  const write = (date: Date, h: number, m: number) =>
    onChange(
      iso
        ? `${formatToDb(date)}T${pad(h)}:${pad(m)}:${sec}.${ms}Z`
        : formatToDb(date, true, `${h}:${pad(m)}`),
    );

  const commit = (date: Date | undefined) => {
    if (!date) return onChange(null);
    if (withTime) write(date, hh, mm);
    else onChange(formatToDb(date));
  };

  const on_time = (h: number, m: number) => write(selected ?? new Date(), h, m);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "hover:text-accent-foreground h-7 w-full justify-start border-transparent bg-transparent px-1.5 text-left text-sm font-normal hover:bg-transparent",
              !value && "text-muted-foreground",
              className,
            )}
          >
            {value ? (
              <>
                <CalendarIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {displayValue(value, withTime)}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="text-muted-foreground hover:text-foreground ml-auto shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      onChange(null);
                    }
                  }}
                >
                  <XIcon className="size-3.5" />
                </span>
              </>
            ) : (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <CalendarIcon className="size-3.5 shrink-0" />
                {withTime ? "Pick date & time…" : "Pick a date…"}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex gap-2 p-2">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            selected={selected}
            // Open on the month of the cell's current date, not today's.
            defaultMonth={selected}
            onSelect={(d) => commit(d)}
            autoFocus
          />
          {withTime && (
            <div className="border-border flex flex-col items-center gap-2 border-l pl-3">
              <ClockIcon className="text-muted-foreground size-4 shrink-0" />
              <div className="flex min-h-0 flex-1 gap-1">
                <TimeColumn
                  label="Hour"
                  count={24}
                  value={hh}
                  onPick={(h) => on_time(h, mm)}
                />
                <TimeColumn
                  label="Minute"
                  count={60}
                  value={mm}
                  onPick={(m) => on_time(hh, m)}
                />
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One scrolling column of numbers (hours or minutes), the current one
 *  highlighted and brought to the middle when the picker opens. */
function TimeColumn({
  label,
  count,
  value,
  onPick,
}: {
  label: string;
  count: number;
  value: number;
  onPick: (n: number) => void;
}) {
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "center" });
    // Only on mount: picking a number must not make the list jump.
  }, []);
  return (
    <div
      role="listbox"
      aria-label={label}
      className="flex max-h-64 w-12 [scrollbar-width:none] flex-col gap-0.5 overflow-y-auto [&::-webkit-scrollbar]:hidden"
    >
      {Array.from({ length: count }, (_, n) => (
        <button
          key={n}
          ref={n === value ? current : undefined}
          type="button"
          role="option"
          aria-selected={n === value}
          className={cn(
            "hover:bg-accent shrink-0 cursor-pointer rounded-md py-1 text-center text-sm tabular-nums",
            n === value &&
              "bg-primary text-primary-foreground hover:bg-primary",
          )}
          onClick={() => onPick(n)}
        >
          {pad(n)}
        </button>
      ))}
    </div>
  );
}

/** SQLite stores dates as "YYYY-MM-DD" and datetimes as "YYYY-MM-DD HH:MM:SS".
 * Normalize both to a JS Date for the calendar, tolerating a `T` separator. */
function parseDate(
  value: string | null,
): { date: Date; valid: boolean; hh: number; mm: number } | null {
  if (!value) return null;
  const s = value.trim().replaceAll("T", " ");
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h ?? 0),
    Number(mi ?? 0),
    0,
  );
  const valid =
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(mo) - 1 &&
    date.getDate() === Number(d);
  return { date, valid, hh: Number(h ?? 0), mm: Number(mi ?? 0) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatToDb(
  date: Date | undefined,
  withTime?: boolean,
  time?: string,
): string {
  if (!date) return "";
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (!withTime) return base;
  let hh = date.getHours();
  let mm = date.getMinutes();
  const m = time ? /^(\d{1,2}):(\d{2})$/.exec(time.trim()) : null;
  if (m) {
    hh = Math.min(23, Number(m[1]));
    mm = Math.min(59, Number(m[2]));
  }
  return `${base} ${pad(hh)}:${pad(mm)}:00`;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function displayValue(value: string, withTime?: boolean): string {
  const parsed = parseDate(value);
  if (!parsed?.valid) return value;
  const date = DATE_FMT.format(parsed.date);
  if (!withTime) return date;
  return `${date} ${pad(parsed.date.getHours())}:${pad(parsed.date.getMinutes())}`;
}
