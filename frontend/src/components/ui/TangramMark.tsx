/**
 * The Tangram mark — four triangles pinwheeling inside a rounded square.
 *
 * Option 03, "Medallion", from the logo study. What it replaces was a letter in
 * a box: clean, and true of any product beginning with T. This one is a square
 * dissected into pieces, which is what the word means.
 *
 * Painted in theme tokens rather than the study's fixed navy and blue. The
 * study was drawn against one palette; this app ships three, and a hardcoded
 * cobalt mark sits wrong on amber. The *relationships* are what carry the
 * design — one dark tile, two mid tones, one light, one accent — so those are
 * what is reproduced:
 *
 * - the tile is `--text`, the darkest thing in any palette
 * - two opposite triangles are the page colour at 45%, reading as mid tones
 * - one is the palette's accent, which is the piece that catches the eye
 * - the last is the page colour at 78%, the lightest piece
 *
 * The alphas composite over the tile rather than being their own tokens, so the
 * mark keeps its internal contrast in light and dark without six more variables.
 *
 * The favicon cannot do this — browser chrome has no access to CSS custom
 * properties — so `app/icon.svg` carries the study's literal values instead and
 * has to be edited alongside this file.
 */
export function TangramMark({
  size = 24,
  className,
  /**
   * Drops the tile and paints the four pieces in one colour at varying
   * strength, for placing on a field the full mark cannot survive.
   *
   * The sign-in panel is the case it exists for: it is a solid accent field, so
   * the accent triangle would disappear into the background and the dark tile
   * would fight the panel it sits on. Monotone keeps the shape — which is what
   * is recognisable — and lets the surface supply the colour.
   */
  tone,
}: {
  size?: number;
  className?: string;
  tone?: "flat";
}) {
  const flat = tone === "flat";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* No tile in the flat variant: the field behind it is the tile. */}
      {!flat && <rect width="100" height="100" rx="20" fill="var(--text)" />}
      <polygon
        points="50,14 86,50 50,50"
        fill={flat ? "currentColor" : "var(--bg)"}
        fillOpacity={flat ? 0.55 : 0.45}
      />
      <polygon
        points="86,50 50,86 50,50"
        fill={flat ? "currentColor" : "var(--accent)"}
        fillOpacity={flat ? 1 : undefined}
      />
      <polygon
        points="50,86 14,50 50,50"
        fill={flat ? "currentColor" : "var(--bg)"}
        fillOpacity={flat ? 0.55 : 0.45}
      />
      <polygon
        points="14,50 50,14 50,50"
        fill={flat ? "currentColor" : "var(--bg)"}
        fillOpacity={flat ? 0.8 : 0.78}
      />
    </svg>
  );
}
