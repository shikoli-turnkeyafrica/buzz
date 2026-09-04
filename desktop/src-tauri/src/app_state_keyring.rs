use crate::brand;

/// Service name for the desktop OS keyring. Debug builds default to a distinct
/// service, while standalone worktree launches may request a scoped dev service.
///
/// Deliberately NOT derived from `brand::KEYRING_SERVICE`: the literal
/// `buzz-desktop-dev` name is hardcoded across six dev-tooling surfaces
/// (`managed_agents/storage.rs`, `scripts/instance-env.sh`,
/// `scripts/reset-desktop-standalone-state.sh`,
/// `scripts/test-reset-desktop-standalone-state.sh`,
/// `scripts/reset-desktop-dev-state.sh`, `scripts/buzz-adopt-prod-agents.sh`)
/// plus the Justfile's assigned env var value. Rebranding it here without
/// touching those six surfaces would silently disable debug-only agent-key
/// migration and break per-worktree dev keyring scoping. Only the release
/// service is rebranded; the dev name stays `buzz-desktop-dev` until those
/// surfaces are migrated together.
fn dev_keyring_service(configured: Option<String>) -> String {
    configured
        .filter(|service| service.starts_with("buzz-desktop-dev."))
        .unwrap_or_else(|| "buzz-desktop-dev".to_string())
}

pub(crate) fn keyring_service() -> &'static str {
    if cfg!(debug_assertions) {
        static DEV_SERVICE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        DEV_SERVICE
            .get_or_init(|| {
                // Dev-only override; no sidecar reads this name, so unlike the
                // BUZZ_* runtime variables it is safe to rebrand.
                dev_keyring_service(std::env::var("CYBERCARE_DEV_KEYRING_SERVICE").ok())
            })
            .as_str()
    } else {
        brand::KEYRING_SERVICE
    }
}

pub(super) fn migration_marker_name(service: &str, default_name: &str) -> String {
    // `default_name` covers both the release service (the rebranded
    // `brand::KEYRING_SERVICE`, so an install migrated from Buzz still
    // counts its existing marker under the same filename) and the
    // deliberately-unbranded dev service (`buzz-desktop-dev`, see
    // `dev_keyring_service` above).
    if service == brand::KEYRING_SERVICE || service == "buzz-desktop-dev" {
        default_name.to_string()
    } else {
        format!("identity.{service}.migrated")
    }
}

#[cfg(test)]
mod tests {
    use super::{dev_keyring_service, migration_marker_name};

    #[test]
    fn standalone_scope_must_remain_under_dev_service() {
        assert_eq!(
            dev_keyring_service(Some("buzz-desktop-dev.example".to_string())),
            "buzz-desktop-dev.example"
        );
        // A configured value outside the dev namespace is rejected: a dev
        // build must never write to the release service.
        assert_eq!(
            dev_keyring_service(Some("cybercare-commons".to_string())),
            "buzz-desktop-dev"
        );
        assert_eq!(dev_keyring_service(None), "buzz-desktop-dev");
    }

    #[test]
    fn marker_name_is_default_for_first_party_services() {
        assert_eq!(
            migration_marker_name("cybercare-commons", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("buzz-desktop-dev", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("buzz-desktop-dev.branch", "identity.migrated"),
            "identity.buzz-desktop-dev.branch.migrated"
        );
    }
}
