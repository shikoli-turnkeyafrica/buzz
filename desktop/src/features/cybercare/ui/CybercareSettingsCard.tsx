import * as React from "react";
import { LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { useCommunities } from "@/features/communities/useCommunities";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  SettingsOptionGroup,
  SettingsOptionRow,
} from "@/features/settings/ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "@/features/settings/ui/SettingsSectionHeader";
import {
  type CybercareSession,
  cancelCybercareSignIn,
  getCybercareSession,
  signInToCybercare,
  signOutOfCybercare,
} from "../cybercareApi";
import {
  type CybercareConfigDraft,
  checkCybercareConfig,
  draftFromConfig,
  signInErrorMessage,
} from "../cybercareConfig";
import { CybercareKeyLinkRow } from "./CybercareKeyLinkRow";

type Phase = "idle" | "signing-in" | "signing-out";

const FIELDS: Array<{
  key: keyof CybercareConfigDraft;
  label: string;
  placeholder: string;
  help: string;
}> = [
  {
    key: "baseUrl",
    label: "Cybercare address",
    placeholder: "e.g. https://cybercare.yourbank.co.ke",
    help: "The Cybercare API gateway your organisation uses.",
  },
  {
    key: "keycloakUrl",
    label: "Sign-in address",
    placeholder: "e.g. https://login.yourbank.co.ke/auth",
    help: "Your organisation's Keycloak, including /auth on older versions.",
  },
  {
    key: "realm",
    label: "Realm",
    placeholder: "e.g. cybota",
    help: "The Keycloak realm your Cybercare account lives in.",
  },
];

function formatExpiry(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function CybercareSettingsCard() {
  const { activeCommunity, updateCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const saved = activeCommunity?.cybercare;

  const [draft, setDraft] = React.useState<CybercareConfigDraft>(() =>
    draftFromConfig(saved),
  );
  const [fieldError, setFieldError] = React.useState<{
    field: keyof CybercareConfigDraft;
    message: string;
  } | null>(null);
  const [session, setSession] = React.useState<CybercareSession | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(draftFromConfig(saved));
    setFieldError(null);
  }, [saved]);

  React.useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    getCybercareSession(communityId)
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [communityId]);

  if (!activeCommunity || !communityId) {
    return (
      <div className="space-y-6">
        <SettingsSectionHeader
          title="Cybercare"
          description="Join a community first. Cybercare sign-in belongs to a community."
        />
      </div>
    );
  }

  const handleSignIn = async () => {
    setError(null);
    const check = checkCybercareConfig(draft);
    if (!check.ok) {
      setFieldError({ field: check.field, message: check.message });
      return;
    }
    setFieldError(null);
    updateCommunity(communityId, { cybercare: check.config });
    setPhase("signing-in");
    try {
      const next = await signInToCybercare(communityId, check.config);
      setSession(next);
      toast.success(
        `Signed in to Cybercare as ${next.username ?? next.email ?? "you"}`,
      );
    } catch (reason) {
      setError(signInErrorMessage(reason));
    } finally {
      setPhase("idle");
    }
  };

  const handleCancel = () => {
    void cancelCybercareSignIn();
  };

  const handleSignOut = async () => {
    if (!saved) return;
    setPhase("signing-out");
    setError(null);
    try {
      await signOutOfCybercare(communityId, saved);
      setSession(null);
      toast.success("Signed out of Cybercare");
    } catch (reason) {
      setError(signInErrorMessage(reason));
    } finally {
      setPhase("idle");
    }
  };

  const busy = phase !== "idle";

  return (
    <div className="space-y-6" data-testid="cybercare-settings">
      <SettingsSectionHeader
        title="Cybercare"
        description={`Sign in with your Cybercare account so this community can show assessments and evidence beside the conversation. Your password goes only to your organisation's sign-in page, never to ${activeCommunity.name}.`}
      />

      {session ? (
        <SettingsOptionGroup title="Signed in">
          <SettingsOptionRow data-testid="cybercare-session">
            <div className="flex min-w-0 items-start gap-3">
              <ShieldCheck
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              />
              <div className="min-w-0 space-y-0.5">
                <div className="truncate font-medium">
                  {session.name ?? session.username ?? session.email}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {session.username ?? session.email}
                  {session.organisationIds.length > 0
                    ? ` · ${session.organisationIds.length === 1 ? "1 organisation" : `${session.organisationIds.length} organisations`}`
                    : " · no organisation on this account"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Stays signed in · renews automatically · next at{" "}
                  {formatExpiry(session.expiresAt)}
                </div>
              </div>
            </div>
            <Button
              disabled={busy}
              onClick={() => void handleSignOut()}
              size="sm"
              type="button"
              variant="outline"
            >
              {phase === "signing-out" ? (
                <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut aria-hidden className="h-4 w-4" />
              )}
              Sign out
            </Button>
          </SettingsOptionRow>
          {saved ? (
            <CybercareKeyLinkRow
              communityId={communityId}
              config={saved}
              session={session}
            />
          ) : null}
        </SettingsOptionGroup>
      ) : null}

      <SettingsOptionGroup
        description="Your Cybercare administrator can give you these three values."
        title={`Cybercare for ${activeCommunity.name}`}
      >
        {FIELDS.map((field) => {
          const invalid = fieldError?.field === field.key;
          const inputId = `cybercare-${field.key}`;
          return (
            <SettingsOptionRow key={field.key}>
              <div className="min-w-0 space-y-0.5">
                <label className="font-medium" htmlFor={inputId}>
                  {field.label}
                </label>
                <div
                  className={
                    invalid
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                  id={`${inputId}-help`}
                >
                  {invalid ? fieldError.message : field.help}
                </div>
              </div>
              <Input
                aria-describedby={`${inputId}-help`}
                aria-invalid={invalid || undefined}
                autoComplete="off"
                className="w-80 max-w-full"
                disabled={busy || session !== null}
                id={inputId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
                placeholder={field.placeholder}
                spellCheck={false}
                value={draft[field.key]}
              />
            </SettingsOptionRow>
          );
        })}
      </SettingsOptionGroup>

      {session ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            data-testid="cybercare-sign-in"
            disabled={busy}
            onClick={() => void handleSignIn()}
            type="button"
          >
            {phase === "signing-in" ? (
              <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
            ) : null}
            {phase === "signing-in"
              ? "Waiting for your browser…"
              : "Sign in to Cybercare"}
          </Button>
          {phase === "signing-in" ? (
            <Button onClick={handleCancel} type="button" variant="ghost">
              Cancel
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            Opens your browser at your organisation's sign-in page.
          </span>
        </div>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
