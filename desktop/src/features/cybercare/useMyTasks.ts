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
 * yet, and evidence awaiting review in channels that have an assessment.
 * Only for communities connected to Cybercare. `fresh` makes a screen that
 * shows the list ask again when it opens instead of reusing the sidebar's
 * answer.
 */
export function useMyTasks(options?: { fresh?: boolean }) {
  const { activeCommunity } = useCommunities();
  const config = activeCommunity?.cybercare;
  const communityId = activeCommunity?.id ?? null;
  const identity = useIdentityQuery();
  const me = identity.data?.pubkey ?? null;
  const channelsQuery = useChannelsQuery({ enabled: Boolean(config) });
  const channels = (channelsQuery.data ?? []).filter(
    (c) => c.isMember && !c.archivedAt,
  );
  const channelIds = channels.map((c) => c.id).sort();

  return useQuery({
    queryKey: ["cybercare-my-tasks", communityId, me, channelIds.join(",")],
    enabled: Boolean(config && communityId && channelIds.length > 0),
    refetchInterval: 60_000,
    staleTime: options?.fresh ? 0 : 30_000,
    queryFn: async (): Promise<MyTask[]> => {
      const events = (await relayClient.fetchEvents({
        kinds: [KIND_CYBOTA_PROPOSAL, KIND_CYBOTA_RATIFICATION],
        "#h": channelIds,
        since: Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS,
        limit: 500,
      })) as unknown as TaskEvent[];
      const tasks: MyTask[] = openProposals(events, me);

      if (!config || !communityId) return tasks;
      const session = await getCybercareSession(communityId).catch(() => null);
      if (!session) return tasks;
      const evidence = await Promise.all(
        channelIds.map(async (channelId): Promise<EvidenceTask | null> => {
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
      return [
        ...tasks,
        ...evidence.filter((t): t is EvidenceTask => t !== null),
      ];
    },
  });
}
