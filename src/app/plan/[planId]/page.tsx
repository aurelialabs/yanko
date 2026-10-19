import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getPlanDetail } from "@/modules/plan/plan-data";
import { PlanDetail } from "@/modules/plan/plan-detail";
import type { PlanScope } from "@/modules/plan/plan-presentation";
import { getRoleWorkspace } from "@/modules/roles/role-data";

export const metadata: Metadata = { title: "计划详情" };

function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default async function PlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams?: Promise<{ scope?: string | string[]; date?: string | string[] }>;
}) {
  const { planId } = await params;
  const query = searchParams ? await searchParams : {};
  const rawScope = Array.isArray(query.scope) ? query.scope[0] : query.scope;
  const rawDate = Array.isArray(query.date) ? query.date[0] : query.date;
  const returnScope: PlanScope | undefined =
    rawScope === "day" ||
    rawScope === "week" ||
    rawScope === "month" ||
    rawScope === "year"
      ? rawScope
      : undefined;
  const returnDate = isIsoDate(rawDate) ? rawDate : undefined;
  const user = await requireAuthenticatedUser("/plan");
  const [detail, roleWorkspace] = await Promise.all([
    getPlanDetail(user, planId),
    getRoleWorkspace(user),
  ]);

  return (
      <PlanDetail
        detail={detail}
        requestedPlanId={planId}
        roles={roleWorkspace.roles}
      returnDate={returnDate}
      returnScope={returnScope}
      viewer={roleWorkspace.viewer}
    />
  );
}
