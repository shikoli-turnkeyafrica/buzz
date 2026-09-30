//! Binds this app's signing key to the signed-in Cybercare identity.
//!
//! sherpa-ai issues a single-use challenge for (Keycloak subject, org); the
//! app signs it as a kind-27235 event with the same key it signs rulings
//! with; sherpa-ai verifies the signature, the challenge and the timestamp,
//! and records the binding. Every call goes through the Cybercare gateway
//! with the Keycloak bearer, so the subject comes from the token, never from
//! anything this app says.

use std::time::Duration;

use nostr::{EventBuilder, JsonUtil, Kind};
use serde::{Deserialize, Serialize};

use super::auth::{access_token, CybercareConfig};

/// Kind sherpa-ai expects for an enrollment proof (NIP-98's HTTP-auth kind).
pub(crate) const KIND_ENROLLMENT_PROOF: u16 = 27235;
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Binding {
    #[serde(alias = "commons_pubkey")]
    pub commons_pubkey: String,
    #[serde(alias = "enrolled_at")]
    pub enrolled_at: String,
    #[serde(alias = "enrolled_via")]
    pub enrolled_via: String,
}

#[derive(Debug, Deserialize)]
struct MeResponse {
    enrolled: bool,
    binding: Option<Binding>,
}

#[derive(Debug, Deserialize)]
struct ChallengeResponse {
    challenge: String,
}

#[derive(Debug, Deserialize)]
struct EnrollResponse {
    binding: Binding,
}

#[derive(Debug, Deserialize)]
struct DetailBody {
    detail: serde_json::Value,
}

/// What the webview sees about the binding for one organisation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityStatus {
    pub enrolled: bool,
    pub binding: Option<Binding>,
    /// True when the bound key is this app's key. False with `enrolled`
    /// means the person enrolled a different key (another device or the
    /// browser extension) and this app cannot sign as them yet.
    pub is_this_key: bool,
}

pub(crate) fn identity_url(gateway: &str, action: &str, org_id: &str) -> Result<String, String> {
    if !matches!(action, "me" | "challenge" | "enroll" | "revoke") {
        return Err("unknown identity action".to_owned());
    }
    uuid::Uuid::parse_str(org_id).map_err(|_| "organisation id is not a UUID".to_owned())?;
    Ok(format!(
        "{gateway}/api/v1/cybota_cloud/sherpa/api/identity/{action}?org_id={org_id}"
    ))
}

/// Maps a non-success response to a sentence a person can act on.
pub(crate) fn identity_error(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<DetailBody>(body)
        .ok()
        .map(|d| match d.detail {
            serde_json::Value::String(text) => text,
            other => other.to_string(),
        });
    match status {
        401 => "Cybercare did not accept your session. Sign out and sign in again; if it persists, the gateway may not trust this sign-in server.".to_owned(),
        403 => "Your Cybercare account is not allowed to register a device here.".to_owned(),
        409 => detail.unwrap_or_else(|| "Another device is already registered to this account.".to_owned()),
        422 => format!(
            "Cybercare rejected the proof: {}",
            detail.unwrap_or_else(|| "no reason given".to_owned())
        ),
        _ => format!(
            "Cybercare identity service answered HTTP {status}{}",
            detail.map(|d| format!(": {d}")).unwrap_or_default()
        ),
    }
}

pub(crate) fn status_from(me: MeResponseView, own_pubkey: &str) -> IdentityStatus {
    let is_this_key = me
        .binding
        .as_ref()
        .is_some_and(|b| b.commons_pubkey.eq_ignore_ascii_case(own_pubkey));
    IdentityStatus {
        enrolled: me.enrolled,
        binding: me.binding,
        is_this_key,
    }
}

/// Test seam over `MeResponse` without exposing the private wire type.
pub(crate) struct MeResponseView {
    pub enrolled: bool,
    pub binding: Option<Binding>,
}

async fn send(request: reqwest::RequestBuilder) -> Result<String, String> {
    let response = request
        .timeout(HTTP_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("Cybercare unreachable: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Cybercare response unreadable: {error}"))?;
    if (200..300).contains(&status) {
        Ok(body)
    } else {
        Err(identity_error(status, &body))
    }
}

#[tauri::command]
pub(crate) async fn cybercare_identity(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
    org_id: String,
) -> Result<IdentityStatus, String> {
    let url = identity_url(&config.gateway()?, "me", &org_id)?;
    let token = access_token(&app_state.http_client, &config, &community_id).await?;
    let body = send(app_state.http_client.get(url).bearer_auth(token)).await?;
    let me: MeResponse = serde_json::from_str(&body)
        .map_err(|error| format!("identity response unreadable: {error}"))?;
    let own = app_state.signing_keys()?.public_key().to_hex();
    Ok(status_from(
        MeResponseView {
            enrolled: me.enrolled,
            binding: me.binding,
        },
        &own,
    ))
}

/// Links this app's key. With `replace_existing`, first revokes whatever key
/// is linked now (Cybercare's rotation is revoke-then-enroll). The proof is
/// signed before the revoke so the unlinked gap is one request long.
#[tauri::command]
pub(crate) async fn cybercare_enrol(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
    org_id: String,
    replace_existing: Option<bool>,
) -> Result<IdentityStatus, String> {
    let gateway = config.gateway()?;
    let token = access_token(&app_state.http_client, &config, &community_id).await?;
    let keys = app_state.signing_keys()?;

    let body = send(
        app_state
            .http_client
            .post(identity_url(&gateway, "challenge", &org_id)?)
            .bearer_auth(&token),
    )
    .await?;
    let challenge: ChallengeResponse = serde_json::from_str(&body)
        .map_err(|error| format!("challenge response unreadable: {error}"))?;

    let proof = tauri::async_runtime::spawn_blocking(move || {
        EventBuilder::new(Kind::Custom(KIND_ENROLLMENT_PROOF), challenge.challenge)
            .sign_with_keys(&keys)
            .map_err(|error| format!("could not sign the proof: {error}"))
    })
    .await
    .map_err(|error| format!("signing task failed: {error}"))??;
    let own = proof.pubkey.to_hex();
    let proof_json: serde_json::Value = serde_json::from_str(&proof.as_json())
        .map_err(|error| format!("proof serialisation failed: {error}"))?;

    if replace_existing.unwrap_or(false) {
        let revoked = send(
            app_state
                .http_client
                .post(identity_url(&gateway, "revoke", &org_id)?)
                .bearer_auth(&token),
        )
        .await;
        // Nothing linked any more (404) is fine: the goal is an empty slot.
        if let Err(error) = revoked {
            if !error.contains("HTTP 404") {
                return Err(format!("Couldn't unregister the other device: {error}"));
            }
        }
    }

    let body = send(
        app_state
            .http_client
            .post(identity_url(&gateway, "enroll", &org_id)?)
            .bearer_auth(&token)
            .json(&serde_json::json!({ "event": proof_json })),
    )
    .await
    .map_err(|error| {
        if replace_existing.unwrap_or(false) {
            format!("{error} The other device was unregistered; register this device again.")
        } else {
            error
        }
    })?;
    let enrolled: EnrollResponse = serde_json::from_str(&body)
        .map_err(|error| format!("enroll response unreadable: {error}"))?;
    if !enrolled.binding.commons_pubkey.eq_ignore_ascii_case(&own) {
        return Err("Cybercare registered a different device than this one".into());
    }
    Ok(status_from(
        MeResponseView {
            enrolled: true,
            binding: Some(enrolled.binding),
        },
        &own,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORG: &str = "cb000000-0000-0000-0000-000000000001";

    #[test]
    fn identity_urls_go_through_the_gateway_sherpa_route() {
        assert_eq!(
            identity_url("http://127.0.0.1:8100", "challenge", ORG).unwrap(),
            "http://127.0.0.1:8100/api/v1/cybota_cloud/sherpa/api/identity/challenge?org_id=cb000000-0000-0000-0000-000000000001"
        );
    }

    #[test]
    fn a_missing_link_reads_as_http_404_for_replace() {
        // cybercare_enrol treats this as "nothing to revoke" when replacing.
        assert!(identity_error(404, r#"{"detail":"No active enrollment"}"#).contains("HTTP 404"));
    }

    #[test]
    fn identity_urls_refuse_odd_actions_and_non_uuid_orgs() {
        assert!(identity_url("http://g", "delete", ORG).is_err());
        assert!(identity_url("http://g", "me", "cb00&x=1").is_err());
    }

    #[test]
    fn gateway_is_required_and_trimmed() {
        let mut config = CybercareConfig {
            base_url: None,
            keycloak_url: "http://kc/auth".into(),
            realm: "cybota".into(),
            client_id: None,
        };
        assert!(config.gateway().is_err());
        config.base_url = Some(" http://127.0.0.1:8100/ ".into());
        assert_eq!(config.gateway().unwrap(), "http://127.0.0.1:8100");
        config.base_url = Some("javascript:alert(1)".into());
        assert!(config.gateway().is_err());
    }

    #[test]
    fn errors_use_sherpa_detail_and_plain_words() {
        assert!(identity_error(401, "").contains("sign in again"));
        assert_eq!(
            identity_error(
                422,
                r#"{"detail":"challenge unknown, expired, or already used"}"#
            ),
            "Cybercare rejected the proof: challenge unknown, expired, or already used"
        );
        assert_eq!(
            identity_error(409, r#"{"detail":"active binding exists"}"#),
            "active binding exists"
        );
        assert!(identity_error(502, "<html>")
            .starts_with("Cybercare identity service answered HTTP 502"));
    }

    #[test]
    fn binding_reads_sherpa_snake_case() {
        let me: MeResponse = serde_json::from_str(
            r#"{"enrolled":true,"binding":{"id":"x","principal_type":"owner","commons_pubkey":"AB12","enrolled_via":"nip07-browser","enrolled_at":"2026-09-29","admission_event_id":null},"commons":null}"#,
        )
        .unwrap();
        let status = status_from(
            MeResponseView {
                enrolled: me.enrolled,
                binding: me.binding,
            },
            "ab12",
        );
        assert!(status.enrolled);
        assert!(status.is_this_key);
    }

    #[test]
    fn a_binding_to_another_key_is_reported_as_not_this_key() {
        let status = status_from(
            MeResponseView {
                enrolled: true,
                binding: Some(Binding {
                    commons_pubkey: "ffff".into(),
                    enrolled_at: "t".into(),
                    enrolled_via: "nip07-browser".into(),
                }),
            },
            "abcd",
        );
        assert!(status.enrolled);
        assert!(!status.is_this_key);
    }
}
