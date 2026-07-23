/** Desktop-only project chrome prefs (pin / archive / rename / expand). */

const PINNED_KEY = "pix.projects.pinned";
const ARCHIVED_KEY = "pix.projects.archived";
const ALIASES_KEY = "pix.projects.aliases";
const EXPANDED_KEY = "pix.projects.expanded";
const VISIBLE_KEY = "pix.projects.visibleCount";

export const PROJECT_THREADS_PAGE = 5;

const THREAD_ALIASES_KEY = "pix.threads.aliases";
const THREAD_ARCHIVED_KEY = "pix.threads.archived";
const THREAD_PINNED_KEY = "pix.threads.pinned";
const THREAD_UNREAD_KEY = "pix.threads.unread";
const THREAD_DELETED_KEY = "pix.threads.deleted";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function loadPinnedProjects(): string[] {
  const list = readJson<string[]>(PINNED_KEY, []);
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
}

export function savePinnedProjects(paths: string[]): void {
  writeJson(PINNED_KEY, paths.map(normalizePath));
}

export function togglePinnedProject(path: string): string[] {
  const key = normalizePath(path);
  const current = loadPinnedProjects();
  const next = current.some((p) => normalizePath(p) === key)
    ? current.filter((p) => normalizePath(p) !== key)
    : [path, ...current.filter((p) => normalizePath(p) !== key)];
  savePinnedProjects(next);
  return next;
}

export function isPinnedProject(path: string, pinned: readonly string[]): boolean {
  const key = normalizePath(path);
  return pinned.some((p) => normalizePath(p) === key);
}

export function loadArchivedProjects(): string[] {
  const list = readJson<string[]>(ARCHIVED_KEY, []);
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
}

export function saveArchivedProjects(paths: string[]): void {
  writeJson(ARCHIVED_KEY, paths.map(normalizePath));
}

export function archiveProject(path: string): string[] {
  const key = normalizePath(path);
  const next = [path, ...loadArchivedProjects().filter((p) => normalizePath(p) !== key)];
  saveArchivedProjects(next);
  // Unpin when archived
  savePinnedProjects(loadPinnedProjects().filter((p) => normalizePath(p) !== key));
  return next;
}

export function isArchivedProject(path: string, archived: readonly string[]): boolean {
  const key = normalizePath(path);
  return archived.some((p) => normalizePath(p) === key);
}

export function loadProjectAliases(): Record<string, string> {
  const map = readJson<Record<string, string>>(ALIASES_KEY, {});
  return map && typeof map === "object" ? map : {};
}

export function setProjectAlias(path: string, alias: string | undefined): Record<string, string> {
  const key = normalizePath(path);
  const map = { ...loadProjectAliases() };
  if (!alias?.trim()) delete map[key];
  else map[key] = alias.trim();
  writeJson(ALIASES_KEY, map);
  return map;
}

export function projectDisplayName(
  path: string,
  aliases: Record<string, string>,
  fallback: string,
): string {
  const key = normalizePath(path);
  return aliases[key]?.trim() || fallback;
}

export function loadExpandedProjects(): string[] {
  const list = readJson<string[]>(EXPANDED_KEY, []);
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
}

export function saveExpandedProjects(paths: string[]): void {
  writeJson(EXPANDED_KEY, paths.map(normalizePath));
}

export function toggleExpandedProject(path: string): string[] {
  const key = normalizePath(path);
  const current = loadExpandedProjects();
  const next = current.some((p) => normalizePath(p) === key)
    ? current.filter((p) => normalizePath(p) !== key)
    : [...current, path];
  saveExpandedProjects(next);
  return next;
}

export function isExpandedProject(path: string, expanded: readonly string[]): boolean {
  const key = normalizePath(path);
  return expanded.some((p) => normalizePath(p) === key);
}

export function loadVisibleThreadCounts(): Record<string, number> {
  const map = readJson<Record<string, number>>(VISIBLE_KEY, {});
  return map && typeof map === "object" ? map : {};
}

export function getVisibleThreadCount(path: string, counts: Record<string, number>): number {
  const key = normalizePath(path);
  const n = counts[key];
  return typeof n === "number" && n >= PROJECT_THREADS_PAGE ? n : PROJECT_THREADS_PAGE;
}

export function increaseVisibleThreadCount(
  path: string,
  counts: Record<string, number>,
): Record<string, number> {
  const key = normalizePath(path);
  const next = {
    ...counts,
    [key]: getVisibleThreadCount(path, counts) + PROJECT_THREADS_PAGE,
  };
  writeJson(VISIBLE_KEY, next);
  return next;
}

/** Build ordered project paths: pinned first, then others; drop archived. */
export function partitionProjects(
  paths: readonly string[],
  pinned: readonly string[],
  archived: readonly string[],
): { pinned: string[]; rest: string[] } {
  const byKey = new Map<string, string>();
  for (const raw of paths) {
    if (!raw?.trim()) continue;
    const key = normalizePath(raw);
    if (isArchivedProject(raw, archived)) continue;
    if (!byKey.has(key)) byKey.set(key, raw);
  }
  // Pinned keys that are not in paths still show (caller should also pass pinned into paths).
  for (const p of pinned) {
    if (!p?.trim()) continue;
    const key = normalizePath(p);
    if (isArchivedProject(p, archived)) continue;
    if (!byKey.has(key)) byKey.set(key, p);
  }

  const pinnedKeys = pinned.map(normalizePath).filter((k) => byKey.has(k));
  // de-dupe pin order
  const pinSeen = new Set<string>();
  const orderedPinned: string[] = [];
  for (const key of pinnedKeys) {
    if (pinSeen.has(key)) continue;
    pinSeen.add(key);
    orderedPinned.push(byKey.get(key)!);
  }
  const pinnedSet = new Set(pinSeen);
  const rest: string[] = [];
  for (const [key, raw] of byKey) {
    if (pinnedSet.has(key)) continue;
    rest.push(raw);
  }
  return { pinned: orderedPinned, rest };
}

export type ProjectSortMode = "priority" | "recent";

/**
 * Order projects in the 项目 section (pinned live in 置顶 and are not passed here).
 * - priority: alphabetical by folder name
 * - recent: follow recentOrder (most recent first); unknowns last
 */
export function sortProjectPaths(
  paths: readonly string[],
  mode: ProjectSortMode,
  options?: {
    recentOrder?: readonly string[];
  },
): string[] {
  const list = [...paths];
  if (list.length <= 1) return list;

  if (mode === "recent") {
    const recentIndex = new Map(
      (options?.recentOrder ?? []).map((p, i) => [normalizePath(p), i]),
    );
    return list.sort((a, b) => {
      const ai = recentIndex.has(normalizePath(a))
        ? (recentIndex.get(normalizePath(a)) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
      const bi = recentIndex.has(normalizePath(b))
        ? (recentIndex.get(normalizePath(b)) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return normalizePath(a).localeCompare(normalizePath(b));
    });
  }

  // priority — alphabetical by folder name, then full path
  return list.sort((a, b) => {
    const an = normalizePath(a).split("/").pop() ?? a;
    const bn = normalizePath(b).split("/").pop() ?? b;
    const byName = an.localeCompare(bn, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return normalizePath(a).localeCompare(normalizePath(b));
  });
}

/** Thread display aliases (desktop-only; does not rewrite session files). */
export function loadThreadAliases(): Record<string, string> {
  const map = readJson<Record<string, string>>(THREAD_ALIASES_KEY, {});
  return map && typeof map === "object" ? map : {};
}

export function setThreadAlias(id: string, alias: string | undefined): Record<string, string> {
  const map = { ...loadThreadAliases() };
  if (!alias?.trim()) delete map[id];
  else map[id] = alias.trim();
  writeJson(THREAD_ALIASES_KEY, map);
  return map;
}

export function threadDisplayTitle(
  id: string,
  aliases: Record<string, string>,
  fallback: string,
): string {
  return aliases[id]?.trim() || fallback;
}

export function loadArchivedThreads(): string[] {
  const list = readJson<string[]>(THREAD_ARCHIVED_KEY, []);
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
}

export function saveArchivedThreads(ids: string[]): void {
  writeJson(THREAD_ARCHIVED_KEY, ids);
}

export function archiveThread(
  id: string,
  meta?: { title?: string; path?: string; cwd?: string; archivedAt?: string },
): string[] {
  const next = [id, ...loadArchivedThreads().filter((p) => p !== id)];
  // unpin when archived
  savePinnedThreads(loadPinnedThreads().filter((p) => p !== id));
  writeJson(THREAD_ARCHIVED_KEY, next);
  if (meta?.title?.trim()) {
    setThreadAlias(id, meta.title.trim());
  }
  const map = loadArchivedThreadMeta();
  map[id] = {
    ...map[id],
    ...(meta?.path ? { path: meta.path } : {}),
    ...(meta?.cwd ? { cwd: meta.cwd } : {}),
    ...(meta?.title ? { title: meta.title } : {}),
    archivedAt: meta?.archivedAt ?? new Date().toISOString(),
  };
  saveArchivedThreadMeta(map);
  return next;
}

export type ArchivedThreadMeta = {
  title?: string;
  path?: string;
  cwd?: string;
  archivedAt?: string;
};

const THREAD_ARCHIVED_META_KEY = "pix.threads.archivedMeta";

export function loadArchivedThreadMeta(): Record<string, ArchivedThreadMeta> {
  const map = readJson<Record<string, ArchivedThreadMeta>>(THREAD_ARCHIVED_META_KEY, {});
  return map && typeof map === "object" ? map : {};
}

export function saveArchivedThreadMeta(map: Record<string, ArchivedThreadMeta>): void {
  writeJson(THREAD_ARCHIVED_META_KEY, map);
}

export function unarchiveThread(id: string): string[] {
  const next = loadArchivedThreads().filter((p) => p !== id);
  writeJson(THREAD_ARCHIVED_KEY, next);
  return next;
}

export function isArchivedThread(id: string, archived: readonly string[]): boolean {
  return archived.includes(id);
}

export function loadPinnedThreads(): string[] {
  const list = readJson<string[]>(THREAD_PINNED_KEY, []);
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
}

export function savePinnedThreads(ids: string[]): void {
  writeJson(THREAD_PINNED_KEY, ids);
}

export function togglePinnedThread(id: string): string[] {
  const current = loadPinnedThreads();
  const next = current.includes(id)
    ? current.filter((p) => p !== id)
    : [id, ...current.filter((p) => p !== id)];
  savePinnedThreads(next);
  return next;
}

export function isPinnedThread(id: string, pinned: readonly string[]): boolean {
  return pinned.includes(id);
}

export function loadUnreadThreads(): string[] {
  const list = readJson<string[]>(THREAD_UNREAD_KEY, []);
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
}

export function markThreadUnread(id: string, unread: boolean): string[] {
  const current = loadUnreadThreads();
  const next = unread ? [id, ...current.filter((p) => p !== id)] : current.filter((p) => p !== id);
  writeJson(THREAD_UNREAD_KEY, next);
  return next;
}

export function isUnreadThread(id: string, unread: readonly string[]): boolean {
  return unread.includes(id);
}

export function loadDeletedThreads(): string[] {
  const list = readJson<string[]>(THREAD_DELETED_KEY, []);
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
}

export function deleteThreadLocal(id: string): string[] {
  const next = [id, ...loadDeletedThreads().filter((p) => p !== id)];
  writeJson(THREAD_DELETED_KEY, next);
  // clean related prefs
  savePinnedThreads(loadPinnedThreads().filter((p) => p !== id));
  saveArchivedThreads(loadArchivedThreads().filter((p) => p !== id));
  markThreadUnread(id, false);
  const aliases = { ...loadThreadAliases() };
  delete aliases[id];
  writeJson(THREAD_ALIASES_KEY, aliases);
  return next;
}

export function isDeletedThread(id: string, deleted: readonly string[]): boolean {
  return deleted.includes(id);
}

/** Sort: pinned first (pin order), then by modifiedAt desc. */
export function sortThreadsWithPins<T extends { id: string; modifiedAt: string }>(
  threads: T[],
  pinned: readonly string[],
): T[] {
  return sortThreadsByMode(threads, "priority", pinned);
}

export type ThreadSortMode = "priority" | "recent";

/**
 * Sort sidebar threads/conversations.
 * - priority: pinned first (pin order), then modifiedAt desc
 * - recent: modifiedAt desc only
 */
export function sortThreadsByMode<T extends { id: string; modifiedAt: string }>(
  threads: T[],
  mode: ThreadSortMode,
  pinned: readonly string[],
): T[] {
  if (mode === "recent") {
    return [...threads].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  const pinIndex = new Map(pinned.map((id, i) => [id, i]));

  return [...threads].sort((a, b) => {
    const ap = pinIndex.has(a.id);
    const bp = pinIndex.has(b.id);
    if (ap && bp) return (pinIndex.get(a.id) ?? 0) - (pinIndex.get(b.id) ?? 0);
    if (ap) return -1;
    if (bp) return 1;
    return b.modifiedAt.localeCompare(a.modifiedAt);
  });
}
