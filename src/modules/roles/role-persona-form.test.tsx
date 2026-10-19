import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleEditorData } from "./role-editor";
import type { RoleWorkspaceData } from "./role-presentation";

const createCustomRole = vi.hoisted(() => vi.fn());
const previewPersonaVersion = vi.hoisted(() => vi.fn());
const updatePersonaVersion = vi.hoisted(() => vi.fn());

vi.mock("@/app/roles/actions", () => ({
  createCustomRole,
  previewPersonaVersion,
  updatePersonaVersion,
}));

vi.mock("@/modules/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { RolePersonaForm } from "./role-persona-form";

const roleId = "11111111-1111-4111-8111-111111111111";
const personaVersionId = "22222222-2222-4222-8222-222222222222";
const roleWorkspace: RoleWorkspaceData = {
  source: "database",
  roles: [
    {
      id: roleId,
      templateKey: null,
      name: "知夏",
      label: "长期陪伴者",
      description: "自定义角色",
      direction: "专属陪伴",
      quote: "我会尊重你的决定。",
      initial: "知",
      tone: "periwinkle",
      stats: { chatCount: "0 条", memoryCount: "0 条", companionDays: "1 天" },
    },
  ],
  currentRole: {
    id: roleId,
    templateKey: null,
    name: "知夏",
    label: "长期陪伴者",
    description: "自定义角色",
    direction: "专属陪伴",
    quote: "我会尊重你的决定。",
    initial: "知",
    tone: "periwinkle",
    stats: { chatCount: "0 条", memoryCount: "0 条", companionDays: "1 天" },
  },
  viewer: { displayName: "小屿", initial: "屿", companionDays: "1 天" },
};

const editor: RoleEditorData = {
  source: "database",
  roleId,
  displayName: "知夏",
  roleSource: "custom",
  currentPersonaVersionId: personaVersionId,
  versionNo: 1,
  persona: {
    identity: {
      name: "知夏",
      role: "长期陪伴者",
      background: "理解创作压力。",
    },
    coreTraits: ["温柔", "稳定"],
    speakingStyle: ["自然", "简洁"],
    supportStyle: "先倾听，再询问是否需要建议。",
    reminderTone: "温和，不施压。",
    boundaries: ["不编造经历"],
    preferences: [],
    values: ["诚实"],
    relationshipDefinition: "可信任且有清晰边界的伙伴",
    proactiveLevel: "medium",
  },
};

function fillCreationFields() {
  fireEvent.change(screen.getByLabelText("角色名称"), {
    target: { value: "新知夏" },
  });
  fireEvent.change(screen.getByLabelText("身份定位"), {
    target: { value: "温柔伙伴" },
  });
  fireEvent.change(screen.getByLabelText("身份与背景"), {
    target: { value: "理解创作压力，也尊重自主决定。" },
  });
  fireEvent.change(screen.getByLabelText("与用户的关系"), {
    target: { value: "可信任且有边界的长期伙伴" },
  });
  fireEvent.change(screen.getByLabelText("核心性格"), {
    target: { value: "温柔\n稳定" },
  });
  fireEvent.change(screen.getByLabelText("说话风格"), {
    target: { value: "自然\n简洁" },
  });
}

describe("RolePersonaForm", () => {
  beforeEach(() => {
    createCustomRole.mockReset();
    previewPersonaVersion.mockReset();
    updatePersonaVersion.mockReset();
  });

  it("requires a visible confirmation before creating a role", async () => {
    createCustomRole.mockResolvedValue({ message: "" });
    render(<RolePersonaForm mode="create" workspace={roleWorkspace} />);
    fillCreationFields();

    fireEvent.click(screen.getByRole("button", { name: "检查并继续" }));
    expect(
      await screen.findByRole("heading", { name: "确认创建" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/角色、人设 v1 和一条独立持续时间线/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));
    await waitFor(() => expect(createCustomRole).toHaveBeenCalledTimes(1));
    const payload = createCustomRole.mock.calls[0][1] as FormData;
    expect(payload.get("confirmed")).toBe("true");
    expect(payload.get("displayName")).toBe("新知夏");
    expect(payload.get("idempotencyKey")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses the server preview and surfaces a concurrent edit conflict", async () => {
    previewPersonaVersion.mockResolvedValue({
      ok: true,
      message: "确认后，新设置将从下一条回复开始生效。",
      changedFields: ["角色名称"],
    });
    updatePersonaVersion.mockResolvedValue({
      message: "角色已被更新，请刷新后重新确认。",
      conflict: true,
    });
    render(<RolePersonaForm editor={editor} mode="edit" workspace={roleWorkspace} />);

    fireEvent.change(screen.getByLabelText("角色名称"), {
      target: { value: "知夏 v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查并继续" }));

    await waitFor(() => expect(previewPersonaVersion).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("涉及：角色名称")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认并保存新版本" }));

    expect(
      await screen.findByText("角色已被更新，请刷新后重新确认。"),
    ).toBeInTheDocument();
    const payload = updatePersonaVersion.mock.calls[0][1] as FormData;
    expect(payload.get("roleId")).toBe(roleId);
    expect(payload.get("expectedCurrentVersionId")).toBe(personaVersionId);
    expect(payload.get("confirmed")).toBe("true");
  });
});
