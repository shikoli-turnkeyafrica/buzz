/**
 * URL scheme for the desktop app's deep links (`cybercare://join?…`,
 * `cybercare://connect?…`). Must agree with `DEEP_LINK_SCHEME` in
 * `desktop/src/brand.ts` — that's the app the browser hands this link to,
 * not something this build imports (separate app, separate bundle).
 */
export const DEEP_LINK_SCHEME = "cybercare";
