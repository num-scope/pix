import { describe, expect, it } from "vite-plus/test";
import { projectSessionHistory } from "../src/index.ts";

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
});
