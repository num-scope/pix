import type { HostEvent, HostSnapshot, SessionHistoryMessage } from "@pix/contracts";

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
  | { id: string; kind: "user"; text: string; attachments?: string[] }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "thinking"; text: string }
  | {
      id: string;
      kind: "tool";
      toolCallId?: string;
      toolName: string;
      status: "running" | "completed" | "error";
      args?: unknown;
      output?: string;
    }
  | { id: string; kind: "system"; text: string; title?: string; tone?: "info" | "error" };

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
      });
      continue;
    }
    if (item.role === "assistant") {
      items.push({ id: `history-assistant-${index}`, kind: "assistant", text: item.text });
      continue;
    }
    if (item.role === "thinking") {
      items.push({ id: `history-thinking-${index}`, kind: "thinking", text: item.text });
      continue;
    }
    if (item.role === "tool") {
      items.push({
        id: `history-tool-${index}`,
        kind: "tool",
        toolName: item.toolName ?? "tool",
        status: item.isError === true ? "error" : "completed",
        output: item.text,
      });
      continue;
    }
    items.push({ id: `history-system-${index}`, kind: "system", text: item.text });
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

  const flushAssistant = () => {
    if (!assistantBuffer) return;
    items.push({
      id: `assistant-${assistantId++}`,
      kind: "assistant",
      text: assistantBuffer,
    });
    assistantBuffer = "";
  };

  const flushThinking = () => {
    if (!thinkingBuffer) return;
    items.push({
      id: `thinking-${thinkingId++}`,
      kind: "thinking",
      text: thinkingBuffer,
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
        });
      } else if (runtimeEvent.type === "custom.entry") {
        flushMessage();
        items.push({
          id: `custom-entry-${items.length}`,
          kind: "system",
          title: runtimeEvent.customType,
          text: summarizeData(runtimeEvent.data),
          tone: "info",
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
      });
    } else if (event.type === "host.restarted") {
      flushMessage();
      items.push({
        id: `restart-${items.length}`,
        kind: "system",
        text: "Agent Host restarted",
        tone: "info",
      });
    }
  }

  flushMessage();
  return items;
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

export function snapshotSummary(snapshot: HostSnapshot | undefined): string {
  if (!snapshot) return "No runtime snapshot";
  const model = snapshot.model ? `${snapshot.model.provider}/${snapshot.model.id}` : "no model";
  return `${model} · tools ${snapshot.activeTools.join(", ") || "none"} · ext ${snapshot.resources.extensions}`;
}
