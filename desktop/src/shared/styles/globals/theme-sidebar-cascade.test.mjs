import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { chromium } from "@playwright/test";

/*
 * Regression guard for the v0.5.18-test.7 defect: ONLY the selected sidebar
 * row was legible on the navy canvas.
 *
 * Its sibling `theme-sidebar-contrast.test.mjs` computes ratios from the
 * literal token values, and passed the whole time the app was broken — a
 * token is not a colour until some element resolves it. `Sidebar` declares
 * `text-sidebar-foreground` on its OUTER wrapper and spreads `data-testid`
 * onto an inner div, so `color` was computed on an ANCESTOR of the element
 * the override matches; rows inherited that dark computed colour, and only
 * rows re-declaring colour of their own (`data-[active=true]:…`) picked the
 * override up.
 *
 * So this test asserts on the CASCADE, in a real engine: it rebuilds the
 * nesting from shared/ui/sidebar.tsx, loads the real theme.css, and reads
 * getComputedStyle off an INACTIVE row. Both the structure and the two
 * Tailwind utilities are asserted against their sources below, so the model
 * cannot silently drift away from the app it stands in for.
 */

const here = (p) => new URL(p, import.meta.url);
const themeCss = readFileSync(here("./theme.css"), "utf8");
const sidebarTsx = readFileSync(here("../../ui/sidebar.tsx"), "utf8");

// --- the structural facts this model depends on -----------------------------

test("Sidebar still declares text-sidebar-foreground above its data-testid element", () => {
  // The premise of the whole defect. If upstream ever moves the utility onto
  // the element that receives {...props}, the DOM below stops being faithful
  // and this file must be rebuilt from the new structure.
  const wrapper = sidebarTsx.indexOf(
    'className="group peer relative hidden text-sidebar-foreground md:block"',
  );
  const spread = sidebarTsx.indexOf("{...props}", wrapper);
  assert.notEqual(wrapper, -1, "outer wrapper class changed");
  assert.notEqual(spread, -1, "{...props} no longer follows the wrapper");
});

// --- the DOM, as the app builds it ------------------------------------------

// Tailwind generates these; they are inlined so the test needs no build step.
const TAILWIND_SHIM = `
  .text-sidebar-foreground { color: hsl(var(--sidebar-foreground)); }
  .text-sidebar-active-foreground { color: hsl(var(--sidebar-active-foreground)); }
  .bg-sidebar { background-color: hsl(var(--sidebar-background)); }
`;

const PAGE = `<!doctype html>
<html data-buzz-sidebar><head><style>
${themeCss}
${TAILWIND_SHIM}
</style></head>
<body>
  <!-- shared/ui/sidebar.tsx: wrapper carries the text utility … -->
  <div class="group peer relative hidden text-sidebar-foreground md:block">
    <div class="absolute inset-y-0" data-testid="app-sidebar">
      <!-- … {...props} lands here, two levels above the rows -->
      <div data-sidebar="sidebar" class="bg-sidebar">
        <div data-sidebar-transition-content>
          <a id="inactive" data-sidebar="menu-button">cybota-bank-commons-gov</a>
          <a id="active" data-sidebar="menu-button" data-active="true"
             class="text-sidebar-active-foreground">selected</a>
          <div data-buzz-content-surface><span id="card">profile card</span></div>
        </div>
      </div>
    </div>
  </div>
</body></html>`;

// --- colour math (sRGB -> relative luminance -> WCAG ratio) -----------------

function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  assert.equal(h.length, 6, `expected 6-digit hex, got ${hex}`);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
}

function parseRgb(value) {
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  assert.ok(m, `expected an rgb() colour, got "${value}"`);
  return [m[1], m[2], m[3]].map((c) => Number(c) / 255);
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

/*
 * `just desktop-test` installs dependencies but not Playwright's browsers —
 * only the e2e jobs do — so the runtime checks skip where no browser exists
 * rather than failing the unit job. They run locally and in e2e environments;
 * the structural assertions below run everywhere.
 */
async function computed() {
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    return null;
  }
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    return await page.evaluate(() => {
      const colorOf = (id) =>
        getComputedStyle(document.getElementById(id)).color;
      return {
        inactive: colorOf("inactive"),
        active: colorOf("active"),
        card: colorOf("card"),
      };
    });
  } finally {
    await browser.close();
  }
}

const style = await computed();
const NO_BROWSER = "no Playwright browser installed";

/*
 * The canvas the rows sit on is the painted gradient layer, not the sidebar's
 * own background (which is transparent over it), so the comparison colour is
 * the gradient's top stop — the same literal the sibling contrast test uses.
 */
const navy = hexToRgb(
  themeCss.match(/--buzz-gradient-light-top:\s*([^;]+);/)[1],
);

test("an INACTIVE sidebar row reads on the navy canvas", (t) => {
  // The v0.5.18-test.7 defect: this row was 1.77:1 while `active` was fine.
  if (!style) return t.skip(NO_BROWSER);
  const ratio = contrast(parseRgb(style.inactive), navy);
  assert.ok(
    ratio >= 4.5,
    `inactive row ${style.inactive} on the navy canvas is ${ratio.toFixed(2)}:1`,
  );
});

test("the selected row still reads (the half that was never broken)", (t) => {
  if (!style) return t.skip(NO_BROWSER);
  const ratio = contrast(parseRgb(style.active), navy);
  assert.ok(ratio >= 4.5, `active row is ${ratio.toFixed(2)}:1`);
});

test("an opaque content card inside the sidebar keeps its dark text", (t) => {
  // The card sits on the light content surface, so inheriting the canvas
  // white would blank it — the exception rule must survive the fix.
  if (!style) return t.skip(NO_BROWSER);
  const cardRatio = contrast(parseRgb(style.card), [1, 1, 1]);
  assert.ok(
    cardRatio >= 4.5,
    `content-surface text ${style.card} on white is ${cardRatio.toFixed(2)}:1`,
  );
});

test("theme.css re-declares colour wherever it retints --sidebar-foreground", () => {
  // Cheap structural echo of the runtime assertions above, so the reason the
  // fix works is visible at the point of edit.
  for (const [label, anchor] of [
    [
      "canvas",
      ':root[data-buzz-sidebar]:not(.dark) [data-testid="app-sidebar"],',
    ],
    [
      "content surface",
      '[data-testid="app-sidebar"]\n  [data-buzz-content-surface] {',
    ],
  ]) {
    const idx = themeCss.indexOf(anchor);
    assert.notEqual(idx, -1, `${label} rule not found`);
    const body = themeCss.slice(idx, themeCss.indexOf("}", idx));
    assert.match(
      body,
      /color:\s*hsl\(var\(--sidebar-foreground\)\)/,
      `${label} rule retints the token without re-declaring colour`,
    );
  }
});
