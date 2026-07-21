/** Desktop-only organize / sort prefs for the projects & conversations rail. */

export type GroupMode = "project" | "list";
export type SortMode = "priority" | "recent" | "manual";

const GROUP_KEY = "pix.sidebar.groupMode";
const SORT_KEY = "pix.sidebar.sortMode";
/** Sort prefs for the 对话 (conversations) section — independent of projects. */
const CONVERSATION_SORT_KEY = "pix.sidebar.conversationSortMode";
const CONVERSATION_MANUAL_ORDER_KEY = "pix.sidebar.conversationManualOrder";
const PROJECTS_OPEN_KEY = "pix.sidebar.projectsOpen";
const THREADS_OPEN_KEY = "pix.sidebar.threadsOpen";

function loadString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore
  }
  return fallback;
}

function saveBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore
  }
}

export function loadGroupMode(): GroupMode {
  const v = loadString(GROUP_KEY, "project");
  return v === "list" ? "list" : "project";
}

export function saveGroupMode(mode: GroupMode): void {
  saveString(GROUP_KEY, mode);
}

export function loadSortMode(): SortMode {
  const v = loadString(SORT_KEY, "priority");
  if (v === "recent" || v === "manual") return v;
  return "priority";
}

export function saveSortMode(mode: SortMode): void {
  saveString(SORT_KEY, mode);
}

export function loadConversationSortMode(): SortMode {
  const v = loadString(CONVERSATION_SORT_KEY, "priority");
  if (v === "recent" || v === "manual") return v;
  return "priority";
}

export function saveConversationSortMode(mode: SortMode): void {
  saveString(CONVERSATION_SORT_KEY, mode);
}

export function loadConversationManualOrder(): string[] {
  try {
    const raw = localStorage.getItem(CONVERSATION_MANUAL_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function saveConversationManualOrder(ids: string[]): void {
  try {
    localStorage.setItem(CONVERSATION_MANUAL_ORDER_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export function loadProjectsSectionOpen(): boolean {
  return loadBool(PROJECTS_OPEN_KEY, true);
}

export function saveProjectsSectionOpen(open: boolean): void {
  saveBool(PROJECTS_OPEN_KEY, open);
}

export function loadThreadsSectionOpen(): boolean {
  return loadBool(THREADS_OPEN_KEY, true);
}

export function saveThreadsSectionOpen(open: boolean): void {
  saveBool(THREADS_OPEN_KEY, open);
}
