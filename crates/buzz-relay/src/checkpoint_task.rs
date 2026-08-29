//! Buzz rung 3 — periodic completeness-checkpoint cycle.
//!
//! One cycle emits a relay-signed `KIND_CYBOTA_CHECKPOINT` (46220,
//! `emit_checkpoint_for_channel` in `handlers::side_effects`) for every
//! minute-book channel in the deployment's community. A channel that has
//! never been latched via `set_minute_book` (`buzz_db::channel`) is never
//! included — scope is exactly `Db::list_minute_book_channel_ids`.
//!
//! Spawned on an interval from `main.rs`, gated behind
//! `BUZZ_CHECKPOINT_INTERVAL_SECS` (unset or `0` ⇒ the feature is off,
//! mirroring the other optional background tasks — the NIP-43 membership
//! reconciler and the storage sweep).

use std::sync::Arc;

use tracing::warn;

use buzz_core::tenant::TenantContext;

use crate::handlers::side_effects::emit_checkpoint_for_channel;
use crate::state::AppState;

/// Emit one completeness checkpoint for every minute-book channel in
/// `tenant`'s community.
///
/// Best-effort per channel: one channel's emit failure is logged and does
/// not abort the cycle for the rest (mirrors the ephemeral-channel reaper's
/// per-row error handling in `main.rs`). Returns the count of checkpoints
/// successfully emitted.
pub async fn run_checkpoint_cycle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
) -> anyhow::Result<usize> {
    let channel_ids = state
        .db
        .list_minute_book_channel_ids(tenant.community())
        .await?;

    let mut emitted = 0usize;
    for channel_id in channel_ids {
        match emit_checkpoint_for_channel(tenant, state, channel_id).await {
            Ok(_) => emitted += 1,
            Err(e) => {
                warn!(channel = %channel_id, error = %e, "checkpoint emit failed");
            }
        }
    }
    Ok(emitted)
}
