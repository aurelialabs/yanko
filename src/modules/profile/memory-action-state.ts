export interface MemoryActionState {
  message: string;
  memoryId?: string;
  succeeded?: boolean;
}

export const initialMemoryActionState: MemoryActionState = {
  message: "",
  succeeded: false,
};
