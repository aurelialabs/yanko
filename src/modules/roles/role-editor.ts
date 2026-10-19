import type { PersonaSnapshot } from "@/types/domain";

export interface RoleEditorData {
  source: "database" | "unavailable";
  roleId: string | null;
  displayName: string;
  roleSource: "system_template" | "custom" | null;
  currentPersonaVersionId: string | null;
  versionNo: number | null;
  persona: PersonaSnapshot | null;
}

export interface PersonaChangePreview {
  ok: boolean;
  message: string;
  changedFields: string[];
}

export const emptyPersonaSnapshot: PersonaSnapshot = {
  identity: { name: "", role: "", background: "" },
  coreTraits: [],
  speakingStyle: [],
  supportStyle: "",
  reminderTone: "",
  boundaries: [],
  preferences: [],
  values: [],
  relationshipDefinition: "",
  proactiveLevel: "medium",
};
