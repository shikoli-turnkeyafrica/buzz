import * as React from "react";

import type { PanelValueSetter } from "./useChannelPanelHistoryState";

/**
 * Open/close handlers for the Cybercare Records panel. Opening it closes the
 * other right-hand panels, as opening channel management does. `toggle` is
 * undefined when the community has no Cybercare connection.
 */
export function useRecordsPanelToggle(
  recordsOpen: boolean,
  setRecordsOpen: (open: boolean) => void,
  others: {
    enabled: boolean;
    closeThread: () => void;
    closeAgentSession: () => void;
    setProfilePanelPubkey: PanelValueSetter;
    setChannelManagementOpen: (open: boolean) => void;
  },
) {
  const {
    enabled,
    closeThread,
    closeAgentSession,
    setProfilePanelPubkey,
    setChannelManagementOpen,
  } = others;
  const toggle = React.useCallback(() => {
    if (!recordsOpen) {
      closeThread();
      closeAgentSession();
      setProfilePanelPubkey(null);
      setChannelManagementOpen(false);
    }
    setRecordsOpen(!recordsOpen);
  }, [
    recordsOpen,
    setRecordsOpen,
    closeThread,
    closeAgentSession,
    setProfilePanelPubkey,
    setChannelManagementOpen,
  ]);
  const close = React.useCallback(
    () => setRecordsOpen(false),
    [setRecordsOpen],
  );
  return { close, toggle: enabled ? toggle : undefined };
}
