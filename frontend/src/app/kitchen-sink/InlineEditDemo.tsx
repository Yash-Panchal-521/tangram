"use client";

import { useState } from "react";
import { InlineEdit } from "@/components/ui/InlineEdit";

// Three at once, because the states worth eyeballing are relative: a value, an
// empty value, and one whose save fails. The failing one is the reason this
// primitive reports errors per field rather than throwing to a shared handler.
export function InlineEditDemo() {
  const [summary, setSummary] = useState("Ship the date picker");
  const [notes, setNotes] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <Row label="Summary">
        <InlineEdit
          label="Summary"
          value={summary}
          onCommit={async (next) => setSummary(next)}
        />
      </Row>

      <Row label="Description (multiline, empty)">
        <InlineEdit
          label="Description"
          value={notes}
          multiline
          placeholder="Add a description…"
          onCommit={async (next) => setNotes(next)}
        />
      </Row>

      <Row label="Always fails">
        <InlineEdit
          label="Fragile field"
          value="Try editing me"
          onCommit={async () => {
            throw new Error("Couldn't save that — check your connection and try again.");
          }}
        />
      </Row>

      <Row label="Read-only (viewer)">
        <InlineEdit label="Summary" value={summary} readOnly onCommit={async () => {}} />
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
        {label}
      </span>
      {children}
    </div>
  );
}
