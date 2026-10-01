import type { ReactNode } from "react";
import { FileText, Gavel, LoaderCircle, RefreshCw } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/PageHeader";
import type { MyTask } from "../myTasks";
import { useMyTasks } from "../useMyTasks";

function age(createdAt: number) {
  const days = Math.floor((Date.now() / 1000 - createdAt) / 86_400);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * What is waiting on me: agents' proposals nobody has decided yet, and
 * evidence awaiting review in channels that have an assessment.
 */
export function MyTasksScreen() {
  const { activeCommunity } = useCommunities();
  const { goChannel } = useAppNavigation();
  const tasksQuery = useMyTasks({ fresh: true });
  const channelsQuery = useChannelsQuery();
  const channelName = (id: string) =>
    channelsQuery.data?.find((c) => c.id === id)?.name ?? "a channel";
  const tasks = tasksQuery.data ?? [];

  let body: ReactNode;
  if (!activeCommunity?.cybercare) {
    body = (
      <p className="text-sm text-muted-foreground">
        This community isn't connected to Cybercare. Open Settings, then
        Cybercare, to connect it.
      </p>
    );
  } else if (tasksQuery.isLoading) {
    body = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
        Looking for what's waiting on you…
      </p>
    );
  } else if (tasksQuery.isError) {
    body = (
      <p className="text-sm text-destructive" role="alert">
        Couldn't load your tasks. Try again.
      </p>
    );
  } else if (tasks.length === 0) {
    body = (
      <div className="rounded-2xl border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
        Nothing is waiting on you.
      </div>
    );
  } else {
    body = (
      <ul className="space-y-2" data-testid="my-tasks-list">
        {tasks.map((task) => (
          <li key={taskKey(task)}>
            <button
              className="flex w-full items-start gap-3 rounded-xl border border-border/70 bg-background px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                void goChannel(
                  task.channelId,
                  task.kind === "proposal" ? { messageId: task.id } : undefined,
                )
              }
              type="button"
            >
              {task.kind === "proposal" ? (
                <Gavel
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                />
              ) : (
                <FileText
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {task.kind === "proposal"
                    ? task.proposal.title
                    : `${task.awaiting} evidence item${task.awaiting === 1 ? "" : "s"} awaiting review`}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {task.kind === "proposal"
                    ? `Decision needed · #${channelName(task.channelId)} · filed ${age(task.createdAt)}`
                    : `${task.assessmentName} · #${channelName(task.channelId)}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden"
      data-testid="my-tasks-view"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-7 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <PageHeader
            action={
              <Button
                aria-label="Refresh my tasks"
                disabled={tasksQuery.isFetching}
                onClick={() => void tasksQuery.refetch()}
                size="icon"
                variant="ghost"
              >
                <RefreshCw
                  className={`h-4 w-4 ${tasksQuery.isFetching ? "animate-spin" : ""}`}
                />
              </Button>
            }
            description="Decisions agents are waiting for, and evidence to review."
            title="My tasks"
          />
          {body}
        </div>
      </div>
    </div>
  );
}

function taskKey(task: MyTask) {
  return task.kind === "proposal" ? task.id : `evidence-${task.channelId}`;
}
