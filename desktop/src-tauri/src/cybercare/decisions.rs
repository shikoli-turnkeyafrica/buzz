//! Tells Cybercare which signed decision approved (or rejected) the
//! remediation actions an agent proposed. The signature in the channel is the
//! approval; Cybercare records its event id as `curatorApprovalId` and only
//! then opens the action (Gemini G3).

use serde::Serialize;

use super::auth::{access_token, CybercareConfig};
use super::platform::{check_uuid, v2_data};

const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// What Cybercare said about one action.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionOutcome {
    pub action_id: String,
    pub ok: bool,
    pub message: Option<String>,
}

/// A 64-char lowercase hex event id, the only shape Cybercare accepts.
pub(crate) fn check_event_id(value: &str) -> Result<(), String> {
    if value.len() == 64
        && value
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    {
        Ok(())
    } else {
        Err("decision id is not a valid event id".to_owned())
    }
}

pub(crate) fn decision_path(approve: bool) -> &'static str {
    if approve {
        "/api/v2/remediation-action/approve"
    } else {
        "/api/v2/remediation-action/reject"
    }
}

pub(crate) fn outcome_from(action_id: &str, status: u16, body: &str) -> ActionOutcome {
    let result = match status {
        200..=299 => v2_data(body).map(|_| ()),
        401 => Err("Cybercare did not accept your session. Sign out and sign in again.".into()),
        403 => Err("Your Cybercare role does not allow approving actions.".into()),
        409 => Err("Cybercare already recorded a different decision for this action.".into()),
        _ => v2_data(body)
            .map(|_| ())
            .and(Err(format!("Cybercare answered HTTP {status}"))),
    };
    ActionOutcome {
        action_id: action_id.to_owned(),
        ok: result.is_ok(),
        message: result.err(),
    }
}

/// Records one decision against each proposed action. Every action is tried;
/// the caller shows which ones Cybercare refused and can retry them.
#[tauri::command]
pub(crate) async fn cybercare_record_decision(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
    org_id: Option<String>,
    action_ids: Vec<String>,
    decision_event_id: String,
    approve: bool,
) -> Result<Vec<ActionOutcome>, String> {
    check_event_id(&decision_event_id)?;
    if let Some(id) = &org_id {
        check_uuid(id, "organisation")?;
    }
    for id in &action_ids {
        check_uuid(id, "action")?;
    }
    let url = format!("{}{}", config.gateway()?, decision_path(approve));
    let token = access_token(&app_state.http_client, &config, &community_id).await?;
    let mut outcomes = Vec::with_capacity(action_ids.len());
    for action_id in action_ids {
        let sent = app_state
            .http_client
            .post(&url)
            .bearer_auth(&token)
            .json(&serde_json::json!({
                "actionId": action_id,
                "curatorApprovalId": decision_event_id,
                // Limits the decision to the proposal's organisation.
                "orgId": org_id,
            }))
            .timeout(HTTP_TIMEOUT)
            .send()
            .await;
        let outcome = match sent {
            Err(error) => ActionOutcome {
                action_id: action_id.clone(),
                ok: false,
                message: Some(format!("Cybercare unreachable: {error}")),
            },
            Ok(response) => {
                let status = response.status().as_u16();
                let body = response.text().await.unwrap_or_default();
                outcome_from(&action_id, status, &body)
            }
        };
        outcomes.push(outcome);
    }
    Ok(outcomes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "b0c5193d0361e461622ad75cb439079d5bdd27addad4a9aa86267f9773fc966f";

    #[test]
    fn decision_ids_must_be_lowercase_event_ids() {
        assert!(check_event_id(ID).is_ok());
        assert!(check_event_id(&ID.to_uppercase()).is_err());
        assert!(check_event_id("abc").is_err());
    }

    #[test]
    fn approve_and_reject_use_their_own_paths() {
        assert!(decision_path(true).ends_with("/approve"));
        assert!(decision_path(false).ends_with("/reject"));
    }

    #[test]
    fn outcomes_read_the_agent_api_envelope() {
        let ok = outcome_from("a", 200, r#"{"status":"SUCCESS","data":{"status":"open"}}"#);
        assert!(ok.ok && ok.message.is_none());

        let refused = outcome_from(
            "a",
            200,
            r#"{"status":"EXCEPTION","exceptions":[{"code":"400","message":"action is not awaiting approval"}]}"#,
        );
        assert!(!refused.ok);
        assert!(refused
            .message
            .unwrap()
            .contains("action is not awaiting approval"));

        let conflict = outcome_from("a", 409, "");
        assert!(conflict.message.unwrap().contains("different decision"));

        let gateway = outcome_from("a", 401, "");
        assert!(gateway.message.unwrap().contains("sign in again"));
    }
}
