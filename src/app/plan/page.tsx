import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getPlanWorkspace } from "@/modules/plan/plan-data";
import { PlanWorkspace } from "@/modules/plan/plan-workspace";
import type { PlanScope } from "@/modules/plan/plan-presentation";
import { getRoleWorkspace } from "@/modules/roles/role-data";

export const metadata: Metadata = { title: "计划" };

function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string | string[]; date?: string | string[] }>;
}) {
  const query = searchParams ? await searchParams : {};
  const rawScope = Array.isArray(query.scope) ? query.scope[0] : query.scope;
  const rawDate = Array.isArray(query.date) ? query.date[0] : query.date;
  const initialScope: PlanScope =
    rawScope === "week" || rawScope === "month" || rawScope === "year"
      ? rawScope
      : "day";
  const initialDate = isIsoDate(rawDate) ? rawDate : undefined;
  const user = await requireAuthenticatedUser("/plan");
  const [workspace, roleWorkspace] = await Promise.all([
    getPlanWorkspace(user),
    getRoleWorkspace(user),
  ]);

  return (
    <PlanWorkspace
      roles={roleWorkspace.roles}
      viewer={roleWorkspace.viewer}
      initialDate={initialDate}
      initialScope={initialScope}
      workspace={workspace}
    />
  );
}
