import type { HostEvent, SessionHistoryMessage } from "@pix/contracts";

export type ThreadRunState =
  | "idle"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "aborted"
  | "crashed"
  | "recovering";

export type TimelineItem =
  | {
      id: string;
      kind: "user";
      text: string;
      attachments?: string[];
      timestamp?: string;
      entryId?: string;
    }
  | { id: string; kind: "assistant"; text: string; timestamp?: string }
  | { id: string; kind: "thinking"; text: string; timestamp?: string }
  | {
      id: string;
      kind: "tool";
      toolCallId?: string;
      toolName: string;
      status: "running" | "completed" | "error";
      args?: unknown;
      output?: string;
      timestamp?: string;
    }
  | {
      id: string;
      kind: "system";
      text: string;
      title?: string;
      tone?: "info" | "error";
      timestamp?: string;
    };

/** Render blocks: process steps collapse under “已处理”. */
export type TimelineBlock =
  | { type: "item"; item: TimelineItem }
  | {
      type: "process";
      id: string;
      items: Array<Extract<TimelineItem, { kind: "thinking" | "tool" }>>;
      durationLabel?: string;
    };

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function splitAttachedPaths(value: string): { text: string; paths: string[] } {
  const block = /\n*<attached-paths>\s*([\s\S]*?)\s*<\/attached-paths>\s*$/i.exec(value);
  if (!block) return { text: value, paths: [] };
  const paths = [...(block[1] ?? "").matchAll(/<path>([\s\S]*?)<\/path>/gi)]
    .map((match) => decodeXml(match[1] ?? "").trim())
    .filter(Boolean);
  return { text: value.slice(0, block.index).trimEnd(), paths };
}

export function deriveRunState(input: {
  hostStatus: string;
  running: boolean;
  lastFailure?: string | undefined;
}): ThreadRunState {
  const status = input.hostStatus.toLowerCase();
  if (status.includes("exited") || status.includes("crash")) return "crashed";
  if (status.includes("restart")) return "recovering";
  if (input.running) return "running";
  if (input.lastFailure) return "failed";
  if (status.includes("abort")) return "aborted";
  if (status.includes("settled") || status.includes("ready")) return "completed";
  if (status.includes("stopped")) return "idle";
  return "idle";
}

export function historyToTimeline(history: SessionHistoryMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const [index, item] of history.entries()) {
    if (item.role === "user") {
      const content = splitAttachedPaths(item.text);
      items.push({
        id: `history-user-${index}`,
        kind: "user",
        text: content.text,
        ...(content.paths.length > 0 ? { attachments: content.paths } : {}),
        ...(item.entryId ? { entryId: item.entryId } : {}),
        ...(item.timestamp ? { timestamp: item.timestamp } : {}),
      });
      continue;
    }
    if (item.role === "assistant") {
      items.push({
        id: `history-assistant-${index}`,
        kind: "assistant",
        text: item.text,
        ...(item.timestamp ? { timestamp: item.timestamp } : {}),
      });
      continue;
    }
    if (item.role === "thinking") {
      items.push({
        id: `history-thinking-${index}`,
        kind: "thinking",
        text: item.text,
        ...(item.timestamp ? { timestamp: item.timestamp } : {}),
      });
      continue;
    }
    if (item.role === "tool") {
      items.push({
        id: `history-tool-${index}`,
        kind: "tool",
        toolName: item.toolName ?? "tool",
        status: item.isError === true ? "error" : "completed",
        output: item.text,
        ...(item.timestamp ? { timestamp: item.timestamp } : {}),
      });
      continue;
    }
    items.push({
      id: `history-system-${index}`,
      kind: "system",
      text: item.text,
      ...(item.timestamp ? { timestamp: item.timestamp } : {}),
    });
  }
  return items;
}

export function projectEventsToTimeline(events: HostEvent[], prompts: string[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let assistantBuffer = "";
  let thinkingBuffer = "";
  let assistantId = 0;
  let thinkingId = 0;
  let promptIndex = 0;
  const tools = new Map<string, Extract<TimelineItem, { kind: "tool" }>>();
  const now = () => new Date().toISOString();

  const flushAssistant = () => {
    if (!assistantBuffer) return;
    items.push({
      id: `assistant-${assistantId++}`,
      kind: "assistant",
      text: assistantBuffer,
      timestamp: now(),
    });
    assistantBuffer = "";
  };

  const flushThinking = () => {
    if (!thinkingBuffer) return;
    items.push({
      id: `thinking-${thinkingId++}`,
      kind: "thinking",
      text: thinkingBuffer,
      timestamp: now(),
    });
    thinkingBuffer = "";
  };

  const flushMessage = () => {
    flushThinking();
    flushAssistant();
  };

  for (const event of events) {
    if (event.type === "runtime.event") {
      const { event: runtimeEvent } = event;
      if (runtimeEvent.type === "agent.started") {
        flushMessage();
      } else if (runtimeEvent.type === "user.message") {
        flushMessage();
        const source = splitAttachedPaths(runtimeEvent.content);
        const prompt = prompts[promptIndex++] ?? source.text;
        if (prompt || source.paths.length > 0) {
          items.push({
            id: `user-${promptIndex}`,
            kind: "user",
            text: prompt,
            ...(source.paths.length > 0 ? { attachments: source.paths } : {}),
            timestamp: now(),
          });
        }
      } else if (runtimeEvent.type === "thinking.delta") {
        flushAssistant();
        thinkingBuffer += runtimeEvent.delta;
      } else if (runtimeEvent.type === "message.delta") {
        flushThinking();
        assistantBuffer += runtimeEvent.delta;
      } else if (runtimeEvent.type === "message.completed") {
        flushMessage();
      } else if (runtimeEvent.type === "message.failed") {
        flushMessage();
        items.push({
          id: `system-fail-${items.length}`,
          kind: "system",
          text: runtimeEvent.message,
          title: runtimeEvent.reason === "aborted" ? "Response stopped" : "Response failed",
          tone: "error",
          timestamp: now(),
        });
      } else if (runtimeEvent.type === "tool.started") {
        flushMessage();
        const tool: Extract<TimelineItem, { kind: "tool" }> = {
          id: `tool-start-${runtimeEvent.toolCallId}`,
          kind: "tool",
          toolCallId: runtimeEvent.toolCallId,
          toolName: runtimeEvent.toolName,
          status: "running",
          args: runtimeEvent.args,
          timestamp: now(),
        };
        tools.set(runtimeEvent.toolCallId, tool);
        items.push(tool);
      } else if (runtimeEvent.type === "tool.completed") {
        flushMessage();
        const tool = tools.get(runtimeEvent.toolCallId);
        if (tool) {
          tool.status = runtimeEvent.isError ? "error" : "completed";
          tool.output = runtimeEvent.output || (runtimeEvent.isError ? "Tool failed" : "Done");
        } else {
          items.push({
            id: `tool-end-${runtimeEvent.toolCallId}`,
            kind: "tool",
            toolCallId: runtimeEvent.toolCallId,
            toolName: runtimeEvent.toolName,
            status: runtimeEvent.isError ? "error" : "completed",
            output: runtimeEvent.output || (runtimeEvent.isError ? "Tool failed" : "Done"),
            timestamp: now(),
          });
        }
      } else if (runtimeEvent.type === "custom.message") {
        flushMessage();
        items.push({
          id: `custom-${items.length}`,
          kind: "system",
          title: runtimeEvent.customType,
          text: runtimeEvent.content || summarizeData(runtimeEvent.details),
          tone: "info",
          timestamp: now(),
        });
      } else if (runtimeEvent.type === "custom.entry") {
        flushMessage();
        items.push({
          id: `custom-entry-${items.length}`,
          kind: "system",
          title: runtimeEvent.customType,
          text: summarizeData(runtimeEvent.data),
          tone: "info",
          timestamp: now(),
        });
      }
    } else if (event.type === "host.crashed") {
      flushMessage();
      items.push({
        id: `crash-${items.length}`,
        kind: "system",
        text: event.message,
        title: "Agent Host crashed",
        tone: "error",
        timestamp: now(),
      });
    } else if (event.type === "host.restarted") {
      flushMessage();
      items.push({
        id: `restart-${items.length}`,
        kind: "system",
        text: "Agent Host restarted",
        tone: "info",
        timestamp: now(),
      });
    }
  }

  flushMessage();
  return items;
}

/**
 * Collapse consecutive thinking/tool items into a process group before each assistant reply.
 */
export function buildTimelineBlocks(items: TimelineItem[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  let process: Array<Extract<TimelineItem, { kind: "thinking" | "tool" }>> = [];

  const flushProcess = () => {
    if (process.length === 0) return;
    const first = process[0]?.timestamp;
    const last = process[process.length - 1]?.timestamp;
    let durationLabel: string | undefined;
    if (first && last) {
      const ms = Math.max(0, new Date(last).getTime() - new Date(first).getTime());
      durationLabel = formatDurationMs(ms);
    }
    blocks.push({
      type: "process",
      id: `process-${process[0]!.id}`,
      items: process,
      ...(durationLabel ? { durationLabel } : {}),
    });
    process = [];
  };

  for (const item of items) {
    if (item.kind === "thinking" || item.kind === "tool") {
      process.push(item);
      continue;
    }
    flushProcess();
    blocks.push({ type: "item", item });
  }
  flushProcess();
  return blocks;
}

export function formatMessageTime(iso: string | undefined, locale: "zh" | "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

export function formatDurationMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function summarizeData(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable value]";
  }
}

