import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Link2, Pencil } from "lucide-react";
import type { SavedDbKind } from "@/shared/api";
import { Input } from "@/shared/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shared/components/ui/input-group";
import { Button } from "@/shared/components/ui/button";
import { FormRow } from "./form-row";
import { kindItem } from "./kinds";

export const fieldId = (key: string) => `conn-${key}`;

export function describedBy(key: string, error?: string) {
  return error
    ? { "aria-invalid": true, "aria-describedby": `${fieldId(key)}-msg` }
    : {};
}

export function TextRow({
  field,
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  type,
  mono,
}: {
  field: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  hint?: React.ReactNode;
  type?: string;
  mono?: boolean;
}) {
  return (
    <FormRow label={label} htmlFor={fieldId(field)} error={error} hint={hint}>
      <Input
        id={fieldId(field)}
        type={type}
        placeholder={placeholder}
        className={mono ? "font-mono text-xs" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...describedBy(field, error)}
      />
    </FormRow>
  );
}

export function UrlRow({
  placeholder,
  onImport,
}: {
  placeholder: string;
  /** Returns an error message, or null when the form was filled. */
  onImport: (raw: string) => string | null;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    if (!text.trim()) return;
    const msg = onImport(text);
    setError(msg);
    if (!msg) setText("");
  };
  return (
    <FormRow
      label="URL"
      htmlFor={fieldId("url")}
      error={error ?? undefined}
      hint="Optional. Paste a connection URL to fill the form."
    >
      <InputGroup>
        <InputGroupInput
          id={fieldId("url")}
          className="font-mono text-xs"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          {...describedBy("url", error ?? undefined)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            title="Fill the form from this URL"
            aria-label="Fill the form from this URL"
            disabled={!text.trim()}
            onClick={run}
          >
            <Link2 />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </FormRow>
  );
}

export function TypeRow({
  kind,
  onChange,
}: {
  kind: SavedDbKind;
  onChange: () => void;
}) {
  const item = kindItem(kind);
  return (
    <FormRow label="Type">
      <div className="flex h-7 items-center gap-2 text-sm">
        <item.icon aria-hidden className="size-4 shrink-0" />
        <span className="font-medium">{item.label}</span>
        <Button
          variant="ghost"
          size="iconXs"
          onClick={onChange}
          title="Change database type"
          aria-label="Change database type"
        >
          <Pencil className="size-3" />
        </Button>
      </div>
    </FormRow>
  );
}

export function HostPortRow({
  host,
  port,
  onHost,
  onPort,
  hostPlaceholder,
  hidePort = false,
  portError,
  below,
}: {
  host: string;
  port: string;
  onHost: (v: string) => void;
  onPort: (v: string) => void;
  hostPlaceholder: string;
  /** Mongo SRV looks up the ports itself. */
  hidePort?: boolean;
  portError?: string;
  below?: React.ReactNode;
}) {
  return (
    <FormRow label="Host" htmlFor={fieldId("host")} error={portError}>
      <div className="flex gap-2">
        <Input
          id={fieldId("host")}
          className="min-w-0 flex-1"
          placeholder={hostPlaceholder}
          value={host}
          onChange={(e) => onHost(e.target.value)}
        />
        {!hidePort && (
          <Input
            id={fieldId("port")}
            aria-label="Port"
            inputMode="numeric"
            placeholder="port"
            className="w-20"
            value={port}
            onChange={(e) => onPort(e.target.value)}
            {...describedBy("host", portError)}
          />
        )}
      </div>
      {below}
    </FormRow>
  );
}

export function PasswordRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <FormRow label="Password" htmlFor={fieldId("password")}>
      <InputGroup>
        <InputGroupInput
          id={fieldId("password")}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label={shown ? "Hide password" : "Show password"}
            title={shown ? "Hide password" : "Show password"}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </FormRow>
  );
}

/** Whole number inputs for the Advanced tab. */
export function NumberRows<K extends string>({
  rows,
  values,
  onChange,
  errors,
}: {
  rows: readonly {
    key: K;
    label: string;
    placeholder: string;
    hint?: string;
  }[];
  values: NoInfer<Record<K, string>>;
  onChange: (key: K, v: string) => void;
  errors: (field: string) => string | undefined;
}) {
  return (
    <>
      {rows.map((r) => (
        <FormRow
          key={r.key}
          label={r.label}
          htmlFor={fieldId(r.key)}
          error={errors(r.key)}
          hint={r.hint}
        >
          <Input
            id={fieldId(r.key)}
            inputMode="numeric"
            className="w-32"
            placeholder={r.placeholder}
            value={values[r.key]}
            onChange={(e) => onChange(r.key, e.target.value)}
            {...describedBy(r.key, errors(r.key))}
          />
        </FormRow>
      ))}
    </>
  );
}

export function SrvTunnelNote({ error }: { error?: string }) {
  return (
    <div className="text-muted-foreground bg-muted/40 flex flex-col gap-1 rounded-md border px-3 py-2 text-xs">
      <p>
        An SSH tunnel can't be combined with mongodb+srv://. Turn off{" "}
        <b>Use mongodb+srv://</b> on the Connection tab and list the replica set
        members in Host instead.
      </p>
      {error && (
        <p role="alert" className="text-destructive flex items-center gap-1">
          <ArrowRight className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
