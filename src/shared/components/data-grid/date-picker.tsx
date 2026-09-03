import { CalendarIcon, ClockIcon, XIcon } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Input } from "@/shared/components/ui/input";
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
}

/** A calendar popover that edits a `date` or `datetime` cell value and keeps
 * the value in the SQLite-friendly format (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS). */
export function DatePicker({
  value,
  withTime,
  onChange,
  className,
  autoOpen,
}: DatePickerProps) {
  const [open, setOpen] = useState(autoOpen ?? false);
  const parsed = parseDate(value);
  const selected: Date | undefined = parsed?.valid ? parsed.date : undefined;
  const [time, setTime] = useState(
    parsed?.valid ? `${pad(parsed.hh)}:${pad(parsed.mm)}` : "",
  );

  const commit = (date: Date | undefined) => {
    const text = formatToDb(date, withTime, time);
    onChange(text || null);
  };

  const on_time = (raw: string) => {
    setTime(raw);
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
    if (m && selected) {
      const hh = Math.min(23, Number(m[1]));
      const mm = Math.min(59, Number(m[2]));
      const copy = new Date(selected.getTime());
      copy.setHours(hh, mm, 0, 0);
      onChange(formatToDb(copy, true));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "bg-background hover:bg-accent hover:text-accent-foreground h-7 w-full justify-start border-transparent px-1.5 text-left text-sm font-normal",
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
            <div className="border-border flex flex-col items-center justify-center gap-2 border-l px-3">
              <ClockIcon className="text-muted-foreground size-4 shrink-0" />
              <Input
                type="time"
                className="h-7 w-auto"
                value={time}
                onChange={(e) => on_time(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
                    if (m) {
                      onChange(formatToDb(selected, true));
                      setOpen(false);
                    }
                  }
                }}
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
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

function displayValue(value: string, withTime?: boolean): string {
  const parsed = parseDate(value);
  if (!parsed?.valid) return value;
  if (!withTime) return format(parsed.date, "MMM d, yyyy");
  return format(parsed.date, "MMM d, yyyy HH:mm");
}
