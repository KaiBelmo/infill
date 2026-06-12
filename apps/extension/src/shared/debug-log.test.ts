import { describe, expect, it, vi } from "vitest";

function installChromeMock() {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const listeners: Array<(changes: Record<string, { newValue?: unknown }>, areaName: string) => void> = [];
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension-id",
      sendMessage
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({})
      },
      onChanged: {
        addListener: (listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void) => {
          listeners.push(listener);
        }
      }
    }
  });
  return { sendMessage, listeners };
}

describe("debug-log wrapper", () => {
  it("keeps existing dev-mode console behavior and records snaplog events", async () => {
    vi.resetModules();
    const chromeMock = installChromeMock();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { debugLog } = await import("./debug-log");
    debugLog("hidden");

    expect(log).toHaveBeenCalledWith("hidden");
    expect(chromeMock.sendMessage).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("preserves console behavior and records snaplog events when debug is enabled", async () => {
    vi.resetModules();
    const chromeMock = installChromeMock();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const storage = new Map<string, string>([["infillDebug", "true"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null
    });

    const { debugLog, injectDebugLog } = await import("./debug-log");
    debugLog("visible", { token: "secret" });
    injectDebugLog({ fieldCount: 3 }, "scan.ts");

    expect(log).toHaveBeenCalledWith("visible", { token: "secret" });
    expect(chromeMock.sendMessage).toHaveBeenCalledTimes(2);
    expect(chromeMock.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      type: "snaplog-record",
      entry: { event: "debug", level: "log" }
    });
    expect(chromeMock.sendMessage.mock.calls[1]?.[0]).toMatchObject({
      type: "snaplog-record",
      entry: { event: "snapshot", variable: "fieldCount", value: 3, source: "scan.ts" }
    });
    log.mockRestore();
  });

  it("can enable debug from extension-owned storage", async () => {
    vi.resetModules();
    const chromeMock = installChromeMock();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { debugLog } = await import("./debug-log");
    chromeMock.listeners[0]?.({ infillDebug: { newValue: true } }, "local");
    debugLog("enabled by chrome storage");

    expect(log).toHaveBeenCalledWith("enabled by chrome storage");
    expect(chromeMock.sendMessage).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
