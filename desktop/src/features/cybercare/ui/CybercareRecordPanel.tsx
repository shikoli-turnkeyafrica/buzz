import * as React from "react";
import {
  ChevronRight,
  FileText,
  LoaderCircle,
  Search,
  ShieldCheck,
} from "lucide-react";

import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import {
  AuxiliaryPanel,
  AuxiliaryPanelBody,
  AuxiliaryPanelHeader,
  AuxiliaryPanelHeaderActions,
  AuxiliaryPanelHeaderGroup,
  AuxiliaryPanelHeaderTitleBlock,
} from "@/shared/layout/AuxiliaryPanel";
import type { AuxiliaryPanelLayout } from "@/shared/layout/AuxiliaryPanel";
import {
  type CybercareConfig,
  type CybercareGraphEvidence,
  type CybercareSession,
  getCybercareIdentity,
  getCybercareSession,
  listCybercareGraphEvidence,
} from "../cybercareApi";
import {
  type RoomBinding,
  readRoomBinding,
  writeRoomBinding,
} from "../roomBinding";
import { GraphEvidenceReviewForm } from "./GraphEvidenceReviewForm";
import { RoomBindForm } from "./RoomBindForm";

function errorText(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "Couldn't reach Cybercare. Try again.";
}

function StateChip({ item }: { item: CybercareGraphEvidence }) {
  const decision = item.review?.decision;
  const tone = !item.review
    ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300"
    : decision === "rejected"
      ? "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300"
      : "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300";
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wide",
        tone,
      )}
    >
      {!item.review
        ? "Awaiting review"
        : decision === "rejected"
          ? "Rejected"
          : "Approved"}
    </span>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

/**
 * The organisation's evidence of record (Cybercare's graph) beside the
 * conversation. Reviews are recorded in Cybercare citing the signed
 * decision, which is then posted to the channel.
 */
export function CybercareRecordPanel({
  channel,
  communityId,
  config,
  isSinglePanelView,
  layout,
  onClose,
  transparentChrome,
  widthPx,
}: {
  channel: Channel;
  communityId: string;
  config: CybercareConfig | undefined;
  isSinglePanelView: boolean;
  layout: AuxiliaryPanelLayout;
  onClose: () => void;
  transparentChrome: boolean;
  widthPx: number;
}) {
  const [session, setSession] = React.useState<
    CybercareSession | null | undefined
  >(undefined);
  const [binding, setBinding] = React.useState<RoomBinding | null>(() =>
    readRoomBinding(communityId, channel.id),
  );
  const [rebinding, setRebinding] = React.useState(false);
  const [evidence, setEvidence] = React.useState<
    CybercareGraphEvidence[] | null
  >(null);
  const [keyLinked, setKeyLinked] = React.useState<boolean | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    setBinding(readRoomBinding(communityId, channel.id));
    setSelectedId(null);
  }, [communityId, channel.id]);

  React.useEffect(() => {
    let cancelled = false;
    getCybercareSession(communityId)
      .then((next) => !cancelled && setSession(next))
      .catch(() => !cancelled && setSession(null));
    return () => {
      cancelled = true;
    };
  }, [communityId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is an intentional trigger after a review; its value is not read
  React.useEffect(() => {
    if (!config || !session || !binding) return;
    let cancelled = false;
    setError(null);
    listCybercareGraphEvidence(communityId, config, binding.orgId)
      .then((items) => {
        if (cancelled) return;
        setEvidence(items);
        setSelectedId((current) =>
          current && items.some((i) => i.evidenceId === current)
            ? current
            : (items.find((i) => !i.review)?.evidenceId ??
              items[0]?.evidenceId ??
              null),
        );
      })
      .catch((reason) => !cancelled && setError(errorText(reason)));
    getCybercareIdentity(communityId, config, binding.orgId)
      .then(
        (status) =>
          !cancelled && setKeyLinked(status.enrolled && status.isThisKey),
      )
      .catch(() => !cancelled && setKeyLinked(null));
    return () => {
      cancelled = true;
    };
  }, [communityId, config, session, binding, reloadKey]);

  const header = (
    <AuxiliaryPanelHeader
      backdrop={layout !== "split"}
      backdropSurface="soft"
      inset={layout !== "split" ? "wide" : "default"}
    >
      <AuxiliaryPanelHeaderGroup>
        <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-primary" />
        <AuxiliaryPanelHeaderTitleBlock subtitle="Cybercare" title="Evidence" />
      </AuxiliaryPanelHeaderGroup>
      <AuxiliaryPanelHeaderActions includeCloseAction />
    </AuxiliaryPanelHeader>
  );

  let body: React.ReactNode;
  if (!config) {
    body = (
      <Notice>
        This community isn't connected to Cybercare yet. Open Settings, then
        Cybercare, and enter your organisation's addresses.
      </Notice>
    );
  } else if (session === undefined) {
    body = (
      <Notice>
        <LoaderCircle aria-hidden className="inline h-4 w-4 animate-spin" />{" "}
        Checking your Cybercare session…
      </Notice>
    );
  } else if (!session) {
    body = (
      <Notice>
        You're not signed in to Cybercare. Open Settings, then Cybercare, and
        sign in.
      </Notice>
    );
  } else if (!binding || rebinding) {
    body = (
      <div className="p-4">
        <RoomBindForm
          communityId={communityId}
          config={config}
          onBound={(next) => {
            writeRoomBinding(communityId, channel.id, next);
            setBinding(next);
            setRebinding(false);
            setEvidence(null);
          }}
          session={session}
        />
      </div>
    );
  } else {
    const needle = filter.trim().toLowerCase();
    const shown = (evidence ?? []).filter(
      (item) =>
        !needle ||
        item.title.toLowerCase().includes(needle) ||
        item.evidenceCode.toLowerCase().includes(needle) ||
        item.controls.some((c) =>
          `${c.controlCode} ${c.name}`.toLowerCase().includes(needle),
        ),
    );
    const awaiting = (evidence ?? []).filter((item) => !item.review).length;
    const selected =
      evidence?.find((item) => item.evidenceId === selectedId) ?? null;
    body = (
      <div className="flex min-h-full flex-col">
        <div className="flex items-center gap-1 border-b border-border/60 bg-muted/40 px-4 py-2 text-xs">
          <span className="truncate">{binding.orgLabel}</span>
          <ChevronRight
            aria-hidden
            className="h-3 w-3 shrink-0 text-muted-foreground"
          />
          <span className="truncate">{binding.moduleName}</span>
          <ChevronRight
            aria-hidden
            className="h-3 w-3 shrink-0 text-muted-foreground"
          />
          <span className="truncate font-semibold">
            {binding.assessmentName}
          </span>
          <button
            className="ml-auto shrink-0 text-primary underline-offset-2 hover:underline"
            onClick={() => setRebinding(true)}
            type="button"
          >
            Change
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 pb-1 pt-3">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Filter evidence</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              className="h-8 w-full rounded-lg border border-input/60 bg-background pl-7 pr-2 text-sm"
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter evidence"
              value={filter}
            />
          </label>
          {awaiting > 0 ? (
            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-2xs font-bold uppercase text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
              {awaiting} awaiting
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="px-4 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <ul
          className="space-y-2 px-4 py-2"
          data-testid="cybercare-evidence-list"
        >
          {evidence === null && !error ? (
            <li className="text-sm text-muted-foreground">
              <LoaderCircle
                aria-hidden
                className="inline h-4 w-4 animate-spin"
              />{" "}
              Loading evidence…
            </li>
          ) : null}
          {evidence !== null && shown.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              {evidence.length === 0
                ? "Cybercare has no evidence for this organisation yet."
                : "Nothing matches that filter."}
            </li>
          ) : null}
          {shown.map((item) => (
            <li key={item.evidenceId}>
              <button
                aria-pressed={item.evidenceId === selectedId}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left",
                  item.evidenceId === selectedId
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/70 bg-background hover:bg-muted/40",
                )}
                onClick={() => setSelectedId(item.evidenceId)}
                type="button"
              >
                <FileText
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <span className="font-mono">{item.evidenceCode}</span>
                    {item.controls[0]
                      ? ` · ${item.controls[0].controlCode} ${item.controls[0].name}`
                      : ""}
                    {item.review
                      ? ` · ${item.review.approver ?? "reviewed"}${item.review.decidedAt ? `, ${new Date(item.review.decidedAt).toLocaleDateString()}` : ""}`
                      : ""}
                  </span>
                </span>
                <StateChip item={item} />
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-auto border-t border-border/60 p-4">
          {selected ? (
            <GraphEvidenceReviewForm
              channelId={channel.id}
              communityId={communityId}
              config={config}
              evidence={selected}
              keyLinked={keyLinked}
              onReviewed={() => setReloadKey((k) => k + 1)}
              orgId={binding.orgId}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Pick an item to review.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <AuxiliaryPanel
      header={header}
      isSinglePanelView={isSinglePanelView}
      layout={layout}
      onClose={onClose}
      testId="cybercare-record-panel"
      transparentChrome={transparentChrome}
      widthPx={widthPx}
    >
      <AuxiliaryPanelBody className="overflow-y-auto" panelPadding={false}>
        {body}
      </AuxiliaryPanelBody>
    </AuxiliaryPanel>
  );
}
