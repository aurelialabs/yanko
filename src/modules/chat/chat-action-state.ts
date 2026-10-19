export interface ChatActionState {
  message: string;
  clientMessageId?: string;
  sentMessageId?: string;
}

export const initialChatActionState: ChatActionState = { message: "" };

export interface PersonaFeedbackActionState {
  message: string;
  idempotencyKey?: string;
  submitted?: boolean;
}

export const initialPersonaFeedbackActionState: PersonaFeedbackActionState = {
  message: "",
};
