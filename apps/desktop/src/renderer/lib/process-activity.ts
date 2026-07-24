/**
 * Compact process-step presentation (Codex-style activity rows).
 * Pure helpers — safe for unit tests without React.
 */

export type ProcessToolKind = "read" | "run" | "search" | "edit" | "write" | "list" | "generic";

export type ProcessToolView = {
  kind: ProcessToolKind;
  /** Primary path/file when present (shown as a link chip). */
  path?: string;
  /** Command / query / free-form detail. */
  detail: string;
  /** Truncated one-line preview for the row. */
  preview: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(row: Record<string, unknown> | undefined, keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const v = str(row[key]);
    if (v) return v;
  }
  return "";
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function truncate(text: string, max = 96): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

export function classifyToolName(toolName: string): ProcessToolKind {
  const name = toolName.trim().toLowerCase();
  if (!name) return "generic";
  if (/(^|_)(read|cat|open_file|get_file)(_|$)/.test(name) || name === "read_file") return "read";
  if (/(^|_)(bash|shell|exec|run|terminal|command)(_|$)/.test(name)) return "run";
  if (/(^|_)(grep|search|rg|find_in|codebase_search)(_|$)/.test(name)) return "search";
  if (/(^|_)(edit|str_replace|search_replace|apply_patch|patch)(_|$)/.test(name)) return "edit";
  if (/(^|_)(write|create_file|write_file)(_|$)/.test(name)) return "write";
  if (/(^|_)(ls|list|glob|find|dir)(_|$)/.test(name)) return "list";
  return "generic";
}

/** Build a compact view model for a tool call row. */
export function processToolView(toolName: string, args: unknown): ProcessToolView {
  const kind = classifyToolName(toolName);
  const row = asRecord(args);
  const path = firstString(row, ["path", "file_path", "file", "filename", "target"]);
  const command = firstString(row, ["command", "cmd"]);
  const query = firstString(row, ["query", "pattern", "regex", "search"]);
  const description = firstString(row, ["description", "content"]);

  if (kind === "run") {
    const detail = command || description || toolName;
    return { kind, detail, preview: truncate(detail), ...(path ? { path } : {}) };
  }
  if (kind === "search") {
    const detail = query || description || toolName;
    return {
      kind,
      detail,
      preview: truncate(detail),
      ...(path ? { path } : {}),
    };
  }
  if (kind === "read" || kind === "edit" || kind === "write" || kind === "list") {
    const detail = path || description || toolName;
    return {
      kind,
      detail,
      preview: path ? basename(path) : truncate(detail),
      ...(path ? { path } : {}),
    };
  }

  const detail =
    command ||
    path ||
    query ||
    description ||
    (args !== undefined ? JSON.stringify(args) : toolName);
  return {
    kind: "generic",
    detail: String(detail),
    preview: truncate(String(detail)),
    ...(path ? { path } : {}),
  };
}

/** Consecutive tools with the same kind can collapse into a multi-step group. */
export function groupConsecutiveTools<T extends { kind: "tool"; toolName: string }>(
  items: T[],
): Array<{ type: "single"; item: T } | { type: "group"; kind: ProcessToolKind; items: T[] }> {
  const out: Array<
    { type: "single"; item: T } | { type: "group"; kind: ProcessToolKind; items: T[] }
  > = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    const kind = classifyToolName(item.toolName);
    let j = i + 1;
    while (j < items.length && classifyToolName(items[j]!.toolName) === kind) j += 1;
    const slice = items.slice(i, j);
    if (slice.length >= 2) {
      out.push({ type: "group", kind, items: slice });
    } else {
      out.push({ type: "single", item });
    }
    i = j;
  }
  return out;
}
