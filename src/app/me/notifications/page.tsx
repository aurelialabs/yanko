import type { Metadata } from "next";

import { requireAuthenticatedUser } from "@/lib/auth/session";
import { deliverDueInAppPlanReminders } from "@/modules/notifications/deliver-due-in-app-reminders";
import { getInAppNotificationData } from "@/modules/notifications/in-app-notification-data";
import { InAppNotificationWorkspace } from "@/modules/notifications/in-app-notification-workspace";

export const metadata: Metadata = { title: "应用内提醒" };

export default async function InAppNotificationsPage() {
  const user = await requireAuthenticatedUser("/me/notifications");
  if (user) await deliverDueInAppPlanReminders({ userId: user.id });
  const data = await getInAppNotificationData(user);

  return <InAppNotificationWorkspace data={data} />;
}
