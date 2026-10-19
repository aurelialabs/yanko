export interface RoleSelectionState {
  message: string;
}

export const initialRoleSelectionState: RoleSelectionState = { message: "" };

export interface RoleMutationState {
  message: string;
  roleId?: string;
  personaVersionId?: string;
  conflict?: boolean;
}

export const initialRoleMutationState: RoleMutationState = { message: "" };
