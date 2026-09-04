//! The single place the product's brand is spelled on the backend.
//!
//! Mirrors `desktop/src/brand.ts`. The Tauri identifier controls both the
//! app-data directory and (via [`KEYRING_SERVICE`]) where the identity key
//! lives, so the Buzz values below are retained: `migration.rs` reads them
//! to carry an existing Buzz install's data and key forward on first launch.

pub const PRODUCT_NAME: &str = "Cybercare Commons";
pub const APP_IDENTIFIER: &str = "africa.cybota.cybercare.commons";
pub const KEYRING_SERVICE: &str = "cybercare-commons";

/// Prefix for every `eprintln!` diagnostic, replacing `buzz-desktop:`.
pub const LOG_PREFIX: &str = "cybercare-commons";

pub const DEEP_LINK_SCHEME: &str = "cybercare";

/// Buzz identifiers this build migrates FROM on first launch. Read-only:
/// migration copies and never moves or deletes, so an existing Buzz install
/// stays runnable as a fallback.
pub const BUZZ_IDENTIFIER: &str = "xyz.block.buzz.app";
pub const BUZZ_KEYRING_SERVICE: &str = "buzz-desktop";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_is_reverse_dns_and_distinct_from_buzz() {
        assert!(APP_IDENTIFIER.starts_with("africa.cybota."));
        assert_ne!(APP_IDENTIFIER, BUZZ_IDENTIFIER);
        assert_ne!(KEYRING_SERVICE, BUZZ_KEYRING_SERVICE);
    }

    #[test]
    fn scheme_has_no_separator_characters() {
        // A scheme containing `:` or `/` would produce unparseable deep links.
        assert!(DEEP_LINK_SCHEME
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
    }
}
