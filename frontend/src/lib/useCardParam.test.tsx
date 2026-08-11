// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCardParam } from "@/lib/useCardParam";

afterEach(cleanup);

beforeEach(() => {
  window.history.replaceState(null, "", "/board/b-1");
});

// A harness rather than renderHook, so the assertions read as behaviour: what
// is on screen, and what the address bar says.
function Harness() {
  const { openCardId, openCard, closeCard } = useCardParam();
  return (
    <div>
      <span data-testid="open">{openCardId ?? "none"}</span>
      <button onClick={() => openCard("card-7")}>Open card 7</button>
      <button onClick={() => openCard("card-9")}>Open card 9</button>
      <button onClick={closeCard}>Close</button>
    </div>
  );
}

const openId = () => screen.getByTestId("open").textContent;
const search = () => window.location.search;

describe("useCardParam", () => {
  it("starts closed when the URL says nothing", () => {
    render(<Harness />);
    expect(openId()).toBe("none");
  });

  it("reopens the card the URL names, so a link and a refresh both work", () => {
    window.history.replaceState(null, "", "/board/b-1?card=card-42");

    render(<Harness />);

    expect(openId()).toBe("card-42");
  });

  it("puts the card in the URL when opened", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("Open card 7"));

    expect(openId()).toBe("card-7");
    expect(search()).toBe("?card=card-7");
  });

  it("keeps whatever else was in the query string", async () => {
    window.history.replaceState(null, "", "/board/b-1?tour=1");
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("Open card 7"));

    expect(search()).toContain("tour=1");
    expect(search()).toContain("card=card-7");
  });

  it("takes the card out of the URL when closed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("Open card 7"));
    await user.click(screen.getByText("Close"));

    expect(openId()).toBe("none");
    expect(search()).toBe("");
  });

  it("closes on Back, rather than leaving the board", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("Open card 7"));

    // jsdom does not run history traversal, so drive the event the hook
    // listens for after rewinding the URL — which is what Back does.
    act(() => {
      window.history.replaceState(null, "", "/board/b-1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(openId()).toBe("none");
  });

  it("does not leave an entry that Back would re-open", async () => {
    // Closing uses replaceState. With pushState, Back after closing would bring
    // the card straight back and the button would look broken.
    const user = userEvent.setup();
    render(<Harness />);

    const before = window.history.length;
    await user.click(screen.getByText("Open card 7"));
    const afterOpen = window.history.length;
    await user.click(screen.getByText("Close"));
    const afterClose = window.history.length;

    expect(afterOpen).toBe(before + 1);
    expect(afterClose).toBe(afterOpen);
  });

  it("switches straight from one card to another", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("Open card 7"));
    await user.click(screen.getByText("Open card 9"));

    expect(openId()).toBe("card-9");
    expect(search()).toBe("?card=card-9");
  });
});
