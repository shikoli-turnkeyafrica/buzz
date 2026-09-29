/**
 * Which Cybercare organisation, module and assessment a room is about.
 * Kept per device for now; the room owner writes it into channel metadata
 * later, at which point this becomes the fallback.
 */
export type RoomBinding = {
  orgId: string;
  orgLabel: string;
  moduleId: string;
  moduleName: string;
  assessmentId: string;
  assessmentName: string;
};

const PREFIX = "cybercare-room-binding";

export function roomBindingKey(communityId: string, channelId: string) {
  return `${PREFIX}:${communityId}:${channelId}`;
}

function isBinding(value: unknown): value is RoomBinding {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return [
    "orgId",
    "orgLabel",
    "moduleId",
    "moduleName",
    "assessmentId",
    "assessmentName",
  ].every((key) => typeof v[key] === "string" && v[key] !== "");
}

export function readRoomBinding(
  communityId: string,
  channelId: string,
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): RoomBinding | null {
  try {
    const raw = storage?.getItem(roomBindingKey(communityId, channelId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isBinding(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRoomBinding(
  communityId: string,
  channelId: string,
  binding: RoomBinding,
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): boolean {
  try {
    storage?.setItem(
      roomBindingKey(communityId, channelId),
      JSON.stringify(binding),
    );
    return storage != null;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
