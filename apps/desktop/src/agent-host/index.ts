import {
  createPixRuntime,
  projectCustomEntry,
  projectCustomMessage,
  projectToolPresentation,
  type CreatePixRuntimeOptions,
  type PixRuntimeHandle,
} from "@pix/agent-runtime";
import {
  IPC_PROTOCOL_VERSION,
  type HostCommand,
  type HostEvent,
  isHostCommand,
  type RuntimeEvent,
} from "@pix/contracts";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";

interface ElectronParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): this;
  start(): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: ElectronParentPort }).parentPort;
if (!parentPort) throw new Error("Pix Agent Host must run as an Electron utility process");

let handle: PixRuntimeHandle | undefined;
let unsubscribe: (() => void) | undefined;
let sequence = 0;

function post(event: HostEvent): void {
  parentPort.postMessage(event);
}

function errorEvent(error: unknown, requestId?: string): HostEvent {
  const event: HostEvent = {
    protocolVersion: IPC_PROTOCOL_VERSION,
    type: "host.error",
    code: "HOST_COMMAND_FAILED",
    message: error instanceof Error ? error.message : "Unknown Agent Host error",
  };
  if (requestId) event.requestId = requestId;
  return event;
}

function toolOutput(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 16_000);
  if (typeof result !== "object" || result === null || !("content" in result)) return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("\n")
    .slice(0, 16_000);
}

function projectRuntimeEvent(event: AgentSessionEvent): RuntimeEvent | undefined {
  switch (event.type) {
    case "agent_start":
      return { type: "agent.started" };
    case "agent_settled":
      return { type: "agent.settled" };
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") return { type: "message.delta", delta: update.delta };
      return undefined;
    }
    case "message_end": {
      if (event.message.role === "custom") {
        const projected = projectCustomMessage(event.message);
        if (!projected) return undefined;
        const result: RuntimeEvent = {
          type: "custom.message",
          customType: projected.customType,
          content: projected.content,
        };
        if (projected.details !== undefined) result.details = projected.details;
        return result;
      }
      if (event.message.role !== "assistant") return undefined;
      const { stopReason } = event.message;
      if (stopReason === "stop" || stopReason === "length" || stopReason === "toolUse") {
        return { type: "message.completed", reason: stopReason };
      }
      return {
        type: "message.failed",
        reason: stopReason,
        message: event.message.errorMessage ?? `Model response ${stopReason}`,
      };
    }
    case "entry_appended": {
      const { entry } = event;
      if (!entry || typeof entry !== "object" || !("type" in entry) || entry.type !== "custom") {
        return undefined;
      }
      const projected = projectCustomEntry(
        entry as { type: string; customType?: string; data?: unknown },
      );
      if (!projected) return undefined;
      const result: RuntimeEvent = {
        type: "custom.entry",
        customType: projected.customType,
      };
      if (projected.data !== undefined) result.data = projected.data;
      return result;
    }
    case "tool_execution_start": {
      const projected = projectToolPresentation({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        args: event.args,
      });
      return {
        type: "tool.started",
        toolCallId: event.toolCallId,
        toolName: projected.toolName,
        args: projected.args,
      };
    }
    case "tool_execution_end": {
      const projected = projectToolPresentation({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        content: toolOutput(event.result),
        details:
          typeof event.result === "object" && event.result !== null && "details" in event.result
            ? (event.result as { details?: unknown }).details
            : undefined,
        isError: event.isError,
      });
      return {
        type: "tool.completed",
        toolCallId: event.toolCallId,
        toolName: projected.toolName,
        output: projected.content,
        isError: projected.isError,
      };
    }
    default:
      return undefined;
  }
}

function bindRuntimeEvents(runtimeHandle: PixRuntimeHandle): void {
  unsubscribe?.();
  unsubscribe = runtimeHandle.runtime.session.subscribe((event) => {
    const projected = projectRuntimeEvent(event);
    if (!projected) return;
    post({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "runtime.event",
      runtimeId: runtimeHandle.runtimeId,
      sequence: ++sequence,
      event: projected,
    });
  });
}

async function handleCommand(command: HostCommand): Promise<void> {
  try {
    switch (command.type) {
      case "host.start": {
        unsubscribe?.();
        unsubscribe = undefined;
        await handle?.dispose();
        const options: CreatePixRuntimeOptions = { cwd: command.cwd };
        if (command.agentDir) options.agentDir = command.agentDir;
        if (command.model) options.model = command.model;
        if (command.tools) options.tools = command.tools;
        if (command.persistSession !== undefined) options.persistSession = command.persistSession;
        if (command.sessionFile) options.sessionFile = command.sessionFile;
        if (command.resumeRecent !== undefined) options.resumeRecent = command.resumeRecent;
        if (command.projectTrusted !== undefined) options.projectTrusted = command.projectTrusted;
        options.onExtensionUiRequest = post;
        handle = await createPixRuntime(options);
        sequence = 0;
        bindRuntimeEvents(handle);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "host.ready",
          requestId: command.requestId,
          snapshot: handle.snapshot(sequence),
        });
        break;
      }
      case "host.snapshot": {
        if (!handle) throw new Error("Agent Host is not ready");
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "runtime.snapshot",
          requestId: command.requestId,
          snapshot: handle.snapshot(++sequence),
        });
        break;
      }
      case "agent.prompt": {
        if (!handle) throw new Error("Agent Host is not ready");
        await handle.runtime.session.prompt(command.message);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "runtime.snapshot",
          requestId: command.requestId,
          snapshot: handle.snapshot(++sequence),
        });
        break;
      }
      case "agent.abort": {
        if (!handle) throw new Error("Agent Host is not ready");
        await handle.runtime.session.abort();
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "runtime.snapshot",
          requestId: command.requestId,
          snapshot: handle.snapshot(++sequence),
        });
        break;
      }
      case "session.list": {
        if (!handle) throw new Error("Agent Host is not ready");
        const threads = await handle.listSessions();
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "session.list",
          requestId: command.requestId,
          threads,
          activeSessionId: handle.runtime.session.sessionId,
        });
        break;
      }
      case "session.new": {
        if (!handle) throw new Error("Agent Host is not ready");
        const result = await handle.newSession();
        if (result.cancelled) throw new Error("New session was cancelled");
        sequence = 0;
        bindRuntimeEvents(handle);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "session.opened",
          requestId: command.requestId,
          snapshot: handle.snapshot(sequence),
          threads: await handle.listSessions(),
          history: handle.historyMessages(),
        });
        break;
      }
      case "session.switch": {
        if (!handle) throw new Error("Agent Host is not ready");
        const result = await handle.switchSession(command.sessionPath);
        if (result.cancelled) throw new Error("Session switch was cancelled");
        sequence = 0;
        bindRuntimeEvents(handle);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "session.opened",
          requestId: command.requestId,
          snapshot: handle.snapshot(sequence),
          threads: await handle.listSessions(),
          history: handle.historyMessages(),
        });
        break;
      }
      case "session.fork": {
        if (!handle) throw new Error("Agent Host is not ready");
        // Default: fork at the current leaf so the branched JSONL includes an assistant
        // message and is flushed to disk (pi defers write when the branch has no assistant).
        // Explicit entryId forks before that user message (tree-branch semantics).
        let entryId = command.entryId;
        let position: "before" | "at" = "before";
        if (!entryId) {
          const leafId = handle.runtime.session.sessionManager.getLeafId();
          if (!leafId) throw new Error("No session leaf available to fork from");
          entryId = leafId;
          position = "at";
        }
        const result = await handle.fork(entryId, { position });
        if (result.cancelled) throw new Error("Session fork was cancelled");
        sequence = 0;
        bindRuntimeEvents(handle);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "session.opened",
          requestId: command.requestId,
          snapshot: handle.snapshot(sequence),
          threads: await handle.listSessions(),
          history: handle.historyMessages(),
        });
        break;
      }
      case "trust.get": {
        if (!handle) throw new Error("Agent Host is not ready");
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "trust.info",
          requestId: command.requestId,
          trust: handle.getTrust(),
        });
        break;
      }
      case "trust.set": {
        if (!handle) throw new Error("Agent Host is not ready");
        const snapshot = await handle.setTrust(command.trusted);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "runtime.snapshot",
          requestId: command.requestId,
          snapshot: { ...snapshot, sequence: ++sequence },
        });
        break;
      }
      case "model.list": {
        if (!handle) throw new Error("Agent Host is not ready");
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "model.list",
          requestId: command.requestId,
          models: handle.listModels(),
        });
        break;
      }
      case "model.set": {
        if (!handle) throw new Error("Agent Host is not ready");
        const snapshot = await handle.setModel(command.provider, command.id);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "runtime.snapshot",
          requestId: command.requestId,
          snapshot: { ...snapshot, sequence: ++sequence },
        });
        break;
      }
      case "thinking.set": {
        if (!handle) throw new Error("Agent Host is not ready");
        const snapshot = handle.setThinkingLevel(command.level);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "runtime.snapshot",
          requestId: command.requestId,
          snapshot: { ...snapshot, sequence: ++sequence },
        });
        break;
      }
      case "providers.list": {
        if (!handle) throw new Error("Agent Host is not ready");
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "providers.list",
          requestId: command.requestId,
          providers: handle.listProviders(),
        });
        break;
      }
      case "providers.setApiKey": {
        if (!handle) throw new Error("Agent Host is not ready");
        const providers = await handle.setProviderApiKey(command.provider, command.apiKey);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "providers.list",
          requestId: command.requestId,
          providers,
        });
        break;
      }
      case "providers.clearAuth": {
        if (!handle) throw new Error("Agent Host is not ready");
        const providers = await handle.clearProviderAuth(command.provider);
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "providers.list",
          requestId: command.requestId,
          providers,
        });
        break;
      }
      case "settings.get": {
        if (!handle) throw new Error("Agent Host is not ready");
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "settings.view",
          requestId: command.requestId,
          settings: handle.getPiSettings(),
        });
        break;
      }
      case "settings.patch": {
        if (!handle) throw new Error("Agent Host is not ready");
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "settings.view",
          requestId: command.requestId,
          settings: handle.patchPiSettings(command.patch),
        });
        break;
      }
      case "packages.list": {
        if (!handle) throw new Error("Agent Host is not ready");
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "packages.list",
          requestId: command.requestId,
          packages: handle.listPackages(),
        });
        break;
      }
      case "packages.install": {
        if (!handle) throw new Error("Agent Host is not ready");
        const packages = await handle.installPackage(command.source, command.scope, (event) => {
          const progress: HostEvent = {
            protocolVersion: IPC_PROTOCOL_VERSION,
            type: "packages.progress",
            requestId: command.requestId,
            action: event.action,
            source: event.source,
            phase: event.phase,
          };
          if (event.message) progress.message = event.message;
          post(progress);
        });
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "packages.changed",
          requestId: command.requestId,
          packages,
          action: "install",
          source: command.source,
        });
        break;
      }
      case "packages.remove": {
        if (!handle) throw new Error("Agent Host is not ready");
        const packages = await handle.removePackage(command.source, command.scope, (event) => {
          const progress: HostEvent = {
            protocolVersion: IPC_PROTOCOL_VERSION,
            type: "packages.progress",
            requestId: command.requestId,
            action: event.action,
            source: event.source,
            phase: event.phase,
          };
          if (event.message) progress.message = event.message;
          post(progress);
        });
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "packages.changed",
          requestId: command.requestId,
          packages,
          action: "remove",
          source: command.source,
        });
        break;
      }
      case "packages.update": {
        if (!handle) throw new Error("Agent Host is not ready");
        const packages = await handle.updatePackage(command.source, (event) => {
          const progress: HostEvent = {
            protocolVersion: IPC_PROTOCOL_VERSION,
            type: "packages.progress",
            requestId: command.requestId,
            action: event.action,
            source: event.source,
            phase: event.phase,
          };
          if (event.message) progress.message = event.message;
          post(progress);
        });
        const changed: HostEvent = {
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "packages.changed",
          requestId: command.requestId,
          packages,
          action: "update",
        };
        if (command.source) changed.source = command.source;
        post(changed);
        break;
      }
      case "resources.list": {
        if (!handle) throw new Error("Agent Host is not ready");
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "resources.list",
          requestId: command.requestId,
          resources: handle.listResources(),
        });
        break;
      }
      case "util.complete-text": {
        if (!handle) throw new Error("Agent Host is not ready");
        const text = await handle.completeText(command.prompt, {
          ...(command.systemPrompt ? { systemPrompt: command.systemPrompt } : {}),
          ...(command.model ? { model: command.model } : {}),
        });
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "util.text",
          requestId: command.requestId,
          text,
        });
        break;
      }
      case "extensionUi.respond": {
        if (!handle || command.runtimeId !== handle.runtimeId) break;
        handle.respondExtensionUi(command.response);
        break;
      }
      case "test.photonProbe": {
        if (!handle) throw new Error("Agent Host is not ready");
        if (process.env.PIX_ENABLE_TEST_COMMANDS !== "1") {
          throw new Error("Photon probe command is disabled");
        }
        const photon = await import("@silvia-odwyer/photon-node");
        const inputImage = photon.PhotonImage.new_from_byteslice(await readFile(command.imagePath));
        let outputImage: InstanceType<typeof photon.PhotonImage> | undefined;
        try {
          outputImage = photon.resize(inputImage, 1, 1, photon.SamplingFilter.Lanczos3);
          post({
            protocolVersion: IPC_PROTOCOL_VERSION,
            type: "test.photonResult",
            requestId: command.requestId,
            result: {
              extensions: handle.runtime.services.resourceLoader.getExtensions().extensions.length,
              extensionDiagnostics: handle.runtime.services.diagnostics.length,
              input: { width: inputImage.get_width(), height: inputImage.get_height() },
              output: {
                width: outputImage.get_width(),
                height: outputImage.get_height(),
                bytes: outputImage.get_bytes().byteLength,
              },
            },
          });
        } finally {
          outputImage?.free();
          inputImage.free();
        }
        break;
      }
      case "test.sequenceGap": {
        if (!handle) throw new Error("Agent Host is not ready");
        if (process.env.PIX_ENABLE_TEST_COMMANDS !== "1") {
          throw new Error("Sequence gap command is disabled");
        }
        sequence += 1;
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "runtime.event",
          runtimeId: handle.runtimeId,
          sequence: ++sequence,
          event: { type: "agent.started" },
        });
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "runtime.snapshot",
          requestId: command.requestId,
          snapshot: handle.snapshot(++sequence),
        });
        break;
      }
      case "host.shutdown": {
        unsubscribe?.();
        unsubscribe = undefined;
        await handle?.dispose();
        handle = undefined;
        post({
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "host.stopped",
          requestId: command.requestId,
        });
        break;
      }
    }
  } catch (error) {
    post(errorEvent(error, command.requestId));
  }
}

parentPort.on("message", (event) => {
  if (!isHostCommand(event.data)) {
    post(errorEvent(new Error("Rejected invalid Agent Host command")));
    return;
  }
  void handleCommand(event.data);
});
parentPort.start();

post({
  protocolVersion: IPC_PROTOCOL_VERSION,
  type: "host.hello",
  hostPid: process.pid,
});
