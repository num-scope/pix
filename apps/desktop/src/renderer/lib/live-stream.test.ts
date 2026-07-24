import { describe, expect, it } from "vite-plus/test";
import {
  appendMonotonicText,
  applyRuntimeEventToLiveStream,
  assertLiveStreamTextMonotonic,
  emptyLiveStream,
} from "./live-stream.ts";

describe("appendMonotonicText", () => {
  it("appends incremental chunks", () => {
    expect(appendMonotonicText("", "Hel")).toBe("Hel");
    expect(appendMonotonicText("Hel", "lo")).toBe("Hello");
    expect(appendMonotonicText("Hello", "!")).toBe("Hello!");
  });

  it("accepts cumulative full-text snapshots without shrinking", () => {
    expect(appendMonotonicText("Hel", "Hello")).toBe("Hello");
    expect(appendMonotonicText("Hello", "Hello")).toBe("Hello");
  });

  it("ignores exact chunk redelivery", () => {
    expect(appendMonotonicText("Hello", "lo")).toBe("Hello");
    expect(appendMonotonicText("Hello world", "world")).toBe("Hello world");
  });

  it("repairs partial overlap without losing prefix", () => {
    expect(appendMonotonicText("Hello wor", "world!")).toBe("Hello world!");
  });

  it("never returns a shorter string than prev when delta is non-empty prefix-lossy", () => {
    const prev = "The quick brown fox";
    // A totally new delta still appends (we never replace with shorter).
    const next = appendMonotonicText(prev, " jumps");
    expect(next.length).toBeGreaterThanOrEqual(prev.length);
    expect(next.startsWith(prev) || next === prev).toBe(true);
  });
});

describe("live stream (append-only)", () => {
  it("only grows assistant text under many deltas", () => {
    let state = emptyLiveStream();
    for (let i = 0; i < 300; i++) {
      state = applyRuntimeEventToLiveStream(state, { type: "message.delta", delta: `t${i} ` }, [], {
        sequence: i + 1,
      });
    }
    const assistant = state.items.find((item) => item.kind === "assistant");
    expect(assistant?.kind === "assistant" && assistant.text.startsWith("t0 ")).toBe(true);
    expect(assistant?.kind === "assistant" && assistant.text.includes("t299 ")).toBe(true);
    expect(
      assistant?.kind === "assistant" && assistant.text.split(/\s+/).filter(Boolean),
    ).toHaveLength(300);
  });

  it("dedupes by host sequence so redelivery does not double-append", () => {
    let state = emptyLiveStream();
    state = applyRuntimeEventToLiveStream(state, { type: "message.delta", delta: "Hello" }, [], {
      sequence: 10,
    });
    state = applyRuntimeEventToLiveStream(state, { type: "message.delta", delta: "Hello" }, [], {
      sequence: 10,
    });
    state = applyRuntimeEventToLiveStream(state, { type: "message.delta", delta: " world" }, [], {
      sequence: 11,
    });
    const assistant = state.items.find((item) => item.kind === "assistant");
    expect(assistant?.kind === "assistant" && assistant.text).toBe("Hello world");
  });

  it("keeps event order: thinking → assistant → tool → assistant", () => {
    let state = emptyLiveStream();
    state = applyRuntimeEventToLiveStream(state, { type: "thinking.delta", delta: "plan" }, [], {
      sequence: 1,
    });
    state = applyRuntimeEventToLiveStream(state, { type: "message.delta", delta: "Hi" }, [], {
      sequence: 2,
    });
    state = applyRuntimeEventToLiveStream(
      state,
      { type: "tool.started", toolCallId: "1", toolName: "bash", args: { command: "ls" } },
      [],
      { sequence: 3 },
    );
    state = applyRuntimeEventToLiveStream(
      state,
      {
        type: "tool.completed",
        toolCallId: "1",
        toolName: "bash",
        output: "ok",
        isError: false,
      },
      [],
      { sequence: 4 },
    );
    state = applyRuntimeEventToLiveStream(state, { type: "message.delta", delta: "Done" }, [], {
      sequence: 5,
    });

    expect(state.items.map((item) => item.kind)).toEqual([
      "thinking",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(state.items[1]).toMatchObject({ kind: "assistant", text: "Hi" });
    expect(state.items[3]).toMatchObject({ kind: "assistant", text: "Done" });
    expect(state.items[2]).toMatchObject({ kind: "tool", status: "completed" });
  });

  it("never shortens an existing assistant buffer across a long stream", () => {
    let state = emptyLiveStream();
    let prev = state;
    for (let i = 0; i < 200; i++) {
      state = applyRuntimeEventToLiveStream(state, { type: "message.delta", delta: `x${i}` }, [], {
        sequence: i + 1,
      });
      expect(assertLiveStreamTextMonotonic(prev, state)).toBe(true);
      prev = state;
    }
    const assistant = state.items.find((item) => item.kind === "assistant");
    expect(assistant?.kind === "assistant" && assistant.text.startsWith("x0")).toBe(true);
    expect(assistant?.kind === "assistant" && assistant.text.includes("x199")).toBe(true);
  });

  it("handles cumulative provider snapshots without eating the head", () => {
    let state = emptyLiveStream();
    state = applyRuntimeEventToLiveStream(state, { type: "message.delta", delta: "The" }, [], {
      sequence: 1,
    });
    state = applyRuntimeEventToLiveStream(state, { type: "message.delta", delta: "The cat" }, [], {
      sequence: 2,
    });
    state = applyRuntimeEventToLiveStream(
      state,
      { type: "message.delta", delta: "The cat sat" },
      [],
      { sequence: 3 },
    );
    const assistant = state.items.find((item) => item.kind === "assistant");
    expect(assistant?.kind === "assistant" && assistant.text).toBe("The cat sat");
  });
});
