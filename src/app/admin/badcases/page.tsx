import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  getAdminBadcaseList,
  parseBadcaseListFilter,
} from "@/modules/admin/badcase-review-data";
import { BadcaseReviewList } from "@/modules/admin/badcase-review-list";

export const metadata: Metadata = { title: "Badcase 复核" };

export default async function AdminBadcaseListPage({
  searchParams,
}: {
  searchParams?: Promise<{
    status?: string | string[];
    severity?: string | string[];
    source?: string | string[];
  }>;
}) {
  const query = searchParams ? await searchParams : {};
  const filter = parseBadcaseListFilter(query);
  const user = await requireAuthenticatedUser("/admin/badcases");
  const data = await getAdminBadcaseList(user, filter);

  return <BadcaseReviewList data={data} filter={filter} />;
}
