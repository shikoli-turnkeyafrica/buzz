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
//!
//! **Multi-pod window.** This deployment runs 5-15 replicas under an HPA
//! (`deploy/charts/buzz/values.yaml`), and every pod spawns its own copy of
//! this cycle on the same interval against the same Postgres. `interval` is
//! threaded down to `emit_checkpoint_for_channel` as a `window_start = now -
//! interval` cutoff: a channel that already has a checkpoint newer than that
//! cutoff is skipped (`Ok(None)`), so concurrent pods converge on at most
//! one checkpoint per channel per window instead of one per pod per tick.
//! The fork-prevention itself (no two checkpoints ever claiming the same
//! `prev`) is enforced one level down, inside
//! `buzz_db::Db::claim_and_store_checkpoint`'s advisory lock — this window
//! check only prevents *redundant* linear chain growth, not forks.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tracing::warn;

use buzz_core::tenant::TenantContext;

use crate::handlers::side_effects::emit_checkpoint_for_channel;
use crate::state::AppState;

/// Emit one completeness checkpoint for every minute-book channel in
/// `tenant`'s community, deduped to at most one per channel per `interval`
/// window (see the module doc comment).
///
/// Best-effort per channel: one channel's emit failure is logged and does
/// not abort the cycle for the rest (mirrors the ephemeral-channel reaper's
/// per-row error handling in `main.rs`). A channel skipped because another
/// caller already claimed its window is not a failure and is not counted.
/// Returns the count of checkpoints this call actually emitted.
pub async fn run_checkpoint_cycle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    interval: Duration,
) -> anyhow::Result<usize> {
    let window_start = Utc::now()
        - chrono::Duration::from_std(interval).unwrap_or_else(|_| chrono::Duration::zero());

    let channel_ids = state
        .db
        .list_minute_book_channel_ids(tenant.community())
        .await?;

    let mut emitted = 0usize;
    for channel_id in channel_ids {
        match emit_checkpoint_for_channel(tenant, state, channel_id, window_start).await {
            Ok(Some(_)) => emitted += 1,
            Ok(None) => {
                // Another caller (this pod's own prior tick, or another pod)
                // already claimed this channel's window. Expected under
                // concurrent emitters, not a failure.
            }
            Err(e) => {
                warn!(channel = %channel_id, error = %e, "checkpoint emit failed");
            }
        }
    }
    Ok(emitted)
}
