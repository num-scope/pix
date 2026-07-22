import { IPC_PROTOCOL_VERSION, type HostEvent } from "@pix/contracts";
import { describe, expect, it } from "vite-plus/test";
import { classifyRuntimeEventDelivery } from "./shell-store.ts";

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
