import assert from "node:assert/strict";
import test from "node:test";

import {
  CYBERCARE_DARK_THEME_NAME,
  CYBERCARE_THEME_NAME,
  resolveShikiThemeName,
  SYNTAX_THEMES,
  THEME_PAIRS,
} from "./theme-loader.ts";

test("Cybercare is the first-party pair and leads the picker", () => {
  assert.equal(SYNTAX_THEMES[0], CYBERCARE_THEME_NAME);
  assert.equal(SYNTAX_THEMES[1], CYBERCARE_DARK_THEME_NAME);
  assert.equal(
    THEME_PAIRS.get(CYBERCARE_THEME_NAME),
    CYBERCARE_DARK_THEME_NAME,
  );
});

test("Cybercare names resolve to bundled Shiki themes", () => {
  // The aliases are not bundled Shiki themes; handing a raw alias to the
  // highlighter throws and code blocks fall back to unhighlighted text.
  assert.equal(resolveShikiThemeName(CYBERCARE_THEME_NAME), "github-light");
  assert.equal(resolveShikiThemeName(CYBERCARE_DARK_THEME_NAME), "github-dark");
  assert.equal(resolveShikiThemeName("dracula"), "dracula");
});

test("no Buzz theme name survives", () => {
  assert.equal(SYNTAX_THEMES.includes("buzz"), false);
  assert.equal(SYNTAX_THEMES.includes("buzz-dark"), false);
  assert.equal(THEME_PAIRS.has("buzz"), false);
});
