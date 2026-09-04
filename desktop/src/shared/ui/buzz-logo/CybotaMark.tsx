import { cn } from "@/shared/lib/cn";

/**
 * The Cybota mark, redrawn as vector geometry from the source icon
 * (`src-tauri/icons/cybota-source.png`): two grey outer arcs, two red inner
 * arcs counter-rotated against them, a ring, and the red shield at the core.
 *
 * Coordinates live in a 100x100 box centred on (50, 50). Angles follow SVG
 * convention (0 = 3 o'clock, clockwise); arc paths are precomputed so the
 * component is plain SVG with no runtime math.
 *
 * `tone="brand"` paints the arcs in the brand grey/red with the ring in
 * `currentColor`; `tone="mono"` paints everything in `currentColor` for the
 * places the old bee was tinted (white/yellow landing scatter, repository
 * cards, link-preview favicons).
 */
export type CybotaMarkTone = "brand" | "mono";

export const CYBOTA_MARK_GREY = "#6B6B6B";
export const CYBOTA_MARK_RED = "#E5242B";

const OUTER_ARCS = [
  // r 43, 100° for 185°
  "M 42.533 92.347 A 43 43 0 1 1 61.129 8.465",
  // r 43, -33° for 72°
  "M 86.063 26.581 A 43 43 0 0 1 83.417 77.061",
];

const INNER_ARCS = [
  // r 31, 185° for 68°
  "M 19.118 47.298 A 31 31 0 0 1 40.936 20.355",
  // r 31, 14° for 132°
  "M 80.079 57.500 A 31 31 0 0 1 24.300 67.335",
];

const SHIELD =
  "M 41.5 41 L 50 42.4 L 58.5 41 V 50.5 C 58.5 55.8 54.8 59.2 50 61 C 45.2 59.2 41.5 55.8 41.5 50.5 Z";

function toneColor(tone: CybotaMarkTone, brand: string) {
  return tone === "brand" ? brand : "currentColor";
}

/** The two grey outer arcs — the layer SpinningMark rotates clockwise. */
export function CybotaMarkOuterArcs({ tone }: { tone: CybotaMarkTone }) {
  return (
    <g
      fill="none"
      stroke={toneColor(tone, CYBOTA_MARK_GREY)}
      strokeLinecap="round"
      strokeWidth="8.5"
    >
      {OUTER_ARCS.map((d) => (
        <path d={d} key={d} />
      ))}
    </g>
  );
}

/** The two red inner arcs — the layer SpinningMark rotates counter-clockwise. */
export function CybotaMarkInnerArcs({ tone }: { tone: CybotaMarkTone }) {
  return (
    <g
      fill="none"
      stroke={toneColor(tone, CYBOTA_MARK_RED)}
      strokeLinecap="round"
      strokeWidth="7.5"
    >
      {INNER_ARCS.map((d) => (
        <path d={d} key={d} />
      ))}
    </g>
  );
}

/** Ring + shield. Never rotated: the shield stays upright while arcs spin. */
export function CybotaMarkCore({ tone }: { tone: CybotaMarkTone }) {
  return (
    <g>
      <circle
        cx="50"
        cy="50"
        fill="none"
        r="18"
        stroke="currentColor"
        strokeWidth="4.4"
      />
      <path d={SHIELD} fill={toneColor(tone, CYBOTA_MARK_RED)} />
    </g>
  );
}

export const CYBOTA_MARK_VIEWBOX = "0 0 100 100";

export function CybotaMark({
  className,
  tone = "brand",
}: {
  className?: string;
  tone?: CybotaMarkTone;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("buzz-mark", className)}
      focusable="false"
      viewBox={CYBOTA_MARK_VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <CybotaMarkOuterArcs tone={tone} />
      <CybotaMarkInnerArcs tone={tone} />
      <CybotaMarkCore tone={tone} />
    </svg>
  );
}
