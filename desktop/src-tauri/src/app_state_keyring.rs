use crate::brand;

/// Service name for the desktop OS keyring. Debug builds default to a distinct
/// service, while standalone worktree launches may request a scoped dev service.
fn dev_keyring_service(configured: Option<String>) -> String {
    let dev_prefix = format!("{}-dev.", brand::KEYRING_SERVICE);
    configured
        .filter(|service| service.starts_with(&dev_prefix))
        .unwrap_or_else(|| format!("{}-dev", brand::KEYRING_SERVICE))
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
    let dev_service = format!("{}-dev", brand::KEYRING_SERVICE);
    if service == brand::KEYRING_SERVICE || service == dev_service {
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
            dev_keyring_service(Some("cybercare-commons-dev.example".to_string())),
            "cybercare-commons-dev.example"
        );
        // A configured value outside the dev namespace is rejected: a dev
        // build must never write to the release service.
        assert_eq!(
            dev_keyring_service(Some("cybercare-commons".to_string())),
            "cybercare-commons-dev"
        );
        assert_eq!(dev_keyring_service(None), "cybercare-commons-dev");
    }

    #[test]
    fn marker_name_is_default_for_first_party_services() {
        assert_eq!(
            migration_marker_name("cybercare-commons", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("cybercare-commons-dev", "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("cybercare-commons-dev.branch", "identity.migrated"),
            "identity.cybercare-commons-dev.branch.migrated"
        );
    }
}
