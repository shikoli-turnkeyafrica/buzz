-- Per-channel governance policy, keyed to the channel it governs.
-- Deleted alongside the channel via the FK to channels (community_id, id).
CREATE TABLE channel_governance_policy (
    community_id UUID NOT NULL,
    channel_id   UUID NOT NULL,
    policy       JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id, channel_id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels (community_id, id)
);

SELECT attach_community_write_fence('channel_governance_policy');
