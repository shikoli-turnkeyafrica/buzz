//! Read-only calls to the Cybercare Platform for the record panel.
//!
//! Two envelopes come back through the gateway:
//! - agent API (`/api/v2/**`): `{status, data, exceptions[]}`. Upstream 4xx
//!   arrive as HTTP 200 with `status: "EXCEPTION"`, so status is checked.
//! - Platform v1: `{code, data, message}`, lists at `data.all_records`
//!   (a Spring page with `content`, or a bare array when `pageSize=-1`).
//!
//! Every call carries the signed-in person's bearer, so the Platform applies
//! their own permissions. Nothing here writes.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::auth::{access_token, CybercareConfig};

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const V1: &str = "/api/v1/cybota_cloud/cybota_cloud_data_definition";

/// Something with an id and a label: a module, an assessment, a status.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct Named {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EvidenceReview {
    pub id: String,
    pub status: Option<Named>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EvidenceItem {
    /// Evidence definition id: the `evidenceId` the review endpoints take.
    pub id: String,
    pub name: String,
    pub reference: Option<String>,
    pub description: Option<String>,
    /// The Platform's `submitted` flag.
    pub submitted: bool,
    /// The Platform's `reviewed` flag, which means "has files", not
    /// "has been reviewed". Kept for completeness; the panel uses `review`.
    pub has_files: bool,
    pub review: Option<EvidenceReview>,
}

fn text(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    })
}

fn named(value: &Value, name_keys: &[&str]) -> Option<Named> {
    Some(Named {
        id: text(value, &["id"])?,
        name: text(value, name_keys)?,
    })
}

/// Unwraps an agent-API envelope, turning EXCEPTION/ERROR into a sentence.
pub(crate) fn v2_data(body: &str) -> Result<Value, String> {
    let envelope: Value = serde_json::from_str(body)
        .map_err(|error| format!("Cybercare response unreadable: {error}"))?;
    match envelope.get("status").and_then(Value::as_str) {
        Some("SUCCESS") => Ok(envelope.get("data").cloned().unwrap_or(Value::Null)),
        Some(_) => {
            let first = envelope
                .get("exceptions")
                .and_then(Value::as_array)
                .and_then(|list| list.first());
            let message = first
                .and_then(|e| text(e, &["message"]))
                .unwrap_or_else(|| "no reason given".to_owned());
            let code = first.and_then(|e| text(e, &["code"]));
            Err(match code {
                Some(code) => format!("Cybercare refused ({code}): {message}"),
                None => format!("Cybercare refused: {message}"),
            })
        }
        None => Err("Cybercare response had no status".to_owned()),
    }
}

/// The list inside a v1 envelope, whichever of the two list shapes it uses.
pub(crate) fn v1_records(body: &str) -> Result<Vec<Value>, String> {
    let envelope: Value = serde_json::from_str(body)
        .map_err(|error| format!("Cybercare response unreadable: {error}"))?;
    let records = envelope
        .get("data")
        .and_then(|d| d.get("all_records"))
        .ok_or_else(|| "Cybercare response had no records".to_owned())?;
    let list = match records {
        Value::Array(items) => items.clone(),
        other => other
            .get("content")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    };
    Ok(list)
}

pub(crate) fn modules_from(data: &Value) -> Vec<Named> {
    let items = data
        .as_array()
        .cloned()
        .or_else(|| data.get("items").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    items
        .iter()
        .filter_map(|m| named(m, &["name", "moduleName", "alias"]))
        .collect()
}

pub(crate) fn named_list(records: &[Value], name_keys: &[&str]) -> Vec<Named> {
    records.iter().filter_map(|r| named(r, name_keys)).collect()
}

pub(crate) fn evidence_from(data: &Value) -> Vec<EvidenceItem> {
    let items = data
        .as_array()
        .cloned()
        .or_else(|| data.get("items").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    items
        .iter()
        .filter_map(|item| {
            let id = text(item, &["id"])?;
            let review = item
                .get("evidenceReviewEntity")
                .filter(|r| !r.is_null())
                .and_then(|r| {
                    let reviewer = [
                        text(r, &["reviewedByFirstName"]),
                        text(r, &["reviewedByLastName"]),
                    ]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ");
                    Some(EvidenceReview {
                        id: text(r, &["id"])?,
                        status: r
                            .get("reviewStatusEntity")
                            .and_then(|s| named(s, &["name"])),
                        reviewed_by: (!reviewer.is_empty()).then_some(reviewer),
                        reviewed_at: text(r, &["updatedAt", "createdAt"]),
                    })
                });
            Some(EvidenceItem {
                name: text(item, &["name"]).unwrap_or_else(|| id.clone()),
                reference: text(item, &["reference"]),
                description: text(item, &["description"]),
                submitted: item
                    .get("submitted")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                has_files: item
                    .get("reviewed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                review,
                id,
            })
        })
        .collect()
}

fn check_uuid(value: &str, what: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| format!("{what} is not a valid id"))
}

async fn get(
    app_state: &crate::app_state::AppState,
    config: &CybercareConfig,
    community_id: &str,
    path_and_query: &str,
) -> Result<String, String> {
    let url = format!("{}{path_and_query}", config.gateway()?);
    let token = access_token(&app_state.http_client, config, community_id).await?;
    let response = app_state
        .http_client
        .get(url)
        .bearer_auth(token)
        .timeout(HTTP_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("Cybercare unreachable: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Cybercare response unreadable: {error}"))?;
    match status {
        200..=299 => Ok(body),
        401 => Err("Cybercare did not accept your session. Sign out and sign in again.".into()),
        403 => Err("Your Cybercare role does not allow this.".into()),
        _ => Err(format!("Cybercare answered HTTP {status}")),
    }
}

#[tauri::command]
pub(crate) async fn cybercare_modules(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
) -> Result<Vec<Named>, String> {
    let body = get(
        &app_state,
        &config,
        &community_id,
        "/api/v2/modules?pageNumber=0&pageSize=100",
    )
    .await?;
    Ok(modules_from(&v2_data(&body)?))
}

#[tauri::command]
pub(crate) async fn cybercare_assessments(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
    org_id: String,
    module_id: String,
) -> Result<Vec<Named>, String> {
    check_uuid(&org_id, "organisation")?;
    check_uuid(&module_id, "module")?;
    let path = format!(
        "{V1}/risk_assessment/risk_assessment_definition/fetch_all_risk_assessments?pageNumber=0&pageSize=100&sortBy=createdAt&sortOrder=desc&isShort=true&orgId={org_id}&moduleId={module_id}"
    );
    let body = get(&app_state, &config, &community_id, &path).await?;
    Ok(named_list(
        &v1_records(&body)?,
        &["name", "riskAssessmentName", "assessmentName"],
    ))
}

#[tauri::command]
pub(crate) async fn cybercare_review_statuses(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
) -> Result<Vec<Named>, String> {
    let path = format!(
        "{V1}/data_management/review_status/fetch_review_status?pageNumber=0&pageSize=-1&sortBy=name&sortOrder=asc&isShort=true"
    );
    let body = get(&app_state, &config, &community_id, &path).await?;
    Ok(named_list(&v1_records(&body)?, &["name"]))
}

#[tauri::command]
pub(crate) async fn cybercare_evidence(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
    org_id: String,
    module_id: String,
    page_number: Option<u32>,
) -> Result<Vec<EvidenceItem>, String> {
    check_uuid(&org_id, "organisation")?;
    check_uuid(&module_id, "module")?;
    let path = format!(
        "/api/v2/organisations/{org_id}/evidence?moduleId={module_id}&pageNumber={}&pageSize=50",
        page_number.unwrap_or(0)
    );
    let body = get(&app_state, &config, &community_id, &path).await?;
    Ok(evidence_from(&v2_data(&body)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v2_success_returns_data_and_exception_becomes_a_sentence() {
        assert_eq!(
            v2_data(r#"{"status":"SUCCESS","data":[1,2]}"#).unwrap(),
            serde_json::json!([1, 2])
        );
        assert_eq!(
            v2_data(r#"{"status":"EXCEPTION","data":null,"exceptions":[{"code":"PERMISSION_DENIED","message":"You do not have permission"}]}"#)
                .unwrap_err(),
            "Cybercare refused (PERMISSION_DENIED): You do not have permission"
        );
        assert!(v2_data("<html>").is_err());
        assert!(v2_data(r#"{"data":[]}"#).is_err());
    }

    #[test]
    fn v1_records_read_both_list_shapes() {
        let paged = r#"{"code":200,"data":{"all_records":{"content":[{"id":"a","name":"Verified"}],"totalElements":1}}}"#;
        let bare = r#"{"code":200,"data":{"all_records":[{"id":"b","name":"Rejected"}]}}"#;
        assert_eq!(
            named_list(&v1_records(paged).unwrap(), &["name"])[0].name,
            "Verified"
        );
        assert_eq!(named_list(&v1_records(bare).unwrap(), &["name"])[0].id, "b");
        assert!(v1_records(r#"{"code":200,"data":"oops"}"#).is_err());
    }

    #[test]
    fn named_skips_items_without_id_or_label_and_uses_fallback_keys() {
        let records = vec![
            serde_json::json!({"id":"1","riskAssessmentName":"Q3 2026"}),
            serde_json::json!({"id":"2"}),
            serde_json::json!({"name":"no id"}),
        ];
        let list = named_list(&records, &["name", "riskAssessmentName"]);
        assert_eq!(
            list,
            vec![Named {
                id: "1".into(),
                name: "Q3 2026".into()
            }]
        );
    }

    #[test]
    fn evidence_maps_the_review_and_the_misnamed_reviewed_flag() {
        let data = serde_json::json!([
            {
                "id": "ev-1", "name": "Vault change ticket", "reference": "AC-2",
                "submitted": true, "reviewed": true,
                "evidenceReviewEntity": {
                    "id": "rev-9", "updatedAt": "2026-09-29T10:02:00",
                    "reviewedByFirstName": "Wanjiru", "reviewedByLastName": "Kamau",
                    "reviewStatusEntity": {"id": "st-1", "name": "Verified"}
                }
            },
            { "id": "ev-2", "name": "PAM policy", "submitted": true, "reviewed": false, "evidenceReviewEntity": null }
        ]);
        let items = evidence_from(&data);
        assert_eq!(items.len(), 2);
        let reviewed = items[0].review.as_ref().unwrap();
        assert_eq!(reviewed.reviewed_by.as_deref(), Some("Wanjiru Kamau"));
        assert_eq!(reviewed.status.as_ref().unwrap().name, "Verified");
        assert!(items[0].has_files);
        assert!(items[1].review.is_none());
    }

    #[test]
    fn modules_accept_a_bare_list_or_an_items_wrapper() {
        let bare = serde_json::json!([{"id":"m1","name":"Riskcare"}]);
        let wrapped = serde_json::json!({"items":[{"id":"m2","moduleName":"Vulncare"}],"count":1});
        assert_eq!(modules_from(&bare)[0].name, "Riskcare");
        assert_eq!(modules_from(&wrapped)[0].name, "Vulncare");
    }

    #[test]
    fn ids_are_checked_before_they_reach_a_url() {
        assert!(check_uuid("cb000000-0000-0000-0000-000000000001", "organisation").is_ok());
        assert!(check_uuid("x&moduleId=y", "organisation").is_err());
    }
}
