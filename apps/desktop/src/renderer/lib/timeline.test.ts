import type { HostEvent, RuntimeEvent } from "@pix/contracts";
import { IPC_PROTOCOL_VERSION } from "@pix/contracts";
import { describe, expect, it } from "vite-plus/test";
import { historyToTimeline, projectEventsToTimeline, splitAttachedPaths } from "./timeline.ts";

function runtimeEvent(sequence: number, event: RuntimeEvent): HostEvent {
  return {
    protocolVersion: IPC_PROTOCOL_VERSION,
    type: "runtime.event",
    runtimeId: "runtime-1",
    sequence,
    event,
  };
}

describe("runtime timeline", () => {
  it("renders each delivered queued user message in processing order", () => {
    const timeline = projectEventsToTimeline(
      [
        runtimeEvent(1, { type: "agent.started" }),
        runtimeEvent(2, { type: "user.message", content: "expanded first" }),
        runtimeEvent(3, { type: "message.delta", delta: "working" }),
        runtimeEvent(4, { type: "user.message", content: "expanded queued" }),
      ],
      ["first", "queued"],
    );

    expect(timeline).toEqual([
      { id: "user-1", kind: "user", text: "first" },
      { id: "assistant-0", kind: "assistant", text: "working" },
      { id: "user-2", kind: "user", text: "queued" },
    ]);
  });

  it("keeps thinking separate and merges tool start and completion into one card", () => {
    const content =
      "Inspect\n\n<attached-paths>\n  <path>/tmp/a&amp;b.pdf</path>\n</attached-paths>";
    const timeline = projectEventsToTimeline(
      [
        runtimeEvent(1, { type: "user.message", content }),
        runtimeEvent(2, { type: "thinking.delta", delta: "Check the inputs" }),
        runtimeEvent(3, { type: "message.delta", delta: "I will inspect it." }),
        runtimeEvent(4, {
          type: "tool.started",
          toolCallId: "tool-1",
          toolName: "read",
          args: { path: "/tmp/a&b.pdf" },
        }),
        runtimeEvent(5, {
          type: "tool.completed",
          toolCallId: "tool-1",
          toolName: "read",
          output: "done",
          isError: false,
        }),
      ],
      ["Inspect"],
    );

    expect(timeline).toEqual([
      {
        id: "user-1",
        kind: "user",
        text: "Inspect",
        attachments: ["/tmp/a&b.pdf"],
      },
      { id: "thinking-0", kind: "thinking", text: "Check the inputs" },
      { id: "assistant-0", kind: "assistant", text: "I will inspect it." },
      {
        id: "tool-start-tool-1",
        kind: "tool",
        toolCallId: "tool-1",
        toolName: "read",
        status: "completed",
        args: { path: "/tmp/a&b.pdf" },
        output: "done",
      },
    ]);
  });

  it("projects persisted thinking and extracts attached path metadata", () => {
    expect(
      historyToTimeline([
        { role: "thinking", text: "Reasoning" },
        {
          role: "user",
          text: "Open this\n\n<attached-paths><path>/tmp/demo.py</path></attached-paths>",
        },
      ]),
    ).toEqual([
      { id: "history-thinking-0", kind: "thinking", text: "Reasoning" },
      {
        id: "history-user-1",
        kind: "user",
        text: "Open this",
        attachments: ["/tmp/demo.py"],
      },
    ]);
    expect(splitAttachedPaths("plain text")).toEqual({ text: "plain text", paths: [] });
  });
});
