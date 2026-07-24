import { describe, expect, it } from "vite-plus/test";
import { projectHistoryFromSessionManager, projectSessionHistory } from "../src/index.ts";

describe("session history projection", () => {
  it("preserves ordered thinking and assistant text blocks", () => {
    expect(
      projectSessionHistory(
        [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Inspect context" },
              { type: "text", text: "Here is the result" },
            ],
          },
        ],
        ["entry-1"],
      ),
    ).toEqual([
      { role: "thinking", text: "Inspect context", entryId: "entry-1" },
      { role: "assistant", text: "Here is the result", entryId: "entry-1" },
    ]);
  });

  it("projects persisted shell executions with command metadata", () => {
    expect(
      projectSessionHistory(
        [
          {
            role: "bashExecution",
            command: "printf hello",
            output: "hello",
            exitCode: 0,
            excludeFromContext: true,
          },
        ],
        ["entry-shell"],
      ),
    ).toEqual([
      {
        role: "shell",
        text: "hello",
        command: "printf hello",
        exitCode: 0,
        excludeFromContext: true,
        entryId: "entry-shell",
      },
    ]);
  });

  it("projects compaction entries instead of dropping them", () => {
    expect(
      projectHistoryFromSessionManager({
        getEntries: () => [
          {
            type: "compaction",
            id: "compact-1",
            timestamp: "2026-01-01T00:00:00.000Z",
            summary: "Earlier work summary",
          },
        ],
      }),
    ).toEqual([
      {
        role: "system",
        title: "Compaction",
        text: "Earlier work summary",
        entryId: "compact-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("prefers getBranch so abandoned siblings are not shown after navigateTree", () => {
    const allEntries = [
      {
        type: "message",
        id: "u1",
        message: { role: "user", content: "first" },
      },
      {
        type: "message",
        id: "a1",
        message: { role: "assistant", content: [{ type: "text", text: "reply" }] },
      },
      {
        type: "message",
        id: "u2",
        message: { role: "user", content: "second branch" },
      },
    ];
    expect(
      projectHistoryFromSessionManager({
        getEntries: () => allEntries,
        // Active path rewound to first user only (sibling branch hidden).
        getBranch: () => [allEntries[0]!],
      }),
    ).toEqual([{ role: "user", text: "first", entryId: "u1" }]);
  });
});
