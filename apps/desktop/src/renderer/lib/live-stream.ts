/**
 * Append-only live timeline for the open session (post-history content).
 *
 * Guarantees for streamed thinking/assistant text:
 * 1. Tokens only grow (never shrink or replace with a shorter prefix)
 * 2. Each host sequence is applied at most once (dedupe)
 * 3. Cleared only on session switch / stop / crash
 */
import type { RuntimeEvent } from "@pix/contracts";
import type { TimelineItem } from "./timeline.ts";
import { splitAttachedPaths } from "./timeline.ts";

/** How many host sequences to remember for dedupe (well above one long turn). */
const SEEN_SEQUENCE_CAP = 4_000;

export type LiveStreamState = {
  items: TimelineItem[];
  seq: number;
  promptIndex: number;
  /** Host event sequences already folded into this log. */
  seenSequences: number[];
};

export function emptyLiveStream(): LiveStreamState {
  return { items: [], seq: 0, promptIndex: 0, seenSequences: [] };
}

export function resetLiveStream(): LiveStreamState {
  return emptyLiveStream();
}

/**
 * Grow text without ever shrinking.
 * - incremental chunk → append
 * - cumulative snapshot (delta starts with prev) → take delta
 * - exact redelivery of the same chunk → keep prev
 * - overlapping redelivery (e.g. "Hello wor" + "world") → merge without duplicating
 */
export function appendMonotonicText(prev: string, delta: string): string {
  if (!delta) return prev;
  if (!prev) return delta;
  if (delta === prev) return prev;
  // Cumulative full text so far (some providers re-send the whole buffer).
  if (delta.startsWith(prev) && delta.length >= prev.length) return delta;
  // Exact chunk redelivery.
  if (prev.endsWith(delta)) return prev;
  // Overlapping redelivery: require ≥2 chars so normal "Hel"+"lo" still appends.
  const maxOverlap = Math.min(prev.length, delta.length - 1, 64);
  for (let n = maxOverlap; n >= 2; n--) {
    if (prev.endsWith(delta.slice(0, n))) {
      return prev + delta.slice(n);
    }
  }
  return prev + delta;
}

function nextId(state: LiveStreamState, prefix: string): { id: string; seq: number } {
  const seq = state.seq + 1;
  return { id: `live-${prefix}-${seq}`, seq };
}

function nowIso(): string {
  return new Date().toISOString();
}

function rememberSequence(state: LiveStreamState, sequence: number | undefined): number[] {
  if (sequence === undefined) return state.seenSequences;
  if (state.seenSequences.includes(sequence)) return state.seenSequences;
  const next = [...state.seenSequences, sequence];
  return next.length > SEEN_SEQUENCE_CAP ? next.slice(next.length - SEEN_SEQUENCE_CAP) : next;
}

function shellOutputMarkdown(output: string, exitCode: number): string {
  const body = output || `(exit ${exitCode})`;
  return `\`\`\`text\n${body.trimEnd()}\n\`\`\``;
}

export type ApplyLiveStreamOptions = {
  /** Host runtime.event sequence — used for at-most-once apply. */
  sequence?: number;
};

/**
 * Apply one runtime event. Text deltas only grow the open buffer item.
 * Passing `sequence` makes redelivery a no-op.
 */
export function applyRuntimeEventToLiveStream(
  state: LiveStreamState,
  event: RuntimeEvent,
  prompts: string[],
  options?: ApplyLiveStreamOptions,
): LiveStreamState {
  const sequence = options?.sequence;
  if (sequence !== undefined && state.seenSequences.includes(sequence)) {
    return state;
  }

  const mark = (next: LiveStreamState): LiveStreamState => ({
    ...next,
    seenSequences: rememberSequence(next, sequence),
  });

  switch (event.type) {
    case "thinking.delta": {
      if (!event.delta) return mark(state);
      const items = state.items.slice();
      const last = items[items.length - 1];
      if (last?.kind === "thinking") {
        const text = appendMonotonicText(last.text, event.delta);
        if (text === last.text) return mark(state);
        // Keep original timestamp = when this thinking segment started.
        items[items.length - 1] = { ...last, text };
        return mark({ ...state, items });
      }
      const { id, seq } = nextId(state, "thinking");
      items.push({ id, kind: "thinking", text: event.delta, timestamp: nowIso() });
      return mark({ ...state, items, seq });
    }
    case "message.delta": {
      if (!event.delta) return mark(state);
      const items = state.items.slice();
      const last = items[items.length - 1];
      if (last?.kind === "assistant") {
        const text = appendMonotonicText(last.text, event.delta);
        if (text === last.text) return mark(state);
        items[items.length - 1] = { ...last, text };
        return mark({ ...state, items });
      }
      const { id, seq } = nextId(state, "assistant");
      items.push({ id, kind: "assistant", text: event.delta, timestamp: nowIso() });
      return mark({ ...state, items, seq });
    }
    case "user.message": {
      const source = splitAttachedPaths(event.content);
      const promptIndex = state.promptIndex + 1;
      const prompt = prompts[promptIndex - 1] ?? source.text;
      if (!prompt && source.paths.length === 0) {
        return mark({ ...state, promptIndex });
      }
      // Optimistic send may already have appended this user row.
      const last = state.items[state.items.length - 1];
      if (last?.kind === "user" && last.text === prompt) {
        return mark({ ...state, promptIndex });
      }
      const { id, seq } = nextId(state, "user");
      const item: Extract<TimelineItem, { kind: "user" }> = {
        id,
        kind: "user",
        text: prompt,
        timestamp: nowIso(),
        ...(source.paths.length > 0 ? { attachments: source.paths } : {}),
      };
      return mark({
        ...state,
        items: [...state.items, item],
        seq,
        promptIndex,
      });
    }
    case "tool.started": {
      const { id, seq } = nextId(state, "tool");
      const item: Extract<TimelineItem, { kind: "tool" }> = {
        id,
        kind: "tool",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "running",
        args: event.args,
        timestamp: nowIso(),
      };
      return mark({ ...state, items: [...state.items, item], seq });
    }
    case "tool.completed": {
      const items = state.items.slice();
      let found = false;
      for (let i = items.length - 1; i >= 0; i--) {
        const row = items[i];
        if (row?.kind === "tool" && row.toolCallId === event.toolCallId) {
          items[i] = {
            ...row,
            status: event.isError ? "error" : "completed",
            output: event.output || (event.isError ? "Tool failed" : "Done"),
            toolName: event.toolName || row.toolName,
          };
          found = true;
          break;
        }
      }
      if (found) return mark({ ...state, items });
      const { id, seq } = nextId(state, "tool");
      items.push({
        id,
        kind: "tool",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.isError ? "error" : "completed",
        output: event.output || (event.isError ? "Tool failed" : "Done"),
        timestamp: nowIso(),
      });
      return mark({ ...state, items, seq });
    }
    case "message.failed": {
      const { id, seq } = nextId(state, "system");
      return mark({
        ...state,
        seq,
        items: [
          ...state.items,
          {
            id,
            kind: "system",
            text: event.message,
            title: event.reason === "aborted" ? "Response stopped" : "Response failed",
            tone: "error",
            timestamp: nowIso(),
          },
        ],
      });
    }
    case "shell.completed": {
      const { id, seq } = nextId(state, "shell");
      const commandPrefix = event.excludeFromContext ? "!!" : "!";
      return mark({
        ...state,
        seq,
        items: [
          ...state.items,
          {
            id,
            kind: "system",
            title: `${commandPrefix} ${event.command}`,
            text: shellOutputMarkdown(event.output, event.exitCode),
            tone: event.exitCode === 0 ? "info" : "error",
            timestamp: nowIso(),
          },
        ],
      });
    }
    case "compaction.started": {
      const { id, seq } = nextId(state, "compaction");
      return mark({
        ...state,
        seq,
        items: [
          ...state.items,
          {
            id,
            kind: "system",
            title: "Compaction",
            text: `Compaction started (${event.reason})`,
            tone: "info",
            timestamp: nowIso(),
          },
        ],
      });
    }
    case "compaction.completed": {
      const { id, seq } = nextId(state, "compaction");
      return mark({
        ...state,
        seq,
        items: [
          ...state.items,
          {
            id,
            kind: "system",
            title: "Compaction",
            text:
              event.errorMessage ?? (event.aborted ? "Compaction aborted" : "Compaction completed"),
            tone: event.errorMessage || event.aborted ? "error" : "info",
            timestamp: nowIso(),
          },
        ],
      });
    }
    case "custom.message": {
      const { id, seq } = nextId(state, "custom");
      return mark({
        ...state,
        seq,
        items: [
          ...state.items,
          {
            id,
            kind: "system",
            title: event.customType,
            text: event.content,
            tone: "info",
            timestamp: nowIso(),
          },
        ],
      });
    }
    case "custom.entry": {
      const { id, seq } = nextId(state, "custom");
      let text = "";
      try {
        text = event.data === undefined ? "" : JSON.stringify(event.data, null, 2);
      } catch {
        text = "[unserializable value]";
      }
      return mark({
        ...state,
        seq,
        items: [
          ...state.items,
          {
            id,
            kind: "system",
            title: event.customType,
            text,
            tone: "info",
            timestamp: nowIso(),
          },
        ],
      });
    }
    // agent.started / agent.settled / message.completed / queue.updated — still mark sequence
    default:
      return mark(state);
  }
}

/** True if no assistant/thinking text field shrank vs previous state. */
export function assertLiveStreamTextMonotonic(
  prev: LiveStreamState,
  next: LiveStreamState,
): boolean {
  const prevTexts = new Map<string, string>();
  for (const item of prev.items) {
    if (item.kind === "assistant" || item.kind === "thinking") {
      prevTexts.set(item.id, item.text);
    }
  }
  for (const item of next.items) {
    if (item.kind !== "assistant" && item.kind !== "thinking") continue;
    const before = prevTexts.get(item.id);
    if (before !== undefined && item.text.length < before.length) return false;
    if (before !== undefined && !item.text.startsWith(before) && !before.startsWith(item.text)) {
      // Allow cumulative replace only when new text extends old (startsWith handled above).
      // Non-extension shrink/replace is a failure.
      if (!item.text.startsWith(before)) return false;
    }
  }
  return true;
}
