import { describe, expect, it, vi } from "vitest";

function installChromeStorageMock() {
  let values: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: values[key] };
        },
        async set(items: Record<string, unknown>) {
          values = { ...values, ...items };
        },
        async remove(key: string) {
          delete values[key];
        }
      }
    }
  });
}

describe("private sync snaplog compatibility wrapper", () => {
  it("preserves the existing private sync debug record shape", async () => {
    vi.resetModules();
    installChromeStorageMock();
    const {
      beginPrivateSyncDebug,
      recordPrivateSyncDebug,
      finishPrivateSyncDebug,
      getPrivateSyncDebug
    } = await import("./private-sync-debug");

    const attemptId = await beginPrivateSyncDebug({ token: "secret", visible: true });
    await recordPrivateSyncDebug("derive-key-start", { count: 1 }, attemptId);
    await finishPrivateSyncDebug("error", new Error("failed"), attemptId);

    await expect(getPrivateSyncDebug()).resolves.toMatchObject({
      attemptId,
      status: "error",
      events: [
        { stage: "attempt-start", details: { token: "[redacted]", visible: true } },
        { stage: "derive-key-start", details: { count: 1 } }
      ],
      error: { name: "Error", message: "failed" }
    });
  });
});
