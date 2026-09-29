import * as React from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  type CybercareConfig,
  type CybercareNamed,
  type CybercareSession,
  listCybercareAssessments,
  listCybercareModules,
} from "../cybercareApi";
import type { RoomBinding } from "../roomBinding";

function errorText(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "Couldn't reach Cybercare. Try again.";
}

const selectClass =
  "h-9 w-full rounded-lg border border-input/60 bg-background px-2 text-sm text-foreground disabled:opacity-50";

/**
 * Says which Cybercare organisation, module and assessment this room is
 * about. Shown the first time the Evidence panel opens in a room.
 */
export function RoomBindForm({
  communityId,
  config,
  session,
  onBound,
}: {
  communityId: string;
  config: CybercareConfig;
  session: CybercareSession;
  onBound: (binding: RoomBinding) => void;
}) {
  const orgs = session.organisationIds;
  const [orgId, setOrgId] = React.useState(orgs[0] ?? "");
  const [modules, setModules] = React.useState<CybercareNamed[] | null>(null);
  const [moduleId, setModuleId] = React.useState("");
  const [assessments, setAssessments] = React.useState<CybercareNamed[] | null>(
    null,
  );
  const [assessmentId, setAssessmentId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listCybercareModules(communityId, config)
      .then((list) => {
        if (cancelled) return;
        setModules(list);
        if (list.length === 1) setModuleId(list[0].id);
      })
      .catch((reason) => !cancelled && setError(errorText(reason)));
    return () => {
      cancelled = true;
    };
  }, [communityId, config]);

  React.useEffect(() => {
    setAssessments(null);
    setAssessmentId("");
    if (!orgId || !moduleId) return;
    let cancelled = false;
    listCybercareAssessments(communityId, config, orgId, moduleId)
      .then((list) => {
        if (cancelled) return;
        setAssessments(list);
        if (list.length === 1) setAssessmentId(list[0].id);
      })
      .catch((reason) => !cancelled && setError(errorText(reason)));
    return () => {
      cancelled = true;
    };
  }, [communityId, config, orgId, moduleId]);

  if (orgs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Your Cybercare account isn't attached to an organisation, so there are
        no records to show. Ask your Cybercare administrator.
      </p>
    );
  }

  const moduleName = modules?.find((m) => m.id === moduleId)?.name;
  const assessmentName = assessments?.find((a) => a.id === assessmentId)?.name;
  const ready = Boolean(orgId && moduleName && assessmentName);

  return (
    <form
      className="space-y-4"
      data-testid="cybercare-room-bind"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || !moduleName || !assessmentName) return;
        onBound({
          orgId,
          orgLabel: orgs.length === 1 ? "Your organisation" : orgId,
          moduleId,
          moduleName,
          assessmentId,
          assessmentName,
        });
      }}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          Which assessment is this room about?
        </h3>
        <p className="text-xs text-muted-foreground">
          The Evidence panel shows your organisation's evidence and checks this
          assessment's lock before anything is signed. Saved on this device.
        </p>
      </div>

      {orgs.length > 1 ? (
        <label className="block space-y-1 text-xs font-medium text-muted-foreground">
          Organisation
          <select
            className={selectClass}
            onChange={(event) => setOrgId(event.target.value)}
            value={orgId}
          >
            {orgs.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block space-y-1 text-xs font-medium text-muted-foreground">
        Module
        <select
          className={selectClass}
          disabled={!modules}
          onChange={(event) => setModuleId(event.target.value)}
          value={moduleId}
        >
          <option value="">{modules ? "Choose a module" : "Loading…"}</option>
          {modules?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-xs font-medium text-muted-foreground">
        Assessment
        <select
          className={selectClass}
          disabled={!moduleId || !assessments}
          onChange={(event) => setAssessmentId(event.target.value)}
          value={assessmentId}
        >
          <option value="">
            {!moduleId
              ? "Choose a module first"
              : assessments
                ? assessments.length === 0
                  ? "No assessments in this module"
                  : "Choose an assessment"
                : "Loading…"}
          </option>
          {assessments?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button disabled={!ready} type="submit">
        {!modules && !error ? (
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
        ) : null}
        Use for this room
      </Button>
    </form>
  );
}
