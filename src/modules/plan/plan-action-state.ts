export interface PlanActionState {
  message: string;
  createdPlanId?: string;
  rejectedProposalId?: string;
  deletedPlanId?: string;
  updatedPlanId?: string;
}

export const initialPlanActionState: PlanActionState = { message: "" };
