import { IPC_PROTOCOL_VERSION, type HostEvent } from "@pix/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  classifyRuntimeEventDelivery,
  sessionKeyFromSnapshot,
  sessionRunKey,
  useShellStore,
} from "./shell-store.ts";
import { isBusyRunState } from "../lib/session-markers.ts";

function runtimeEvent(
  runtimeId: string,
  sequence: number,
): Extract<HostEvent, { type: "runtime.event" }> {
  return {
    protocolVersion: IPC_PROTOCOL_VERSION,
    type: "runtime.event",
    runtimeId,
    sequence,
    event: { type: "message.delta", delta: "text" },
  };
}

describe("runtime event delivery", () => {
  it("accepts an unrecorded event covered by an overtaking snapshot", () => {
    expect(
      classifyRuntimeEventDelivery(
        { runtimeId: "runtime-1", lastSequence: 12, events: [] },
        runtimeEvent("runtime-1", 4),
      ),
    ).toBe("accept");
  });

  it("rejects duplicates, stale runtimes, and real forward gaps", () => {
    const recorded = runtimeEvent("runtime-1", 4);
    const state = { runtimeId: "runtime-1", lastSequence: 4, events: [recorded] };

    expect(classifyRuntimeEventDelivery(state, recorded)).toBe("duplicate");
    expect(classifyRuntimeEventDelivery(state, runtimeEvent("runtime-2", 5))).toBe("stale-runtime");
    expect(classifyRuntimeEventDelivery(state, runtimeEvent("runtime-1", 6))).toBe("gap");
    expect(classifyRuntimeEventDelivery(state, runtimeEvent("runtime-1", 5))).toBe("accept");
  });
});

describe("per-session running", () => {
  it("normalizes session keys", () => {
    expect(sessionRunKey("/tmp/Foo/")).toBe("/tmp/foo");
    expect(sessionKeyFromSnapshot({ sessionFile: "/tmp/A.jsonl", sessionId: "id-1" })).toBe(
      "/tmp/a.jsonl",
    );
  });

  it("tracks background sessions without forcing foreground running", () => {
    useShellStore.setState({
      running: false,
      sessionMarkers: {},
      runningSessions: {},
      runningRuntimeIds: {},
      snapshot: {
        runtimeId: "rt-fg",
        sequence: 1,
        cwd: "/tmp",
        agentDir: "/tmp/agent",
        sessionId: "fg",
        sessionFile: "/tmp/fg.jsonl",
        slashCommands: [],
        queuedMessages: { steering: [], followUp: [] },
        activeTools: [],
        projectTrusted: true,
        resources: { extensions: 0, skills: 0, prompts: 0, themes: 0, contextFiles: 0 },
        configuredPackages: { global: 0, project: 0 },
        diagnostics: [],
      },
    });
    useShellStore.getState().setSessionRunning("/tmp/bg.jsonl", true, "rt-bg");
    expect(useShellStore.getState().runningSessions["/tmp/bg.jsonl"]).toBe(true);
    expect(useShellStore.getState().sessionMarkers["/tmp/bg.jsonl"]?.state).toBe("running");
    // Foreground is still idle.
    expect(useShellStore.getState().running).toBe(false);

    useShellStore.getState().setSessionRunning("/tmp/fg.jsonl", true, "rt-fg");
    expect(useShellStore.getState().running).toBe(true);

    useShellStore.getState().settleSessionByRuntime("rt-bg", "completed");
    expect(useShellStore.getState().sessionMarkers["/tmp/bg.jsonl"]?.state).toBe("completed");
    expect(useShellStore.getState().runningSessions["/tmp/bg.jsonl"]).toBeUndefined();
    expect(useShellStore.getState().running).toBe(true);

    useShellStore.getState().setSessionRunning("/tmp/fg.jsonl", false, "rt-fg");
    expect(useShellStore.getState().running).toBe(false);
  });

  it("keeps failed marker when prompt finally clears busy", () => {
    useShellStore.setState({
      running: true,
      sessionMarkers: {},
      runningSessions: {},
      runningRuntimeIds: {},
      snapshot: {
        runtimeId: "rt-1",
        sequence: 1,
        cwd: "/tmp",
        agentDir: "/tmp/agent",
        sessionId: "s1",
        sessionFile: "/tmp/s1.jsonl",
        slashCommands: [],
        queuedMessages: { steering: [], followUp: [] },
        activeTools: [],
        projectTrusted: true,
        resources: { extensions: 0, skills: 0, prompts: 0, themes: 0, contextFiles: 0 },
        configuredPackages: { global: 0, project: 0 },
        diagnostics: [],
      },
    });
    useShellStore.getState().setSessionRunning("/tmp/s1.jsonl", true, "rt-1");
    useShellStore.getState().settleSessionByRuntime("rt-1", "failed", "boom");
    expect(useShellStore.getState().sessionMarkers["/tmp/s1.jsonl"]?.state).toBe("failed");
    useShellStore.getState().setSessionRunning("/tmp/s1.jsonl", false, "rt-1");
    expect(useShellStore.getState().sessionMarkers["/tmp/s1.jsonl"]?.state).toBe("failed");
    expect(isBusyRunState(useShellStore.getState().sessionMarkers["/tmp/s1.jsonl"]?.state)).toBe(
      false,
    );
  });
});
