import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getAdminBadcaseDetail } from "@/modules/admin/badcase-review-data";
import { BadcaseReviewDetail } from "@/modules/admin/badcase-review-detail";

export const metadata: Metadata = { title: "Badcase 详情" };

export default async function AdminBadcaseDetailPage({
  params,
}: {
  params: Promise<{ badcaseId: string }>;
}) {
  const { badcaseId } = await params;
  const user = await requireAuthenticatedUser(`/admin/badcases/${badcaseId}`);
  const data = await getAdminBadcaseDetail(user, badcaseId);

  return <BadcaseReviewDetail data={data} />;
}
