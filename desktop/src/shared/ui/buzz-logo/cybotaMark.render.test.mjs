import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CybotaMark } from "./CybotaMark.tsx";
import { SpinningMark } from "./SpinningMark.tsx";

const BRAND_GREY = "#6B6B6B";
const BRAND_RED = "#E5242B";

test("CybotaMark (brand) paints grey outer arcs, red inner arcs, and a currentColor ring", () => {
  const html = renderToStaticMarkup(React.createElement(CybotaMark));
  assert.match(html, /^<svg[^>]*viewBox="0 0 100 100"/);
  assert.match(html, /aria-hidden="true"/);
  assert.ok(
    html.includes(`stroke="${BRAND_GREY}"`),
    "outer arcs in brand grey",
  );
  assert.ok(html.includes(`stroke="${BRAND_RED}"`), "inner arcs in brand red");
  assert.ok(html.includes(`fill="${BRAND_RED}"`), "shield filled brand red");
  assert.match(
    html,
    /<circle[^>]*stroke="currentColor"/,
    "ring inherits text color",
  );
  // Two arcs per ring: 4 paths + the shield.
  assert.equal(html.match(/<path /g)?.length, 5);
});

test("CybotaMark (mono) uses currentColor everywhere so tinted call sites read as icons", () => {
  const html = renderToStaticMarkup(
    React.createElement(CybotaMark, { tone: "mono" }),
  );
  assert.ok(!html.includes(BRAND_GREY), "no brand grey in mono tone");
  assert.ok(!html.includes(BRAND_RED), "no brand red in mono tone");
  assert.equal(html.match(/currentColor/g)?.length, 4); // outer, inner, ring, shield
});

test("SpinningMark rotates HTML-level layers, keeps the core still, and honours the a11y contract", () => {
  const decorative = renderToStaticMarkup(
    React.createElement(SpinningMark, { className: "w-20" }),
  );
  // Rotating layers are <div>s wrapping their own <svg> (compositor-animated),
  // never transformed SVG children — see the comment in SpinningMark.tsx.
  assert.match(
    decorative,
    /<div class="mark-spinner-layer mark-spinner-outer[^"]*"><svg/,
  );
  assert.match(
    decorative,
    /<div class="mark-spinner-layer mark-spinner-inner[^"]*"><svg/,
  );
  // The core (ring + shield) is a sibling <svg>, outside both layers.
  assert.match(
    decorative,
    /<\/div><svg[^>]*class="relative[^"]*"[^>]*><g><circle/,
  );
  assert.match(
    decorative,
    /^<div class="[^"]*mark-spinner[^"]*" aria-hidden="true">/,
  );
  // A later width class wins over the compact default.
  assert.ok(decorative.includes(" w-20"), "caller width applied");
  assert.ok(!/\bw-6\b/.test(decorative), "default w-6 replaced, not stacked");

  const labelled = renderToStaticMarkup(
    React.createElement(SpinningMark, { ariaLabel: "Loading" }),
  );
  assert.match(
    labelled,
    /^<div class="[^"]*" aria-label="Loading" role="img">/,
  );
  assert.ok(
    /\bw-6\b/.test(labelled),
    "compact default width when no size given",
  );
});

const stylesDir = new URL("../../styles/globals/", import.meta.url);
const animationsCss = readFileSync(
  new URL("animations.css", stylesDir),
  "utf8",
);

test("animations.css drives the spinner: opposite rotations, reduced-motion goes static", () => {
  assert.match(
    animationsCss,
    /@keyframes mark-spin-cw\s*\{[^}]*rotate\(360deg\)/,
  );
  assert.match(
    animationsCss,
    /@keyframes mark-spin-ccw\s*\{[^}]*rotate\(-360deg\)/,
  );
  assert.match(
    animationsCss,
    /\.mark-spinner-outer\s*\{[^}]*animation-name: mark-spin-cw;/,
  );
  assert.match(
    animationsCss,
    /\.mark-spinner-inner\s*\{[^}]*animation-name: mark-spin-ccw;/,
  );
  assert.match(
    animationsCss,
    /\.mark-spinner-layer\s*\{[^}]*animation-iteration-count: infinite;/,
  );
  assert.match(
    animationsCss,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.mark-spinner-layer\s*\{\s*animation: none;/,
  );
});

// Enumeration tripwire for the bee → Cybota mark swap. The ruling is "Cybota
// mark, both clients": no bee component, class, or keyframe may survive
// anywhere in the desktop source or its tests.
const BEE_IDENTIFIERS =
  /FlappingBee|BuzzMark|FuzzyLogo|BuzzLogoAnimation|LandingBees|bee-wing|bee-sprite|buzz-logo-animation|buzz-logo--/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx?|mjs|css|html)$/.test(name)) yield path;
  }
}

test("no Buzz bee identifiers survive in desktop/src or desktop/tests", () => {
  const desktopRoot = new URL("../../../../", import.meta.url).pathname;
  const self = new URL(import.meta.url).pathname;
  const hits = [];
  for (const root of ["src", "tests"]) {
    for (const file of walk(join(desktopRoot, root))) {
      if (file === self) continue;
      const source = readFileSync(file, "utf8");
      const m = source.match(BEE_IDENTIFIERS);
      if (m) hits.push(`${file.slice(desktopRoot.length)}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});
