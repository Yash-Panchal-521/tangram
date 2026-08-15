// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The panel reaches Firebase transitively — CopyInviteButton wants a token —
// and `getAuth` throws on the placeholder key the test env carries. Stubbed
// here rather than given real credentials: none of this suite signs anything in.
vi.mock("@/lib/firebase", () => ({ firebaseApp: {}, auth: {} }));

import { InvitePanel } from "@/components/workspace/InvitePanel";

afterEach(cleanup);

function mount() {
  render(
    <InvitePanel
      workspaceId="w-1"
      workspaceName="Supernatural"
      members={[]}
      invitations={[]}
      myEmail="dean@example.com"
      onInvited={vi.fn()}
    />
  );
}

describe("InvitePanel — the role hint", () => {
  it("joins the role blurb to the sentence after it", () => {
    // The blurb ends in a full stop and the next sentence began on the
    // following source line, so JSX dropped the join and the panel read
    // "…columns and cards.No account needed yet". A missing space is invisible
    // in review and survives every type and lint check, so it is pinned here.
    mount();

    const hint = document.getElementById("invite-hint")!;

    expect(hint.textContent).toContain("cards. No account needed yet");
    expect(hint.textContent).not.toMatch(/\w\.\w/);
  });

  it("says what the chosen role may do before anything is typed", () => {
    // The panel has to explain itself before you submit, not after.
    mount();

    expect(screen.getByText(/Can add, edit, move, and delete columns and cards/)).toBeTruthy();
  });
});
