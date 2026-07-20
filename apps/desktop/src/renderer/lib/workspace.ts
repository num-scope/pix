/** Short label for a workspace path (directory name + optional parent). */
export function workspaceLabel(path: string | undefined): { name: string; detail?: string } {
  if (!path) return { name: "" };
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const name = parts.at(-1) ?? path;
  const parent = parts.at(-2);
  return parent ? { name, detail: parent } : { name };
}

export function firstLine(text: string, max = 72): string {
  const line =
    text
      .split(/\r?\n/)
      .find((part) => part.trim())
      ?.trim() ?? text.trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

/** Temp / e2e fixture dirs should not pollute the product "recent projects" list. */
export function isEphemeralWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("/tmp/") ||
    normalized.includes("/var/folders/") ||
    normalized.includes("/pix-e2e-") ||
    normalized.includes("/pix-m0-") ||
    normalized.includes("/pix-m2-") ||
    normalized.includes("/pix-p0") ||
    normalized.includes("/fork-probe") ||
    normalized.includes("/recent-ws-") ||
    normalized.includes("/other-workspace") ||
    /\/t\/pix-/.test(normalized)
  );
}

/**
 * Product recent list: drop ephemerals, drop current cwd, dedupe, cap.
 * Pure helper — unit-tested without Electron.
 */
export function filterRecentWorkspaces(
  paths: readonly string[],
  options?: { current?: string; max?: number },
): string[] {
  const max = options?.max ?? 5;
  const current = options?.current?.replace(/\\/g, "/").replace(/\/+$/, "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    if (isEphemeralWorkspacePath(raw)) continue;
    const path = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    if (current && path === current) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}

/** Put path first in a recent list, dedupe, cap length (desktop preference only). */
export function prependRecentPath(paths: string[], path: string, max = 12): string[] {
  const normalized = path.trim();
  if (!normalized) return paths;
  if (isEphemeralWorkspacePath(normalized)) {
    // Still allow lastWorkspace for resume, but don't grow recent with junk.
    return paths.filter((item) => item !== normalized).slice(0, max);
  }
  return [normalized, ...paths.filter((item) => item !== normalized)].slice(0, max);
}
