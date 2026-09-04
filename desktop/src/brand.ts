/**
 * The single place the product's brand is spelled on the frontend.
 *
 * This fork ships Block's Buzz as Cybota's Cybercare Commons. Every
 * user-facing occurrence of the product name interpolates PRODUCT_NAME
 * from here, so an upstream rebase conflict on a branded string always
 * resolves the same way: use the constant.
 *
 * Deliberately NOT here: crate names, sidecar binary names, and BUZZ_*
 * environment variables. Those are code identifiers read by buzz-agent,
 * buzz-acp, and the agent kernel's secret scrubber; renaming them breaks
 * the sidecar bundle and silently unscrubs signing keys.
 */

export const PRODUCT_NAME = "Cybercare Commons";

/** Used in compound feature names: "Commons Term", "Commons Git". */
export const PRODUCT_SHORT = "Commons";

export const VENDOR = "Cybota";

/** URL scheme for app deep links: `cybercare://message?…`. */
export const DEEP_LINK_SCHEME = "cybercare";

/**
 * Cybota has published no terms-of-service or privacy page. While these are
 * null the join-policy notice renders as plain text naming the vendor and
 * shows no links; setting either to a URL turns that half into a link.
 * Do not fill these with a guessed address.
 */
export const TERMS_URL: string | null = null;
export const PRIVACY_URL: string | null = null;
