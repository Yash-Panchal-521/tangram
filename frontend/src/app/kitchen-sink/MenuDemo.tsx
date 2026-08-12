"use client";

import { useState } from "react";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";

/**
 * Demonstrates the behaviour that separates this from a styled dropdown: an
 * item that closes the menu, and one that deliberately does not.
 */
export function MenuDemo() {
  const [last, setLast] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <Menu label="Demo actions">
        {(close) => (
          <>
            <MenuItem onSelect={() => setPinned((p) => !p)}>
              {pinned ? "Pinned" : "Pin (stays open)"}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close();
                setLast("Renamed");
              }}
            >
              Rename (closes)
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              tone="danger"
              onSelect={() => {
                close();
                setLast("Deleted");
              }}
            >
              Delete
            </MenuItem>
          </>
        )}
      </Menu>
      <span className="text-xs text-text-dim">
        {last ? `Last action: ${last}` : "No action yet"}
      </span>
    </div>
  );
}
