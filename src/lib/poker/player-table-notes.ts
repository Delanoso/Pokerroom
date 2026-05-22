const STORAGE_PREFIX = "pokerroom:player-notes:";

function storageKey(viewerUserId: string): string {
  return `${STORAGE_PREFIX}${viewerUserId}`;
}

export function loadPlayerNotes(viewerUserId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey(viewerUserId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function savePlayerNote(viewerUserId: string, targetUserId: string, text: string): void {
  if (typeof window === "undefined") return;
  const all = loadPlayerNotes(viewerUserId);
  const trimmed = text.trim();
  if (trimmed) {
    all[targetUserId] = trimmed;
  } else {
    delete all[targetUserId];
  }
  localStorage.setItem(storageKey(viewerUserId), JSON.stringify(all));
}
