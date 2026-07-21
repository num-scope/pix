import { describe, expect, it } from "vite-plus/test";
import { IPC_PROTOCOL_VERSION, isHostCommand, isHostEvent } from "../src/index.ts";

describe("host contract validation", () => {
  it("accepts a valid start command", () => {
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "host.start",
        requestId: "request-1",
        cwd: "/tmp/project",
      }),
    ).toBe(true);
  });

  it("rejects unknown commands and protocol versions", () => {
    expect(
      isHostCommand({ protocolVersion: 2, type: "host.start", requestId: "r", cwd: "/tmp" }),
    ).toBe(false);
    expect(
      isHostCommand({ protocolVersion: IPC_PROTOCOL_VERSION, type: "host.exec", requestId: "r" }),
    ).toBe(false);
  });

  it("accepts prompt commands and projected runtime events", () => {
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "agent.prompt",
        requestId: "request-2",
        message: "hello",
      }),
    ).toBe(true);
    expect(
      isHostEvent({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "runtime.event",
        runtimeId: "runtime-1",
        sequence: 3,
        event: { type: "message.delta", delta: "hello" },
      }),
    ).toBe(true);
  });

  it("accepts persistent starts and crash lifecycle diagnostics", () => {
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "host.start",
        requestId: "request-persist",
        cwd: "/tmp/project",
        persistSession: true,
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "test.photonProbe",
        requestId: "request-photon",
        imagePath: "/tmp/input.png",
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "test.sequenceGap",
        requestId: "request-gap",
      }),
    ).toBe(true);
    expect(
      isHostEvent({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "test.photonResult",
        requestId: "request-photon",
        result: {
          extensions: 1,
          extensionDiagnostics: 0,
          input: { width: 2, height: 2 },
          output: { width: 1, height: 1, bytes: 70 },
        },
      }),
    ).toBe(true);
    expect(
      isHostEvent({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "host.crashed",
        hostId: "host-1",
        runtimeId: "runtime-1",
        exitCode: 1,
        message: "Agent Host exited unexpectedly with code 1",
      }),
    ).toBe(true);
  });

  it("accepts Extension UI requests and correlated responses", () => {
    expect(
      isHostEvent({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "extensionUi.request",
        runtimeId: "runtime-ui",
        requestId: "ui-1",
        method: "confirm",
        args: { title: "Confirm", message: "Continue?" },
        timeoutMs: 1000,
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "extensionUi.respond",
        requestId: "command-ui-1",
        runtimeId: "runtime-ui",
        response: { runtimeId: "runtime-ui", requestId: "ui-1", ok: true, value: true },
      }),
    ).toBe(true);
  });

  it("accepts hello and rejects malformed errors", () => {
    expect(
      isHostEvent({ protocolVersion: IPC_PROTOCOL_VERSION, type: "host.hello", hostPid: 42 }),
    ).toBe(true);
    expect(
      isHostEvent({ protocolVersion: IPC_PROTOCOL_VERSION, type: "host.error", code: "FAILED" }),
    ).toBe(false);
  });

  it("accepts providers list command and non-secret events", () => {
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "providers.list",
        requestId: "prov-1",
      }),
    ).toBe(true);
    expect(
      isHostEvent({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "providers.list",
        providers: [
          {
            provider: "pix-fake",
            displayName: "Pix",
            configured: true,
            source: "models_json_key",
            modelCount: 1,
            oauthAvailable: false,
          },
        ],
      }),
    ).toBe(true);
    expect(
      isHostEvent({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "providers.list",
        providers: [
          {
            provider: "x",
            displayName: "x",
            configured: true,
            modelCount: 1,
            oauthAvailable: false,
            apiKey: "sk-leak",
          },
        ],
      }),
    ).toBe(false);
  });

  it("accepts packages/resources list commands and events", () => {
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "packages.install",
        requestId: "pkg-install",
        source: "./vendor/pkg",
        scope: "project",
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "packages.remove",
        requestId: "pkg-remove",
        source: "./vendor/pkg",
        scope: "global",
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "packages.update",
        requestId: "pkg-update",
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "packages.list",
        requestId: "pkg-1",
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "resources.list",
        requestId: "res-1",
      }),
    ).toBe(true);
    expect(
      isHostEvent({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "packages.list",
        packages: [
          {
            source: "./vendor/pkg",
            scope: "project",
            kind: "local",
            filtered: false,
            installedPath: "/tmp/vendor/pkg",
          },
        ],
      }),
    ).toBe(true);
    expect(
      isHostEvent({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "resources.list",
        resources: [{ kind: "skill", name: "demo", path: "/tmp/SKILL.md", source: "local" }],
      }),
    ).toBe(true);
  });

  it("accepts session fork command", () => {
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "session.fork",
        requestId: "fork-1",
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "session.fork",
        requestId: "fork-2",
        entryId: "entry-user-1",
      }),
    ).toBe(true);
  });

  it("accepts session list/new/switch commands and opened events", () => {
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "session.list",
        requestId: "list-1",
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "session.new",
        requestId: "new-1",
      }),
    ).toBe(true);
    expect(
      isHostCommand({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "session.switch",
        requestId: "switch-1",
        sessionPath: "/tmp/session.jsonl",
      }),
    ).toBe(true);
    expect(
      isHostEvent({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "session.list",
        requestId: "list-1",
        threads: [
          {
            id: "s1",
            path: "/tmp/s1.jsonl",
            cwd: "/tmp/project",
            title: "Hello",
            modifiedAt: "2026-07-16T00:00:00.000Z",
            messageCount: 2,
            active: true,
          },
        ],
        activeSessionId: "s1",
      }),
    ).toBe(true);
  });
});
