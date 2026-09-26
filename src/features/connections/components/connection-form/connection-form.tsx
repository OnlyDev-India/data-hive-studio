import { useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { currentDraft, useConnectionDrafts } from "../../lib/drafts";
import { tabChanged, tabsFor, type FormTabKey } from "../../lib/tab-fields";
import { validateForm } from "../../lib/validate-form";
import { ReconnectDialog } from "../reconnect-dialog";
import { CardTabs, type TabDot } from "./card-tabs";
import { ConnectionCard } from "./connection-card";
import { MongoForm } from "./mongo-form";
import { PgForm } from "./pg-form";
import { SqliteForm } from "./sqlite-form";
import { useFormActions } from "./use-form-actions";

export function ConnectionForm({ onNew }: { onNew: () => void }) {
  const d = useConnectionDrafts();
  const draft = currentDraft(d);
  const [tab, setTab] = useState<FormTabKey>("connection");
  const a = useFormActions(setTab);

  const errors = a.checked ? validateForm(draft) : [];
  const errorFor = (field: string) =>
    errors.find((e) => e.field === field)?.message;
  const tabs = tabsFor(draft.kind);
  const dots: Partial<Record<FormTabKey, TabDot>> = {};
  for (const t of tabs) {
    dots[t.key] = errors.some((e) => e.tab === t.key)
      ? "error"
      : tabChanged(draft, t.key)
        ? "changed"
        : null;
  }

  const sqlite = draft.kind === "sqlite";
  const busy = a.connecting || a.testing;
  const common = { tab, errors: errorFor, onChangeKind: d.backToPicker };

  return (
    <>
      <ConnectionCard
        title={d.edit ? `Edit Connection · ${d.edit.name}` : "New Connection"}
        showNew
        onNew={onNew}
        tabs={
          <CardTabs
            idPrefix="conn"
            tabs={tabs}
            value={tab}
            onChange={setTab}
            dots={dots}
          />
        }
        footer={
          <>
            <Button variant="ghost" onClick={d.backToPicker}>
              <ArrowLeft className="size-3.5" />
              Previous
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {!sqlite && (
                <Button
                  variant="outline"
                  onClick={() => void a.runTest()}
                  disabled={busy}
                >
                  {a.testing ? "Testing…" : "Test"}
                </Button>
              )}
              <Button variant="secondary" onClick={() => void a.runSave()}>
                <Save className="size-3.5" />
                Save
              </Button>
              <Button onClick={() => void a.runConnect()} disabled={busy}>
                {sqlite
                  ? a.connecting
                    ? "Opening…"
                    : "Open"
                  : a.connecting
                    ? "Connecting…"
                    : "Connect"}
              </Button>
            </div>
          </>
        }
        status={
          a.test &&
          (a.test.ok ? (
            <p role="status" className="text-success-dark text-xs">
              Connection successful.
            </p>
          ) : (
            <p role="alert" className="text-destructive text-xs break-words">
              {a.test.error}
            </p>
          ))
        }
      >
        <div
          role="tabpanel"
          id="conn-panel"
          aria-labelledby={`conn-tab-${tab}`}
        >
          {draft.kind === "postgres" ? (
            <PgForm values={draft.values} patch={d.patchPg} {...common} />
          ) : draft.kind === "sqlite" ? (
            <SqliteForm
              values={draft.values}
              patch={d.patchSqlite}
              {...common}
            />
          ) : (
            <MongoForm
              values={draft.values}
              patch={d.patchMongo}
              documentDb={draft.kind === "documentdb"}
              {...common}
            />
          )}
        </div>
      </ConnectionCard>
      <ReconnectDialog
        conn_ids={a.reconnect.ids}
        busy={a.reconnect.busy}
        onReconnect={() => void a.reconnect.now()}
        onLater={a.reconnect.later}
      />
    </>
  );
}
