"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { PriorityIcon } from "@/components/ui/PriorityIcon";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { PRIORITIES } from "@/lib/priority";

const PEOPLE = ["Sara Reyes", "Dev Patel", "Yash P."];

export function SelectMenuDemo() {
  const [priority, setPriority] = useState<string>("High");
  const [assignee, setAssignee] = useState<string>("");

  return (
    <div className="flex flex-col gap-2 max-w-[280px] rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="grid grid-cols-[72px_1fr] items-center gap-x-2.5">
        <span className="text-[11px] font-medium text-text-muted">Priority</span>
        <SelectMenu
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={[
            { value: "", label: "None", muted: true },
            ...PRIORITIES.map((p) => ({
              value: p,
              label: p,
              icon: <PriorityIcon priority={p} />,
            })),
          ]}
        />
      </div>

      <div className="grid grid-cols-[72px_1fr] items-center gap-x-2.5">
        <span className="text-[11px] font-medium text-text-muted">Assignee</span>
        <SelectMenu
          label="Assignee"
          value={assignee}
          onChange={setAssignee}
          options={[
            { value: "", label: "Unassigned", muted: true },
            ...PEOPLE.map((name) => ({
              value: name,
              label: name,
              icon: <Avatar name={name} size="sm" />,
            })),
          ]}
        />
      </div>
    </div>
  );
}
