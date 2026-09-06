/** The mark's palette — the one place in the app colour is allowed.
 *  Flat pigment hues, gallery-flat: no gradients. Never black. */
export const MOSS = "#56613f";        // the thick stroke of the V
export const LEAF = "#6da33c";        // the bud
export const TERRACOTTA = "#a8542f";  // ring, serifs, thin stroke

/**
 * The mark: a terracotta circle; inside it a serif capital V — a thick
 * moss-filled left stroke and a thin terracotta right stroke that BOTH end
 * at the vertex (a stroke carried past the vertex gave the mark a descender
 * and made it read as a Y) — with a leaf-green bud on the left serif.
 * Hairlines are 1.5px at every render size (non-scaling), so it stays
 * legible at 16px and quiet at 32px; at 16px the bud reads as a serif
 * flourish, at 32px as the leaf it is.
 *
 * app/icon.svg is the same drawing as a static file; keep the two in step.
 */
export function Logo({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle
        cx="32" cy="32" r="29"
        fill="none" stroke={TERRACOTTA} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
      />
      {/* the leaf, budding from the left serif's end — above the letter,
          never below the vertex */}
      <path d="M14.5 19c-2-3.4-1.2-7 2.2-8.8c1.5 3.4.6 6.9-2.2 8.8z" fill={LEAF} />
      {/* the thick left stroke, tapering into the vertex */}
      <path d="M17 19h9.5l7.5 21.5-3.2 6.5z" fill={MOSS} />
      {/* the serifs */}
      <path
        d="M14.5 19h13.5M42.5 19h7"
        fill="none" stroke={TERRACOTTA} strokeWidth="1.5" strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* the thin right stroke, ending exactly at the vertex */}
      <path
        d="M46 19 30.8 47"
        fill="none" stroke={TERRACOTTA} strokeWidth="1.5" strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
