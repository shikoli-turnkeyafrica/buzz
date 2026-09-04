import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Regression guard for the v0.5.18-test.5 defect: the Cybercare sidebar
 * canvas is painted navy, but the rows inherited the light theme's dark
 * `--sidebar-foreground` and vanished. Every assertion here is computed
 * from the LITERAL token values in theme.css (HSL/hex -> sRGB -> relative
 * luminance -> WCAG ratio), so changing one side of a pair without the
 * other fails loudly instead of shipping another invisible sidebar.
 */

const themeCss = readFileSync(new URL("./theme.css", import.meta.url), "utf8");

// --- tiny colour math -------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  assert.equal(h.length, 6, `expected 6-digit hex, got ${hex}`);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
}

function hslToRgb(triple) {
  const m = triple.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  assert.ok(m, `expected "H S% L%", got "${triple}"`);
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

// `rgb(255 255 255 / 16%)` -> { rgb, alpha }
function parseRgbAlpha(value) {
  const m = value
    .trim()
    .match(/^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\)$/);
  assert.ok(m, `expected "rgb(r g b / a%)", got "${value}"`);
  return {
    rgb: [m[1], m[2], m[3]].map((c) => Number(c) / 255),
    alpha: Number(m[4]) / 100,
  };
}

function over(top, alpha, bottom) {
  return top.map((c, i) => c * alpha + bottom[i] * (1 - alpha));
}

function luminance([r, g, b]) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// --- token extraction -------------------------------------------------------

// First declaration of `name` between the first occurrence of `anchor` (a
// selector fragment or a declaration inside the block) and the next `}`.
function tokenIn(anchor, name) {
  const idx = themeCss.indexOf(anchor);
  assert.notEqual(idx, -1, `anchor not found: ${anchor}`);
  const close = themeCss.indexOf("}", idx);
  const body = themeCss.slice(idx, close);
  const m = body.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(m, `${name} not declared after ${anchor}`);
  return m[1].trim();
}

const SIDEBAR_SCOPE =
  ':root[data-buzz-sidebar]:not(.dark) [data-testid="app-sidebar"],\n:root[data-buzz-sidebar]:not(.dark) [data-testid="settings-sidebar"],';
// Inside the `@layer base { :root {` block; the dark block comes later.
const LIGHT_ROOT = "--radius: 0.625rem;";
const PROMINENT_ACTIVE =
  ':root[data-buzz-sidebar][data-prominent-active-tab]\n  [data-testid="app-sidebar"]\n  [data-active="true"],';

const navy = hexToRgb(tokenIn(LIGHT_ROOT, "--buzz-gradient-light-top"));
const white = [1, 1, 1];

test("the light Cybercare canvas is navy, so the base sidebar text would be unreadable", () => {
  // Documents WHY the scoped override exists. If the canvas ever goes pale
  // again this flips and the override should be reconsidered, not kept.
  const baseFg = hslToRgb(tokenIn(LIGHT_ROOT, "--sidebar-foreground"));
  assert.ok(
    contrast(baseFg, navy) < 4.5,
    "base --sidebar-foreground now reads on the canvas; the override may be redundant",
  );
});

test("Cybercare light overrides sidebar text on every painted chrome canvas", () => {
  for (const canvas of [
    '[data-testid="app-sidebar"]',
    '[data-testid="settings-sidebar"]',
    '[data-testid="app-top-chrome"]',
    '[data-testid="community-rail"]',
    '[data-sidebar="sidebar"][data-mobile="true"]',
  ]) {
    assert.match(
      themeCss,
      new RegExp(
        `:root\\[data-buzz-sidebar\\]:not\\(\\.dark\\)\\s*${canvas.replace(/[[\]()."=/]/g, "\\$&")}[^{]*\\{[^}]*--sidebar-foreground:`,
      ),
      `${canvas} does not carry the light-mode --sidebar-foreground override`,
    );
  }
});

test("sidebar rows meet AA on the navy canvas, at full and 70% opacity", () => {
  const fg = hslToRgb(tokenIn(SIDEBAR_SCOPE, "--sidebar-foreground"));
  assert.ok(
    contrast(fg, navy) >= 4.5,
    `full: ${contrast(fg, navy).toFixed(2)}`,
  );
  const seventy = over(fg, 0.7, navy);
  assert.ok(
    contrast(seventy, navy) >= 4.5,
    `text-sidebar-foreground/70: ${contrast(seventy, navy).toFixed(2)}`,
  );
  const hoverFg = hslToRgb(
    tokenIn(SIDEBAR_SCOPE, "--sidebar-accent-foreground"),
  );
  assert.ok(contrast(hoverFg, navy) >= 4.5, "hover text on navy");
});

test("the subtle active row keeps its text readable", () => {
  const surface = parseRgbAlpha(
    tokenIn(SIDEBAR_SCOPE, "--sidebar-row-subtle-active-surface"),
  );
  const rowBg = over(surface.rgb, surface.alpha, navy);
  const activeFg = hslToRgb(tokenIn(SIDEBAR_SCOPE, "--buzz-active-foreground"));
  assert.ok(
    contrast(activeFg, rowBg) >= 4.5,
    `active row: ${contrast(activeFg, rowBg).toFixed(2)}`,
  );
});

test("the prominent active pill uses the content foreground, not the canvas white", () => {
  assert.equal(
    tokenIn(PROMINENT_ACTIVE, "--sidebar-active-foreground"),
    "var(--foreground)",
  );
  const pill = parseRgbAlpha(
    tokenIn(
      ":root[data-buzz-sidebar] {\n  --sidebar-row-active-surface",
      "--sidebar-row-active-surface",
    ),
  );
  const pillBg = over(pill.rgb, pill.alpha, navy);
  const fg = hslToRgb(tokenIn(LIGHT_ROOT, "--foreground"));
  assert.ok(
    contrast(fg, pillBg) >= 4.5,
    `pill: ${contrast(fg, pillBg).toFixed(2)}`,
  );
  // And the canvas white would NOT have worked here — the reason for the rule.
  assert.ok(contrast(white, pillBg) < 3);
});

test("avatar chips (accent fill + sidebar text) stay readable on navy", () => {
  const accent = hslToRgb(tokenIn(SIDEBAR_SCOPE, "--sidebar-accent"));
  const chip = over(accent, 0.6, navy); // CommunityRail: bg-sidebar-accent/60
  const fg = hslToRgb(tokenIn(SIDEBAR_SCOPE, "--sidebar-foreground"));
  const initials = over(fg, 0.8, chip); // text-sidebar-foreground/80
  assert.ok(
    contrast(initials, chip) >= 4.5,
    `chip initials: ${contrast(initials, chip).toFixed(2)}`,
  );
});

test("content cards nested in the sidebar fall back to the content foreground", () => {
  assert.equal(
    tokenIn(
      ':root[data-buzz-sidebar]:not(.dark)\n  [data-testid="app-sidebar"]\n  [data-buzz-content-surface]',
      "--sidebar-foreground",
    ),
    "var(--foreground)",
  );
});
