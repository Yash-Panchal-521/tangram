"use client";

import { useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";

// The gallery page is a server component; the picker holds state, so the demo
// owns it. Same reason ConfirmDialogDemo and InviteChipsDemo exist.
export function DatePickerDemo() {
  const [value, setValue] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <DatePicker value={value} onChange={setValue} />
      <p className="text-[11px] text-text-dim">
        Value: <code>{value || "(empty)"}</code>
      </p>
    </div>
  );
}
