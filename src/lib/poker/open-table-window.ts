/** Max cash tables opened at once from “Open all”. */
export const MAX_TABLE_WINDOWS = 6;

/** Reused lobby tab when leaving the table via “← Tables”. */
export const LOBBY_WINDOW_TARGET = "poker-lobby";

export function tablePlayUrl(tableId: string): string {
  return `/tables/${tableId}`;
}

export function tableWindowTarget(tableId: string): string {
  return `poker-table-${tableId}`;
}

/** Click existing anchor elements (must live in the DOM before the user click). */
export function clickTableAnchors(anchors: Iterable<HTMLAnchorElement>): void {
  for (const a of anchors) {
    a.click();
  }
}

/**
 * Open (or focus) a table tab. Never pass windowFeatures to window.open.
 */
export function openTableWindow(tableId: string): void {
  if (typeof window === "undefined") return;
  const opened = window.open(tablePlayUrl(tableId), tableWindowTarget(tableId));
  opened?.focus();
}

/**
 * After sitting (or when already seated), ensure this table lives in its named tab.
 * If the user joined from the lobby in the same tab, moves play to a new tab and sends
 * the current tab back to the lobby.
 */
export function claimTablePlayTab(tableId: string): void {
  if (typeof window === "undefined") return;
  const target = tableWindowTarget(tableId);
  if (window.name === target) return;

  const opened = window.open(tablePlayUrl(tableId), target);
  opened?.focus();

  if (opened && opened !== window) {
    window.location.assign("/tables");
    return;
  }
  window.name = target;
}

export function openLobbyWindow(): void {
  if (typeof window === "undefined") return;
  const opened = window.open("/tables", LOBBY_WINDOW_TARGET);
  opened?.focus();
}

/** @deprecated Prefer clickTableAnchors with pre-rendered links in the component. */
export function openAllTableWindows(tableIds: string[]): void {
  if (typeof window === "undefined") return;
  const unique = [...new Set(tableIds)].slice(0, MAX_TABLE_WINDOWS);
  for (const id of unique) {
    const a = document.createElement("a");
    a.href = tablePlayUrl(id);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
