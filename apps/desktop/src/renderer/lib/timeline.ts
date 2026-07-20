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
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "tool"; toolName: string; detail: string; isError?: boolean }
  | { id: string; kind: "system"; text: string };

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
      items.push({ id: `history-user-${index}`, kind: "user", text: item.text });
      continue;
    }
    if (item.role === "assistant") {
      items.push({ id: `history-assistant-${index}`, kind: "assistant", text: item.text });
      continue;
    }
    if (item.role === "tool") {
      const toolItem: TimelineItem = {
        id: `history-tool-${index}`,
        kind: "tool",
        toolName: item.toolName ?? "tool",
        detail: item.text,
      };
      if (item.isError === true) toolItem.isError = true;
      items.push(toolItem);
      continue;
    }
    items.push({ id: `history-system-${index}`, kind: "system", text: item.text });
  }
  return items;
}

export function projectEventsToTimeline(events: HostEvent[], prompts: string[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let assistantBuffer = "";
  let assistantId = 0;
  let promptIndex = 0;

  const flushAssistant = () => {
    if (!assistantBuffer) return;
    items.push({
      id: `assistant-${assistantId++}`,
      kind: "assistant",
      text: assistantBuffer,
    });
    assistantBuffer = "";
  };

  for (const event of events) {
    if (event.type === "runtime.event") {
      const { event: runtimeEvent } = event;
      if (runtimeEvent.type === "agent.started") {
        flushAssistant();
        const prompt = prompts[promptIndex++];
        if (prompt) {
          items.push({ id: `user-${promptIndex}`, kind: "user", text: prompt });
        }
      } else if (runtimeEvent.type === "message.delta") {
        assistantBuffer += runtimeEvent.delta;
      } else if (runtimeEvent.type === "message.completed") {
        flushAssistant();
      } else if (runtimeEvent.type === "message.failed") {
        flushAssistant();
        items.push({
          id: `system-fail-${items.length}`,
          kind: "system",
          text: runtimeEvent.message,
        });
      } else if (runtimeEvent.type === "tool.started") {
        flushAssistant();
        items.push({
          id: `tool-start-${runtimeEvent.toolCallId}`,
          kind: "tool",
          toolName: runtimeEvent.toolName,
          detail: summarizeArgs(runtimeEvent.args),
        });
      } else if (runtimeEvent.type === "tool.completed") {
        flushAssistant();
        items.push({
          id: `tool-end-${runtimeEvent.toolCallId}`,
          kind: "tool",
          toolName: runtimeEvent.toolName,
          detail: runtimeEvent.output || (runtimeEvent.isError ? "Tool failed" : "Done"),
          isError: runtimeEvent.isError,
        });
      } else if (runtimeEvent.type === "custom.message") {
        flushAssistant();
        items.push({
          id: `custom-${items.length}`,
          kind: "system",
          text: `[${runtimeEvent.customType}] ${runtimeEvent.content}`,
        });
      }
    } else if (event.type === "host.crashed") {
      flushAssistant();
      items.push({
        id: `crash-${items.length}`,
        kind: "system",
        text: event.message,
      });
    } else if (event.type === "host.restarted") {
      flushAssistant();
      items.push({
        id: `restart-${items.length}`,
        kind: "system",
        text: "Agent Host restarted",
      });
    }
  }

  flushAssistant();
  return items;
}

function summarizeArgs(args: unknown): string {
  if (args === undefined || args === null) return "Running…";
  if (typeof args === "string") return args;
  try {
    const text = JSON.stringify(args);
    return text.length > 160 ? `${text.slice(0, 159)}…` : text;
  } catch {
    return "Running…";
  }
}

export function snapshotSummary(snapshot: HostSnapshot | undefined): string {
  if (!snapshot) return "No runtime snapshot";
  const model = snapshot.model ? `${snapshot.model.provider}/${snapshot.model.id}` : "no model";
  return `${model} · tools ${snapshot.activeTools.join(", ") || "none"} · ext ${snapshot.resources.extensions}`;
}
