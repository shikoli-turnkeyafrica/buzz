//! The organisation's evidence of record, from Cybercare's graph
//! (`evidence_node`), and a reviewer's decision on one item. A review decision
//! is not an integrity check: whether Cybercare holds the file
//! (`verificationStatus`, `hasArtefact`) is shown alongside and never changed
//! here. The signed decision's event id is what Cybercare records.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::auth::{access_token, CybercareConfig};
use super::decisions::check_event_id;
use super::platform::{check_uuid, v2_data};

const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedControl {
    pub control_code: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphReview {
    pub review_id: String,
    pub decision: String,
    pub approver: Option<String>,
    pub decided_at: Option<String>,
    pub rationale: Option<String>,
    pub commons_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphEvidence {
    pub evidence_id: String,
    pub evidence_code: String,
    pub title: String,
    pub evidence_type: Option<String>,
    pub verification_status: Option<String>,
    pub source: Option<String>,
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
    #[serde(default)]
    pub has_artefact: bool,
    #[serde(default)]
    pub controls: Vec<LinkedControl>,
    pub review: Option<GraphReview>,
}

/// Items from the agent API's list; rows that don't parse are skipped rather
/// than failing the whole panel.
pub(crate) fn evidence_from(data: &Value) -> Vec<GraphEvidence> {
    data.as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordedGraphReview {
    pub review_id: String,
    pub decision: String,
    pub approver: Option<String>,
    pub already_decided: bool,
}

pub(crate) fn recorded_from(data: &Value) -> Result<RecordedGraphReview, String> {
    let text = |key: &str| data.get(key).and_then(Value::as_str).map(str::to_owned);
    Ok(RecordedGraphReview {
        review_id: text("reviewId").ok_or("Cybercare did not return the review")?,
        decision: text("decision").unwrap_or_default(),
        approver: text("approver"),
        already_decided: data
            .get("alreadyDecided")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

async fn send(request: reqwest::RequestBuilder, what: &str) -> Result<Value, String> {
    let response = request
        .timeout(HTTP_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("Cybercare unreachable: {error}"))?;
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    match status {
        200..=299 => v2_data(&body),
        401 => Err("Cybercare did not accept your session. Sign out and sign in again.".into()),
        403 => Err(format!("Your Cybercare role does not allow {what}.")),
        _ => v2_data(&body).and(Err(format!("Cybercare answered HTTP {status}"))),
    }
}

/// The organisation's graph evidence with linked controls and latest review.
#[tauri::command]
pub(crate) async fn cybercare_graph_evidence(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
    org_id: String,
) -> Result<Vec<GraphEvidence>, String> {
    check_uuid(&org_id, "organisation")?;
    let url = format!("{}/api/v2/evidence-node?orgId={org_id}", config.gateway()?);
    let token = access_token(&app_state.http_client, &config, &community_id).await?;
    let data = send(
        app_state.http_client.get(url).bearer_auth(token),
        "reading evidence",
    )
    .await?;
    Ok(evidence_from(&data))
}

/// Records a reviewer's decision on one graph evidence item, citing the
/// signed decision's event id. Cybercare takes the reviewer from the session.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn cybercare_review_graph_evidence(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
    org_id: String,
    evidence_id: String,
    approve: bool,
    commons_event_id: String,
    rationale: Option<String>,
) -> Result<RecordedGraphReview, String> {
    check_uuid(&org_id, "organisation")?;
    check_uuid(&evidence_id, "evidence")?;
    check_event_id(&commons_event_id)?;
    let url = format!("{}/api/v2/evidence-node/review", config.gateway()?);
    let token = access_token(&app_state.http_client, &config, &community_id).await?;
    let data = send(
        app_state
            .http_client
            .post(url)
            .bearer_auth(token)
            .json(&serde_json::json!({
                "orgId": org_id,
                "evidenceId": evidence_id,
                "decision": if approve { "approved" } else { "rejected" },
                "commonsEventId": commons_event_id,
                "rationale": rationale.filter(|r| !r.trim().is_empty()),
            })),
        "reviewing evidence (needs Assessment Management - Write)",
    )
    .await?;
    recorded_from(&data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evidence_list_reads_items_controls_and_review() {
        let data = serde_json::json!([
            {
                "evidenceId": "e1", "evidenceCode": "EVID-2025-014",
                "title": "CBK on-site cyber inspection report — H2 2025",
                "evidenceType": "audit_report", "verificationStatus": "metadata_only",
                "source": "audit_artefact", "hasArtefact": false,
                "controls": [{"controlCode": "RORG-01", "name": "Risk Management"}],
                "review": null
            },
            {
                "evidenceId": "e2", "evidenceCode": "EVID-2025-001", "title": "ISO cert",
                "verificationStatus": "verified", "hasArtefact": true, "controls": [],
                "review": {"reviewId": "r1", "decision": "approved", "approver": "CISO",
                           "commonsEventId": "ab"}
            },
            {"title": "missing ids"}
        ]);
        let items = evidence_from(&data);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].controls[0].control_code, "RORG-01");
        assert!(!items[0].has_artefact && items[0].review.is_none());
        assert_eq!(items[1].review.as_ref().unwrap().decision, "approved");
    }

    #[test]
    fn recorded_review_needs_an_id() {
        let ok = recorded_from(&serde_json::json!({
            "reviewId": "r9", "decision": "rejected", "approver": "CISO", "alreadyDecided": true
        }))
        .unwrap();
        assert!(ok.already_decided);
        assert_eq!(ok.decision, "rejected");
        assert!(recorded_from(&serde_json::json!({})).is_err());
    }
}
