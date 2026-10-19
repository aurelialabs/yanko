export type RoleTone = "periwinkle" | "mint" | "cream";

export interface RoleStats {
  chatCount: string;
  memoryCount: string;
  companionDays: string;
}

export interface RolePresentation {
  /** A null id identifies the non-persistent Figma preview fallback. */
  id: string | null;
  templateKey: string | null;
  name: string;
  label: string;
  description: string;
  direction: string;
  quote: string;
  initial: string;
  tone: RoleTone;
  stats: RoleStats;
}

export interface ViewerPresentation {
  displayName: string;
  initial: string;
  companionDays: string;
}

export interface RoleWorkspaceData {
  source: "demo" | "database" | "unavailable";
  roles: RolePresentation[];
  currentRole: RolePresentation;
  viewer: ViewerPresentation;
}

const demoRoles: RolePresentation[] = [
  {
    id: null,
    templateKey: "lin_zhixia",
    name: "林知夏",
    label: "温柔倾听者",
    description: "先接住你的感受，再一起理清方向。",
    direction: "情感和人际关系",
    quote: "我会先听懂你的感受，再陪你把事情一点点理清。",
    initial: "夏",
    tone: "periwinkle",
    stats: { chatCount: "18 次", memoryCount: "7 条", companionDays: "42 天" },
  },
  {
    id: null,
    templateKey: "zhou_yuan",
    name: "周予安",
    label: "清醒同行者",
    description: "坦诚、理性，帮你把复杂问题拆开。",
    direction: "决策与成长",
    quote: "我会和你一起分清事实、感受和下一步。",
    initial: "安",
    tone: "mint",
    stats: { chatCount: "12 次", memoryCount: "4 条", companionDays: "42 天" },
  },
  {
    id: null,
    templateKey: "nanzhi",
    name: "南枝",
    label: "元气伙伴",
    description: "轻快有行动力，陪你从小目标开始。",
    direction: "行动与习惯",
    quote: "我们从一个足够小、今天就能开始的动作出发。",
    initial: "枝",
    tone: "cream",
    stats: { chatCount: "9 次", memoryCount: "3 条", companionDays: "42 天" },
  },
];

/** The exact original role content remains available while Supabase is unconfigured. */
export const demoRoleWorkspace: RoleWorkspaceData = {
  source: "demo",
  roles: demoRoles,
  currentRole: demoRoles[0],
  viewer: { displayName: "小屿", initial: "屿", companionDays: "42 天" },
};
