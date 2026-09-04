import { cn } from "@/shared/lib/cn";
import {
  CYBOTA_MARK_VIEWBOX,
  CybotaMarkCore,
  CybotaMarkInnerArcs,
  CybotaMarkOuterArcs,
  type CybotaMarkTone,
} from "./CybotaMark";

/**
 * The animated Cybota mark used on loading gates and liveness indicators:
 * outer arcs turn clockwise, inner arcs counter-clockwise, the shield stays
 * put. Keyframes live in `styles/globals/animations.css` (`.mark-spinner-*`).
 *
 * Each rotating layer is an HTML-level <div> wrapping its own <svg> rather
 * than a transformed SVG child: WebKit paints SVG children on the main
 * thread, so their animations freeze while boot work hogs the thread —
 * exactly when the loading gate is visible. HTML-level transforms run on
 * the compositor and keep turning. Plain SVG + CSS, no JS/SMIL, so the mark
 * paints on the very first frame even before scripting starts, and
 * `prefers-reduced-motion` gets the static mark.
 *
 * Defaults to the compact 1.5rem the old inline animation used; pass a width
 * class to size it (`cn` lets a later `w-*` win).
 */
export function SpinningMark({
  ariaLabel,
  className,
  tone = "brand",
}: {
  /** Accessible name; omit for purely decorative uses (aria-hidden). */
  ariaLabel?: string;
  className?: string;
  tone?: CybotaMarkTone;
}) {
  const a11y = ariaLabel
    ? { "aria-label": ariaLabel, role: "img" }
    : { "aria-hidden": true };
  return (
    <div
      className={cn(
        "buzz-mark mark-spinner relative block aspect-square w-6",
        className,
      )}
      {...a11y}
    >
      <div className="mark-spinner-layer mark-spinner-outer absolute inset-0">
        <svg
          aria-hidden="true"
          className="block h-full w-full"
          focusable="false"
          viewBox={CYBOTA_MARK_VIEWBOX}
          xmlns="http://www.w3.org/2000/svg"
        >
          <CybotaMarkOuterArcs tone={tone} />
        </svg>
      </div>
      <div className="mark-spinner-layer mark-spinner-inner absolute inset-0">
        <svg
          aria-hidden="true"
          className="block h-full w-full"
          focusable="false"
          viewBox={CYBOTA_MARK_VIEWBOX}
          xmlns="http://www.w3.org/2000/svg"
        >
          <CybotaMarkInnerArcs tone={tone} />
        </svg>
      </div>
      <svg
        aria-hidden="true"
        className="relative block h-full w-full"
        focusable="false"
        viewBox={CYBOTA_MARK_VIEWBOX}
        xmlns="http://www.w3.org/2000/svg"
      >
        <CybotaMarkCore tone={tone} />
      </svg>
    </div>
  );
}
