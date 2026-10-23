import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { mysqlCharsets, type MysqlCharsets } from "@/shared/api";

/** Which MySQL dialog is open, and for what. */
export type MysqlDialog =
  | { kind: "create-db" }
  | { kind: "drop-db"; database: string }
  | { kind: "rename-table"; database: string; table: string };

/** Runs `work`, holding the dialog busy and showing its error inline. */
function useSubmit(on_done: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      on_done();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, submit };
}

function Shell({
  open,
  title,
  busy,
  error,
  confirm_label,
  destructive = false,
  confirm_disabled = false,
  on_cancel,
  on_confirm,
  children,
}: {
  open: boolean;
  title: React.ReactNode;
  busy: boolean;
  error: string | null;
  confirm_label: string;
  destructive?: boolean;
  confirm_disabled?: boolean;
  on_cancel: () => void;
  on_confirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) on_cancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {children}
          {error && (
            <p className="wrap-break-words text-destructive text-small font-mono">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={on_cancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant={destructive ? "destructive" : "default"}
            disabled={busy || confirm_disabled}
            onClick={on_confirm}
          >
            {busy ? "Working…" : confirm_label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Picker({
  label,
  value,
  options,
  none_label,
  disabled,
  on_change,
}: {
  label: string;
  value: string;
  options: string[];
  none_label: string;
  disabled?: boolean;
  on_change: (v: string) => void;
}) {
  return (
    <label className="text-small flex flex-col gap-1">
      <span className="text-muted-foreground font-medium">{label}</span>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(v) => on_change(v ?? "")}
      >
        <SelectTrigger className="text-body h-8 w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="">{none_label}</SelectItem>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}

/** New database with an optional charset and collation (spec 0025 AC-20).
 *  Left empty, the server's defaults apply. */
function CreateDatabaseDialog({
  conn_id,
  on_cancel,
  on_create,
}: {
  conn_id: string;
  on_cancel: () => void;
  on_create: (
    name: string,
    charset: string,
    collation: string,
  ) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [charset, setCharset] = useState("");
  const [collation, setCollation] = useState("");
  const [lists, setLists] = useState<MysqlCharsets | null>(null);
  const { busy, error, setError, submit } = useSubmit(on_cancel);
  useEffect(() => {
    let cancelled = false;
    mysqlCharsets(conn_id).then(
      (l) => !cancelled && setLists(l),
      () => {
        /* the pickers stay at the server defaults */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [conn_id]);
  const collations = (lists?.collations ?? [])
    .filter((c) => !charset || c.charset === charset)
    .map((c) => c.name);
  const confirm = () => {
    if (!name.trim()) {
      setError("Enter a name for the new database.");
      return;
    }
    void submit(() => on_create(name.trim(), charset, collation));
  };
  return (
    <Shell
      open
      title="Create database"
      busy={busy}
      error={error}
      confirm_label="Create"
      on_cancel={on_cancel}
      on_confirm={confirm}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="database name"
        aria-label="Database name"
        onKeyDown={(e) => {
          if (e.key === "Enter") confirm();
        }}
      />
      <Picker
        label="Charset"
        value={charset}
        options={(lists?.charsets ?? []).map((c) => c.name)}
        none_label={`Server default${lists?.default_charset ? ` (${lists.default_charset})` : ""}`}
        disabled={!lists}
        on_change={(v) => {
          setCharset(v);
          setCollation("");
        }}
      />
      <Picker
        label="Collation"
        value={collation}
        options={collations}
        none_label={
          charset
            ? `Default for ${charset}`
            : `Server default${lists?.default_collation ? ` (${lists.default_collation})` : ""}`
        }
        disabled={!lists}
        on_change={setCollation}
      />
    </Shell>
  );
}

/** Drop a database only once its name is typed back (spec 0025 AC-7). */
function DropDatabaseDialog({
  database,
  on_cancel,
  on_drop,
}: {
  database: string;
  on_cancel: () => void;
  on_drop: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const { busy, error, submit } = useSubmit(on_cancel);
  const matches = typed === database;
  return (
    <Shell
      open
      title="Drop database"
      busy={busy}
      error={error}
      confirm_label="Drop"
      destructive
      confirm_disabled={!matches}
      on_cancel={on_cancel}
      on_confirm={() => void submit(on_drop)}
    >
      <p className="text-muted-foreground text-body">
        This permanently drops{" "}
        <span className="text-foreground font-mono">{database}</span> and every
        table, view and routine in it. Type its name to confirm.
      </p>
      <Input
        autoFocus
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={database}
        aria-label="Type the database name to confirm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches) void submit(on_drop);
        }}
      />
    </Shell>
  );
}

function RenameTableDialog({
  table,
  on_cancel,
  on_rename,
}: {
  table: string;
  on_cancel: () => void;
  on_rename: (to: string) => Promise<void>;
}) {
  const [name, setName] = useState(table);
  const { busy, error, setError, submit } = useSubmit(on_cancel);
  const confirm = () => {
    const to = name.trim();
    if (!to || to === table) {
      setError("Enter a new name for the table.");
      return;
    }
    void submit(() => on_rename(to));
  };
  return (
    <Shell
      open
      title={
        <>
          Rename <span className="font-mono">{table}</span>
        </>
      }
      busy={busy}
      error={error}
      confirm_label="Rename"
      on_cancel={on_cancel}
      on_confirm={confirm}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="New table name"
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirm();
        }}
      />
    </Shell>
  );
}

/** The one MySQL dialog open right now, if any. Each mounts fresh, so its
 *  fields start empty every time. */
export function MysqlDialogs({
  conn_id,
  dialog,
  on_close,
  on_create_database,
  on_drop_database,
  on_rename_table,
}: {
  conn_id: string;
  dialog: MysqlDialog | null;
  on_close: () => void;
  on_create_database: (
    name: string,
    charset: string,
    collation: string,
  ) => Promise<void>;
  on_drop_database: (database: string) => Promise<void>;
  on_rename_table: (
    database: string,
    table: string,
    to: string,
  ) => Promise<void>;
}) {
  if (!dialog) return null;
  switch (dialog.kind) {
    case "create-db":
      return (
        <CreateDatabaseDialog
          conn_id={conn_id}
          on_cancel={on_close}
          on_create={on_create_database}
        />
      );
    case "drop-db":
      return (
        <DropDatabaseDialog
          database={dialog.database}
          on_cancel={on_close}
          on_drop={() => on_drop_database(dialog.database)}
        />
      );
    case "rename-table":
      return (
        <RenameTableDialog
          table={dialog.table}
          on_cancel={on_close}
          on_rename={(to) => on_rename_table(dialog.database, dialog.table, to)}
        />
      );
  }
}
