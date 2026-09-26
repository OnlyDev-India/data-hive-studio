import { useEffect } from "react";
import { useStudioStore } from "@/shared/store";
import { isFreshCard, useConnectionDrafts } from "../lib/drafts";
import { ConnectionForm } from "./connection-form/connection-form";
import { KindPicker } from "./connection-form/kind-picker";
import { CardDragContext, useCardDrag } from "./connection-form/use-card-drag";

export function Landing() {
  const drafts = useConnectionDrafts();
  const request = useStudioStore((s) => s.landingForm);
  const clearRequest = useStudioStore((s) => s.clearLandingForm);
  const { attachArea, ...drag } = useCardDrag(16);

  useEffect(() => {
    if (!request) return;
    clearRequest();
    useConnectionDrafts
      .getState()
      .loadSaved(request.kind, request.params, request.edit ?? null);
  }, [request, clearRequest]);

  return (
    <CardDragContext.Provider value={drag}>
      <div
        ref={attachArea}
        className="bg-muted/20 relative isolate flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-hidden p-6"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(color-mix(in_oklch,var(--color-muted-foreground)_28%,transparent)_1px,transparent_1px)] mask-[radial-gradient(ellipse_at_center,black_35%,transparent_80%)] bg-size-[22px_22px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-112 w-160 max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--color-primary)_14%,transparent),transparent)] blur-2xl"
        />
        {drafts.step === "pick" ? (
          <KindPicker
            selected={drafts.kind}
            onSelect={drafts.pickKind}
            onNext={drafts.openForm}
            showNew={!isFreshCard(drafts)}
            onNew={drafts.reset}
          />
        ) : (
          <ConnectionForm key={drafts.visit} onNew={drafts.reset} />
        )}
      </div>
    </CardDragContext.Provider>
  );
}
