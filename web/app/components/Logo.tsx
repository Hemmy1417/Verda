/** The only colour the mark is ever drawn in. Never black. */
export const MOSS = "#56613f";

/**
 * The mark: a thin circle; inside it a serif capital V whose thick left
 * stroke is a filled wedge and whose thin right stroke runs on past the
 * vertex into a single leaf-vein curve. Hairlines are 1.5px at every render
 * size (non-scaling), so it stays legible at 16px and quiet at 32px.
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
        fill="none" stroke={MOSS} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
      />
      {/* the thick left stroke, tapering into the vertex */}
      <path d="M17 19h9.5l7.5 21.5-3.2 6.5z" fill={MOSS} />
      {/* the serifs */}
      <path
        d="M14.5 19h13.5M42.5 19h7"
        fill="none" stroke={MOSS} strokeWidth="1.5" strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* the thin right stroke, continuing through the vertex as the vein */}
      <path
        d="M46 19 30.8 47c-2.3 4.5-6.3 6.5-10.8 6"
        fill="none" stroke={MOSS} strokeWidth="1.5" strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
