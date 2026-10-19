import { getAuthContext } from "@/lib/auth/session";
import {
  AccountDataExportError,
  getAccountDataExport,
} from "@/modules/profile/account-data-export";

export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

/** Downloads a narrow, current-user-only account-data copy. */
export async function GET(): Promise<Response> {
  const auth = await getAuthContext();
  if (!auth.user) {
    return Response.json(
      { message: "请先登录后再导出数据。" },
      { status: 401, headers: privateHeaders },
    );
  }

  try {
    const data = await getAccountDataExport(auth.user);
    const filenameDate = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"yanko-data-${filenameDate}.json\"`,
      },
    });
  } catch (error) {
    // The module's public error is intentionally generic. Never turn a query,
    // prompt, provider, or storage error into a downloadable response body.
    if (error instanceof AccountDataExportError) {
      return Response.json(
        { message: "暂时无法导出数据，请稍后重试。" },
        { status: 503, headers: privateHeaders },
      );
    }
    return Response.json(
      { message: "暂时无法导出数据，请稍后重试。" },
      { status: 503, headers: privateHeaders },
    );
  }
}
