import * as React from "react";
import { KeyRound, Link2, LoaderCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { SettingsOptionRow } from "@/features/settings/ui/SettingsOptionGroup";
import {
  type CybercareConfig,
  type CybercareIdentityStatus,
  type CybercareSession,
  getCybercareIdentity,
  linkKeyToCybercare,
} from "../cybercareApi";

function shortKey(pubkey: string) {
  return pubkey.length > 16
    ? `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`
    : pubkey;
}

function errorText(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "Couldn't reach Cybercare. Try again.";
}

/**
 * Links this app's signing key to the signed-in Cybercare identity, for one
 * organisation. A ruling signed by this app only counts as this person's once
 * the link exists.
 */
export function CybercareKeyLinkRow({
  communityId,
  config,
  session,
}: {
  communityId: string;
  config: CybercareConfig;
  session: CybercareSession;
}) {
  const orgs = session.organisationIds;
  const [orgId, setOrgId] = React.useState<string | null>(orgs[0] ?? null);
  const [status, setStatus] = React.useState<CybercareIdentityStatus | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [linking, setLinking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCybercareIdentity(communityId, config, orgId)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((reason) => {
        if (!cancelled) {
          setStatus(null);
          setError(errorText(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [communityId, config, orgId]);

  if (!orgId) {
    return (
      <SettingsOptionRow data-testid="cybercare-key-link">
        <div className="flex items-start gap-3">
          <TriangleAlert
            aria-hidden
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          />
          <div className="text-sm text-muted-foreground">
            This account isn't attached to an organisation in Cybercare, so
            there is nothing to link a key to. Ask your Cybercare administrator.
          </div>
        </div>
      </SettingsOptionRow>
    );
  }

  const handleLink = async () => {
    setLinking(true);
    setError(null);
    try {
      const next = await linkKeyToCybercare(communityId, config, orgId);
      setStatus(next);
      toast.success("This app's key is now linked to your Cybercare identity");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLinking(false);
    }
  };

  const linkedHere = status?.enrolled && status.isThisKey;
  const linkedElsewhere = status?.enrolled && !status.isThisKey;

  return (
    <SettingsOptionRow data-testid="cybercare-key-link">
      <div className="flex min-w-0 items-start gap-3">
        <KeyRound
          aria-hidden
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 space-y-1">
          <div className="font-medium">Signing key</div>
          {orgs.length > 1 ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Organisation
              <select
                className="rounded-md border border-input/40 bg-background px-2 py-1 text-xs text-foreground"
                disabled={linking}
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
          <div className="text-xs text-muted-foreground">
            {loading
              ? "Checking…"
              : linkedHere && status.binding
                ? `Linked · ${shortKey(status.binding.commonsPubkey)} · since ${new Date(status.binding.enrolledAt).toLocaleDateString()}`
                : linkedElsewhere && status.binding
                  ? `Another key is linked (${shortKey(status.binding.commonsPubkey)}). Rulings from this app won't count as yours until you revoke that link.`
                  : "Not linked. Link it so rulings you sign here count as yours in Cybercare."}
          </div>
          {error ? (
            <div className="text-xs text-destructive" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>
      {linkedHere ? null : (
        <Button
          data-testid="cybercare-link-key"
          disabled={loading || linking || Boolean(linkedElsewhere)}
          onClick={() => void handleLink()}
          size="sm"
          type="button"
        >
          {linking ? (
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 aria-hidden className="h-4 w-4" />
          )}
          Link this key
        </Button>
      )}
    </SettingsOptionRow>
  );
}
