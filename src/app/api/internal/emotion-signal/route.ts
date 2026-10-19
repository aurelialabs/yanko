import { NextRequest } from "next/server";

import {
  dispatchEmotionSignalJob,
  readEmotionSignalDispatchConfig,
  verifyEmotionSignalDispatch,
} from "@/modules/ai/emotion-signal-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_024;
const privateHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function response(status: number): Response {
  return new Response(null, { status, headers: privateHeaders });
}

function declaredLengthIsTooLarge(value: string | null): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return !Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_BODY_BYTES;
}

/**
 * A future scheduler can submit exactly one signed task reference. This route
 * intentionally does not accept user/session cookies, text, model settings,
 * or arbitrary task parameters, and it returns no operational detail.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const config = readEmotionSignalDispatchConfig();
  if (!config) return response(404);

  if (
    !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")
  ) {
    return response(415);
  }
  if (declaredLengthIsTooLarge(request.headers.get("content-length"))) {
    return response(413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return response(400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return response(413);
  }

  const jobId = verifyEmotionSignalDispatch({
    config,
    rawBody,
    signature: request.headers.get("x-yanko-dispatch-signature"),
    timestampMs: request.headers.get("x-yanko-dispatch-timestamp"),
  });
  if (!jobId) return response(401);

  const result = await dispatchEmotionSignalJob(jobId);
  return response(result === "completed" ? 204 : 503);
}
