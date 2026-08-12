import type { TourStep } from "@/components/onboarding/Walkthrough";

/**
 * The board walkthrough, on demand only.
 *
 * Deliberately not offered automatically. It would collide with the first-run
 * introduction — both are "the first minute", and there is only one of those —
 * and an affordance that needs a coach mark to be findable is an affordance that
 * should have been clearer. This is a refresher for someone who asks, and the
 * empty states carry the just-in-time version for everyone else.
 *
 * Steps are selected by whether their anchor exists, so a board with no cards
 * simply doesn't get the card step rather than spotlighting nothing.
 */
export const BOARD_TOUR: TourStep[] = [
  {
    target: "[data-tour='columns']",
    title: "Columns are stages",
    body: "Each column is a stage work moves through. Rename one by clicking its name, and add more on the right.",
  },
  {
    target: "[data-tour='card']",
    title: "Cards hold the work",
    body: "Click a card to open it. Drag it to another column — or focus it and press the space bar, then use the arrow keys.",
  },
  {
    // Repointed when the per-column button went. Steps whose target is missing
    // are filtered out silently, so this one had been quietly dropping itself
    // — the tour lost a step and said nothing.
    target: "[data-tour='create']",
    title: "Add as you go",
    body: "One place to make a card, or press C. It lands at the bottom of the column you pick, and everyone watching sees it appear immediately.",
  },
  {
    target: "[data-tour='sync']",
    title: "This is your connection",
    body: "Green means your changes are reaching everyone else. If it drops, the board reconnects and replays whatever you missed.",
  },
  {
    target: "[data-tour='members']",
    title: "Bring people in",
    body: "Invite teammates as owners, editors or viewers. Nothing emails them — copy the invite link and send it yourself, and they join when they accept.",
  },
];
