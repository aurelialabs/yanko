import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readEmotionSignalDispatchConfig = vi.hoisted(() => vi.fn());
const verifyEmotionSignalDispatch = vi.hoisted(() => vi.fn());
const dispatchEmotionSignalJob = vi.hoisted(() => vi.fn());

vi.mock("@/modules/ai/emotion-signal-dispatch", () => ({
  readEmotionSignalDispatchConfig,
  verifyEmotionSignalDispatch,
  dispatchEmotionSignalJob,
}));

import { POST } from "./route";

const config = { secret: "test-emotion-dispatch-secret-with-at-least-32-chars" };
const jobId = "10000000-0000-4000-8000-000000000001";

function request(
  body = JSON.stringify({ jobId }),
  headers: Record<string, string> = {},
) {
  return new NextRequest("http://localhost:3002/api/internal/emotion-signal", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

describe("POST /api/internal/emotion-signal", () => {
  beforeEach(() => {
    readEmotionSignalDispatchConfig.mockReset();
    verifyEmotionSignalDispatch.mockReset();
    dispatchEmotionSignalJob.mockReset();
    readEmotionSignalDispatchConfig.mockReturnValue(config);
  });

  it("hides the endpoint before its server-only switch and secret are configured", async () => {
    readEmotionSignalDispatchConfig.mockReturnValue(null);
    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(verifyEmotionSignalDispatch).not.toHaveBeenCalled();
    expect(dispatchEmotionSignalJob).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("rejects unsupported, oversized, or unsigned input before dispatching", async () => {
    const unsupported = await POST(request("{}", { "Content-Type": "text/plain" }));
    expect(unsupported.status).toBe(415);

    const oversized = await POST(request("{}", { "Content-Length": "1025" }));
    expect(oversized.status).toBe(413);

    verifyEmotionSignalDispatch.mockReturnValue(null);
    const unsigned = await POST(request());
    expect(unsigned.status).toBe(401);
    expect(dispatchEmotionSignalJob).not.toHaveBeenCalled();
  });

  it("returns no task or runtime detail after a verified single-job dispatch", async () => {
    verifyEmotionSignalDispatch.mockReturnValue(jobId);
    dispatchEmotionSignalJob.mockResolvedValue("completed");

    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(dispatchEmotionSignalJob).toHaveBeenCalledWith(jobId);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("returns a generic retryable status when the Worker is not configured", async () => {
    verifyEmotionSignalDispatch.mockReturnValue(jobId);
    dispatchEmotionSignalJob.mockResolvedValue("unavailable");

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
