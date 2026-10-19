export type MagicLinkActionStatus =
  "idle" | "sent" | "validation_error" | "configuration_error" | "request_failed";

export interface MagicLinkActionState {
  status: MagicLinkActionStatus;
  message: string;
  retryAfterSeconds: number;
}

export const initialMagicLinkActionState: MagicLinkActionState = {
  status: "idle",
  message: "",
  retryAfterSeconds: 0,
};
