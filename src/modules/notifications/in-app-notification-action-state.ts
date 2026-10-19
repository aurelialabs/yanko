export interface InAppNotificationActionState {
  message: string;
  succeeded?: boolean;
}

export const initialInAppNotificationActionState: InAppNotificationActionState = {
  message: "",
  succeeded: false,
};
