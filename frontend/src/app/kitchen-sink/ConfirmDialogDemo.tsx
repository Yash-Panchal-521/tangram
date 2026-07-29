"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";

// Colocated with the kitchen-sink page rather than living in components/ui:
// it exists to exercise the dialog, not to be reused.
export function ConfirmDialogDemo() {
  const { confirm, dialog } = useConfirm();
  const [lastResult, setLastResult] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="danger"
        size="sm"
        onClick={async () => {
          const ok = await confirm({
            title: "Delete “In Progress”?",
            body: "Its 3 cards will be deleted too. Everyone on the board sees this immediately, and it can't be undone.",
            confirmLabel: "Delete column",
            tone: "danger",
          });
          setLastResult(ok ? "confirmed" : "cancelled");
        }}
      >
        Destructive
      </Button>

      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          const ok = await confirm({
            title: "Make Sara R. an owner?",
            body: "Owners can invite and remove people, change roles — including yours — and delete boards.",
            confirmLabel: "Make owner",
          });
          setLastResult(ok ? "confirmed" : "cancelled");
        }}
      >
        Neutral
      </Button>

      {lastResult && (
        <span data-testid="confirm-result" className="text-xs text-text-muted">
          Last result: {lastResult}
        </span>
      )}

      {dialog}
    </div>
  );
}
