/**
 * Sidebar session run markers (ui-spec §5.2) — glyphs next to the title, not badges.
 * States are derived from host events / running map; not a second source of truth.
 */
import type { ThreadRunState } from "./timeline.ts";

export type SessionMarker = {
  state: ThreadRunState;
  /** Short reason for tooltip (failed / waiting / aborted). */
  reason?: string;
};

/** States that mean the agent is still busy (composer stop, park-eligible). */
export function isBusyRunState(state: ThreadRunState | undefined): boolean {
  return state === "running" || state === "waiting" || state === "recovering";
}

/** Terminal outcomes that should stay visible (failed/aborted) or flash (completed). */
export function isTerminalRunState(state: ThreadRunState | undefined): boolean {
  return state === "completed" || state === "failed" || state === "aborted" || state === "crashed";
}

/** How long the completed checkmark stays before returning to idle. */
export const COMPLETED_MARKER_MS = 2_500;

export function sessionMarkerFromThread(
  thread: { path?: string; id?: string; active?: boolean },
  markers: Record<string, SessionMarker>,
  options?: {
    /** Normalize key the same way as shell-store.sessionRunKey */
    keyOf?: (raw: string | undefined | null) => string;
    /** Foreground run state fallback for the active row only. */
    foregroundState?: ThreadRunState | undefined;
  },
): SessionMarker | undefined {
  const keyOf =
    options?.keyOf ?? ((raw) => (raw ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());
  const pathKey = keyOf(thread.path);
  const idKey = keyOf(thread.id);
  const hit = (pathKey && markers[pathKey]) || (idKey && markers[idKey]) || undefined;
  if (hit) return hit;
  const fg = options?.foregroundState;
  if (thread.active && fg && fg !== "idle") {
    return { state: fg };
  }
  return undefined;
}
