import { useQuery } from "@tanstack/react-query";

import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import { getCybercareSession, listCybercareEvidence } from "./cybercareApi";
import {
  type EvidenceTask,
  type MyTask,
  openProposals,
  type TaskEvent,
} from "./myTasks";
import { KIND_CYBOTA_PROPOSAL } from "./proposal";
import { KIND_CYBOTA_RATIFICATION } from "./ratification";
import { readRoomBinding } from "./roomBinding";

const LOOKBACK_SECONDS = 60 * 24 * 60 * 60;

/**
 * Everything waiting on me in this community: proposals nobody has decided
 * yet and evidence awaiting review, both only in channels that have an
 * assessment chosen (the channels doing Cybercare work), and only for
 * communities connected to Cybercare. Proposals come from the relay every
 * minute; evidence comes from Cybercare every five minutes. `fresh` makes a
 * screen that shows the list ask again when it opens instead of reusing the
 * sidebar's answer.
 */
export function useMyTasks(options?: { fresh?: boolean }) {
  const { activeCommunity } = useCommunities();
  const config = activeCommunity?.cybercare;
  const communityId = activeCommunity?.id ?? null;
  const identity = useIdentityQuery();
  const me = identity.data?.pubkey ?? null;
  const channelsQuery = useChannelsQuery({ enabled: Boolean(config) });
  const boundIds = (channelsQuery.data ?? [])
    .filter((c) => c.isMember && !c.archivedAt)
    .filter((c) => communityId && readRoomBinding(communityId, c.id))
    .map((c) => c.id)
    .sort();
  const key = boundIds.join(",");
  const enabled = Boolean(config && communityId && boundIds.length > 0);

  const proposals = useQuery({
    queryKey: ["cybercare-my-proposals", communityId, me, key],
    enabled,
    refetchInterval: 60_000,
    staleTime: options?.fresh ? 0 : 30_000,
    queryFn: async (): Promise<MyTask[]> => {
      const events = (await relayClient.fetchEvents({
        kinds: [KIND_CYBOTA_PROPOSAL, KIND_CYBOTA_RATIFICATION],
        "#h": boundIds,
        since: Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS,
        limit: 500,
      })) as unknown as TaskEvent[];
      return openProposals(events, me);
    },
  });

  const evidence = useQuery({
    queryKey: ["cybercare-my-evidence", communityId, key],
    enabled,
    refetchInterval: 5 * 60_000,
    staleTime: options?.fresh ? 0 : 4 * 60_000,
    queryFn: async (): Promise<EvidenceTask[]> => {
      if (!config || !communityId) return [];
      const session = await getCybercareSession(communityId).catch(() => null);
      if (!session) return [];
      const found = await Promise.all(
        boundIds.map(async (channelId): Promise<EvidenceTask | null> => {
          const binding = readRoomBinding(communityId, channelId);
          if (!binding) return null;
          const items = await listCybercareEvidence(
            communityId,
            config,
            binding.orgId,
            binding.moduleId,
          ).catch(() => null);
          const awaiting = items?.filter((i) => !i.review).length ?? 0;
          return awaiting > 0
            ? {
                kind: "evidence",
                channelId,
                assessmentName: binding.assessmentName,
                awaiting,
              }
            : null;
        }),
      );
      return found.filter((t): t is EvidenceTask => t !== null);
    },
  });

  return {
    data:
      proposals.data || evidence.data
        ? [...(proposals.data ?? []), ...(evidence.data ?? [])]
        : undefined,
    isLoading: proposals.isLoading || evidence.isLoading,
    isError: proposals.isError && evidence.isError,
    isFetching: proposals.isFetching || evidence.isFetching,
    refetch: async () => {
      await Promise.all([proposals.refetch(), evidence.refetch()]);
    },
  };
}
