import * as React from "react";

import { CybotaMark } from "@/shared/ui/buzz-logo/CybotaMark";

type Mark = {
  top: string;
  left: string;
  size: number;
  rotate: number;
  color: string;
};

const WHITE = "#FFFFFF";
const NAVY = "#1A2856";

// Fixed scatter so the field doesn't shimmer between renders. The marks are
// static (the wander below moves them); a field of 38 spinners would cost 76
// compositor layers for no gain.
const MARKS: Mark[] = [
  { top: "4%", left: "27%", size: 34, rotate: -12, color: WHITE },
  { top: "7%", left: "58%", size: 28, rotate: 18, color: NAVY },
  { top: "5%", left: "88%", size: 32, rotate: -20, color: WHITE },
  { top: "13%", left: "12%", size: 36, rotate: 18, color: NAVY },
  { top: "12%", left: "73%", size: 26, rotate: -8, color: WHITE },
  { top: "18%", left: "44%", size: 24, rotate: 25, color: NAVY },
  { top: "22%", left: "90%", size: 34, rotate: 10, color: WHITE },
  { top: "28%", left: "5%", size: 28, rotate: -18, color: NAVY },
  { top: "31%", left: "21%", size: 24, rotate: 8, color: NAVY },
  { top: "35%", left: "84%", size: 32, rotate: -14, color: WHITE },
  { top: "45%", left: "13%", size: 32, rotate: 20, color: NAVY },
  { top: "47%", left: "93%", size: 26, rotate: -6, color: NAVY },
  { top: "55%", left: "30%", size: 26, rotate: -24, color: WHITE },
  { top: "57%", left: "70%", size: 34, rotate: 12, color: NAVY },
  { top: "63%", left: "8%", size: 34, rotate: 16, color: WHITE },
  { top: "66%", left: "88%", size: 28, rotate: -10, color: NAVY },
  { top: "72%", left: "48%", size: 26, rotate: 22, color: NAVY },
  { top: "76%", left: "18%", size: 32, rotate: -16, color: WHITE },
  { top: "80%", left: "64%", size: 28, rotate: 8, color: NAVY },
  { top: "86%", left: "34%", size: 34, rotate: -20, color: WHITE },
  { top: "88%", left: "80%", size: 32, rotate: 14, color: NAVY },
  { top: "92%", left: "10%", size: 26, rotate: -8, color: NAVY },
  { top: "3%", left: "42%", size: 22, rotate: 14, color: WHITE },
  { top: "9%", left: "5%", size: 24, rotate: -22, color: NAVY },
  { top: "16%", left: "62%", size: 30, rotate: -4, color: NAVY },
  { top: "20%", left: "30%", size: 22, rotate: 12, color: WHITE },
  { top: "26%", left: "52%", size: 26, rotate: -14, color: NAVY },
  { top: "33%", left: "68%", size: 22, rotate: 24, color: WHITE },
  { top: "40%", left: "40%", size: 24, rotate: -10, color: NAVY },
  { top: "42%", left: "78%", size: 28, rotate: 6, color: NAVY },
  { top: "52%", left: "55%", size: 22, rotate: -18, color: WHITE },
  { top: "60%", left: "42%", size: 28, rotate: 10, color: NAVY },
  { top: "68%", left: "26%", size: 24, rotate: -6, color: WHITE },
  { top: "70%", left: "76%", size: 30, rotate: 18, color: NAVY },
  { top: "82%", left: "6%", size: 28, rotate: 22, color: WHITE },
  { top: "84%", left: "50%", size: 24, rotate: -12, color: NAVY },
  { top: "94%", left: "60%", size: 28, rotate: 16, color: NAVY },
  { top: "95%", left: "90%", size: 22, rotate: -24, color: WHITE },
];

const REPEL_RADIUS = 180;
const REPEL_STRENGTH = 110;
// Autonomous wander: each mark drifts on its own smooth loop.
const WANDER_X = 26;
const WANDER_Y = 20;

export function LandingMarks() {
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const markRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const pointer = React.useRef<{ x: number; y: number } | null>(null);
  const offsets = React.useRef(MARKS.map(() => ({ x: 0, y: 0 })));

  React.useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const rect = field.getBoundingClientRect();
      const p = pointer.current;
      markRefs.current.forEach((el, i) => {
        if (!el) return;
        const mark = MARKS[i];
        // Per-mark wander: two incommensurate sine waves, phase-shifted by index.
        const phase = i * 1.7;
        const wx =
          Math.sin(t * (0.7 + (i % 5) * 0.13) + phase) * WANDER_X +
          Math.sin(t * 1.9 + phase * 2.1) * 6;
        const wy =
          Math.cos(t * (0.6 + (i % 7) * 0.11) + phase) * WANDER_Y +
          Math.cos(t * 2.3 + phase * 1.3) * 5;
        let rx = 0;
        let ry = 0;
        if (p) {
          const cx = rect.left + (rect.width * parseFloat(mark.left)) / 100;
          const cy = rect.top + (rect.height * parseFloat(mark.top)) / 100;
          const ox = cx - p.x;
          const oy = cy - p.y;
          const dist = Math.hypot(ox, oy);
          if (dist < REPEL_RADIUS && dist > 0.01) {
            const push =
              ((REPEL_RADIUS - dist) / REPEL_RADIUS) * REPEL_STRENGTH;
            rx = (ox / dist) * push;
            ry = (oy / dist) * push;
          }
        }
        // Ease toward the combined target so repulsion enters/exits smoothly.
        const target = { x: wx + rx, y: wy + ry };
        const cur = offsets.current[i];
        cur.x += (target.x - cur.x) * 0.12;
        cur.y += (target.y - cur.y) * 0.12;
        el.style.transform = `translate(${cur.x}px, ${cur.y}px) rotate(${mark.rotate}deg)`;
      });
      raf = requestAnimationFrame(tick);
    };

    const onMove = (event: MouseEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const onLeave = () => {
      pointer.current = null;
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!reduced.matches) {
      raf = requestAnimationFrame(tick);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseout", onLeave);
    }
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseout", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={fieldRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <span className="absolute left-6 top-12 block w-11 text-[#231E1E]">
        <CybotaMark className="h-auto w-full" />
      </span>
      {MARKS.map((mark, i) => (
        <span
          key={`${mark.top}-${mark.left}`}
          ref={(el) => {
            markRefs.current[i] = el;
          }}
          className="absolute block will-change-transform"
          style={{
            top: mark.top,
            left: mark.left,
            width: mark.size,
            color: mark.color,
            transform: `rotate(${mark.rotate}deg)`,
            opacity: 0.9,
          }}
        >
          <CybotaMark className="h-auto w-full" tone="mono" />
        </span>
      ))}
    </div>
  );
}
