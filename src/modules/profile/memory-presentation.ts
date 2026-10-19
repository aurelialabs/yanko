export interface MemoryRoleOption {
  id: string;
  name: string;
}

export interface PendingMemoryCandidatePresentation {
  id: string;
  content: string;
  category: string;
  suggestedScope: "user_shared" | "role_private";
  roleId: string | null;
  roleName: string;
  sensitivity: "normal" | "sensitive";
  expiresAt: string;
}

export interface MemoryHistoryPresentation {
  id: string;
  content: string;
  status: "active" | "superseded";
  validFrom: string | null;
  validTo: string | null;
}

export interface ActiveMemoryPresentation {
  id: string;
  content: string;
  category: string;
  scope: "user_shared" | "role_private";
  roleId: string | null;
  roleName: string | null;
  sensitivity: "normal" | "sensitive";
  confirmedByUser: boolean;
  validFrom: string | null;
  history: MemoryHistoryPresentation[];
}

export interface MemoryManagementData {
  source: "database" | "demo" | "unavailable";
  roles: MemoryRoleOption[];
  memories: ActiveMemoryPresentation[];
}

const categoryLabels: Readonly<Record<string, string>> = {
  profile: "基本信息",
  basic_info: "基本信息",
  preference: "喜好与厌恶",
  agreement: "重要约定",
  habit: "行为习惯",
  long_term_goal: "长期目标",
  goal: "长期目标",
  emotion: "情绪与经历",
  experience: "情绪与经历",
  sensitive: "敏感信息",
};

export function memoryCategoryLabel(category: string): string {
  return categoryLabels[category] ?? "其他记忆";
}

export const demoMemoryManagementData: MemoryManagementData = {
  source: "demo",
  roles: [
    { id: "lin_zhixia", name: "林知夏" },
    { id: "zhou_yuan", name: "周予安" },
    { id: "nanzhi", name: "南枝" },
  ],
  memories: [
    {
      id: "demo-memory-portfolio",
      content: "正在准备作品集，希望九月前完成。",
      category: "long_term_goal",
      scope: "user_shared",
      roleId: null,
      roleName: null,
      sensitivity: "normal",
      confirmedByUser: true,
      validFrom: "2026-08-20T00:00:00.000Z",
      history: [],
    },
    {
      id: "demo-memory-listen",
      content: "难过时希望先被听完，再一起想办法。",
      category: "agreement",
      scope: "role_private",
      roleId: "lin_zhixia",
      roleName: "林知夏",
      sensitivity: "normal",
      confirmedByUser: true,
      validFrom: "2026-08-22T00:00:00.000Z",
      history: [],
    },
    {
      id: "demo-memory-decision",
      content: "做决定时希望先分清事实、感受和下一步。",
      category: "preference",
      scope: "role_private",
      roleId: "zhou_yuan",
      roleName: "周予安",
      sensitivity: "normal",
      confirmedByUser: true,
      validFrom: "2026-08-24T00:00:00.000Z",
      history: [],
    },
  ],
};
