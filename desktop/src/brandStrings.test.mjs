import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

// A filtered grep that returns nothing is not proof of absence, so this
// enumerates the whole frontend namespace instead. It fires on the bare word
// "Buzz" inside a double-quoted string, a same-line template literal, or a
// JSX text node — the places a user can read it. Identifiers
// (BUZZ_PRIVATE_KEY), package names (buzz-acp), and comments are out of
// scope by design: renaming those breaks the sidecar bundle and the agent
// kernel's secret scrubber.
//
// Known blind spot: a template literal or JSX text run that wraps "Buzz"
// across multiple source lines (the word not on the same line as its
// opening backtick/tag) is invisible to this line-by-line scan. A manual
// full-repo audit swept these once when this test was written; there is no
// automated guard against a new one appearing.
const ALLOWLIST = [
  // Migrates FROM Buzz and must name it:
  "brand.ts",
  // This scan:
  "brandStrings.test.mjs",
];

// Two e2e mock strings deliberately keep saying "Buzz": they mirror literal
// error text still emitted by the untouched Rust backend (desktop/src-tauri
// still returns these verbatim — out of scope for this frontend string
// sweep), and desktop/src/features/agents/ui/personaModelDiscoveryStatus.ts
// pattern-matches the lowercased text on the exact substring "no buzz shared
// compute serving members". Rebranding the mock alone would desync it from
// the real backend and silently defeat that matcher in every e2e run without
// any signal. Revisit once the backend strings are rebranded.
const LINE_ALLOWLIST = new Set([
  "testing/e2eBridge.ts:9077",
  "testing/e2eBridge.ts:13113",
]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

function userFacingBuzzLines(source) {
  const hits = [];
  source.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    const inString = /"[^"]*\bBuzz\b[^"]*"/.test(line);
    const inTemplate = /`[^`]*\bBuzz\b[^`]*`/.test(line);
    const inJsxText = /^[^<]*>[^<]*\bBuzz\b/.test(line);
    if (inString || inTemplate || inJsxText)
      hits.push(`${index + 1}: ${trimmed}`);
  });
  return hits;
}

test("no user-facing string still says Buzz", () => {
  const violations = [];
  for (const file of walk(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file).replaceAll("\\", "/");
    if (ALLOWLIST.includes(rel)) continue;
    if (rel.includes(".test.") || rel.includes("__tests__")) continue;
    for (const hit of userFacingBuzzLines(fs.readFileSync(file, "utf8"))) {
      const lineNumber = hit.slice(0, hit.indexOf(":"));
      if (LINE_ALLOWLIST.has(`${rel}:${lineNumber}`)) continue;
      violations.push(`${rel}:${hit}`);
    }
  }
  assert.deepEqual(violations, []);
});
