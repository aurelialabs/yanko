import type { FeedbackStatus } from "@/types/domain";

export interface BadcaseReviewActionState {
  message: string;
  succeeded?: boolean;
  status?: FeedbackStatus;
  reviewRevision?: number;
}

export const initialBadcaseReviewActionState: BadcaseReviewActionState = {
  message: "",
  succeeded: false,
};
