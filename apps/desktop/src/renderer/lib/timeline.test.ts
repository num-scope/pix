import type { HostEvent, RuntimeEvent } from "@pix/contracts";
import { IPC_PROTOCOL_VERSION } from "@pix/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildTimelineBlocks,
  historyToTimeline,
  projectEventsToTimeline,
  splitAttachedPaths,
} from "./timeline.ts";

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

    expect(
      timeline.map((item) => ({
        id: item.id,
        kind: item.kind,
        text: "text" in item ? item.text : "",
      })),
    ).toEqual([
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

    expect(timeline.map((item) => item.kind)).toEqual(["user", "thinking", "assistant", "tool"]);
    expect(timeline[0]).toMatchObject({
      kind: "user",
      text: "Inspect",
      attachments: ["/tmp/a&b.pdf"],
    });
    expect(timeline[3]).toMatchObject({
      kind: "tool",
      toolName: "read",
      status: "completed",
      output: "done",
    });
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

  it("shows shell output from live and persisted sessions", () => {
    expect(
      historyToTimeline([
        {
          role: "shell",
          text: "hello",
          command: "printf hello",
          exitCode: 0,
          excludeFromContext: true,
        },
      ])[0],
    ).toMatchObject({ kind: "system", title: "!! printf hello", text: "```text\nhello\n```" });

    expect(
      projectEventsToTimeline(
        [
          runtimeEvent(1, {
            type: "shell.completed",
            command: "false",
            output: "failed",
            exitCode: 1,
            excludeFromContext: false,
          }),
        ],
        [],
      )[0],
    ).toMatchObject({ kind: "system", title: "! false", tone: "error" });
  });

  it("shows compaction lifecycle events", () => {
    const projected = projectEventsToTimeline(
      [
        runtimeEvent(1, { type: "compaction.started", reason: "manual" }),
        runtimeEvent(2, {
          type: "compaction.completed",
          reason: "manual",
          aborted: false,
        }),
      ],
      [],
    );
    expect(projected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Compaction", text: "Compaction started (manual)" }),
        expect.objectContaining({ title: "Compaction", text: "Compaction completed" }),
      ]),
    );
  });

  it("groups thinking/tools into a process block before assistant", () => {
    const blocks = buildTimelineBlocks([
      { id: "u1", kind: "user", text: "hi" },
      { id: "t1", kind: "thinking", text: "plan" },
      {
        id: "tool1",
        kind: "tool",
        toolName: "bash",
        status: "completed",
        output: "ok",
      },
      { id: "a1", kind: "assistant", text: "done" },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["item", "process", "item"]);
    expect(blocks[1]).toMatchObject({ type: "process" });
    if (blocks[1]?.type === "process") {
      expect(blocks[1].items).toHaveLength(2);
    }
  });
});
