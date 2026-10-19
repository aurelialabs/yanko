"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  createCustomRole,
  previewPersonaVersion,
  updatePersonaVersion,
} from "@/app/roles/actions";
import { useDemoSession } from "@/modules/demo/use-demo-session";
import {
  initialRoleMutationState,
  type RoleMutationState,
} from "@/modules/roles/role-action-state";
import { AppShell } from "@/modules/shell/app-shell";

import {
  emptyPersonaSnapshot,
  type PersonaChangePreview,
  type RoleEditorData,
} from "./role-editor";
import type { RoleWorkspaceData } from "./role-presentation";

function createIdempotencyKey() {
  return crypto.randomUUID();
}

function lines(values: readonly string[] | undefined) {
  return values?.join("\n") ?? "";
}

export function RolePersonaForm({
  editor,
  mode,
  workspace,
}: {
  editor?: RoleEditorData;
  mode: "create" | "edit";
  workspace: RoleWorkspaceData;
}) {
  const { update } = useDemoSession();
  const mutation = mode === "create" ? createCustomRole : updatePersonaVersion;
  const [state, action, pending] = useActionState<RoleMutationState, FormData>(
    mutation,
    initialRoleMutationState,
  );
  const [preview, setPreview] = useState<PersonaChangePreview | null>(null);
  const [previewPending, startPreviewTransition] = useTransition();
  const [idempotencyKey] = useState(createIdempotencyKey);
  const formRef = useRef<HTMLFormElement>(null);
  const persona = editor?.persona ?? emptyPersonaSnapshot;
  const canPersist =
    workspace.source === "database" &&
    (mode === "create" || editor?.source === "database");

  function prepareConfirmation() {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;

    if (mode === "create") {
      setPreview({
        ok: true,
        message: "确认后会创建角色、人设 v1 和一条独立持续时间线。",
        changedFields: ["身份与背景", "核心性格", "说话风格", "关系与边界"],
      });
      return;
    }

    const formData = new FormData(form);
    startPreviewTransition(async () => {
      const result = await previewPersonaVersion(formData);
      setPreview(result);
    });
  }

  if (mode === "edit" && editor?.source !== "database") {
    return (
      <AppShell current="roles" roles={workspace.roles} viewer={workspace.viewer}>
        <section className="role-editor-page">
          <header className="role-editor-header">
            <Link aria-label="返回角色管理" href="/roles">
              ‹
            </Link>
            <h1>编辑当前角色</h1>
          </header>
          <p className="role-editor-message" role="alert">
            只能编辑当前账号正在使用的角色，请返回角色页重新选择。
          </p>
        </section>
      </AppShell>
    );
  }

  return (
      <AppShell current="roles" roles={workspace.roles} viewer={workspace.viewer}>
      <section className="role-editor-page" aria-labelledby="role-editor-title">
        <header className="role-editor-header">
          <Link aria-label="返回角色管理" href="/roles">
            ‹
          </Link>
          <span>
            <h1 id="role-editor-title">
              {mode === "create" ? "创建自己的角色" : "编辑当前角色"}
            </h1>
            {mode === "edit" ? (
              <small>人设版本 v{editor?.versionNo ?? "—"}</small>
            ) : null}
          </span>
        </header>

        <form
          ref={formRef}
          action={canPersist ? action : undefined}
          className="role-editor-form"
          onChangeCapture={() => setPreview(null)}
          onSubmit={(event) => {
            if (canPersist || mode !== "create" || !preview?.ok) return;
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const name = String(formData.get("displayName") ?? "").trim();
            const label = String(formData.get("roleLabel") ?? "").trim();
            const background = String(formData.get("background") ?? "").trim();
            const relationship = String(formData.get("relationshipDefinition") ?? "").trim();
            const traits = String(formData.get("coreTraits") ?? "").trim();
            const speaking = String(formData.get("speakingStyle") ?? "").trim();
            if (!name || !label) return;
            const id = `custom-${crypto.randomUUID()}`;
            update((current) => ({
              ...current,
              activeRoleKey: id,
              customRoles: [
                ...current.customRoles,
                {
                  id,
                  name,
                  label,
                  description: background || relationship || label,
                  quote: relationship || `我会以${label}的方式陪着你。`,
                  guide: `你是${name}，身份是${label}。背景：${background}。与用户的关系：${relationship}。性格：${traits}。说话风格：${speaking}。保持这个身份，不要改成其他预设角色。`.slice(0, 800),
                },
              ],
            }));
            window.location.assign("/roles");
          }}
        >
          <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
          <input
            name="confirmed"
            type="hidden"
            value={preview?.ok ? "true" : "false"}
          />
          {mode === "edit" ? (
            <>
              <input name="roleId" type="hidden" value={editor?.roleId ?? ""} />
              <input
                name="expectedCurrentVersionId"
                type="hidden"
                value={editor?.currentPersonaVersionId ?? ""}
              />
            </>
          ) : null}

          <section className="role-editor-section">
            <div className="role-editor-section-heading">
              <span>1</span>
              <div>
                <h2>身份与关系</h2>
                <p>这些内容决定角色是谁，以及你们如何相处。</p>
              </div>
            </div>
            <div className="role-editor-grid">
              <label>
                角色名称
                <input
                  defaultValue={persona.identity.name}
                  maxLength={40}
                  name="displayName"
                  required
                />
              </label>
              <label>
                身份定位
                <input
                  defaultValue={persona.identity.role}
                  maxLength={60}
                  name="roleLabel"
                  placeholder="例如：温柔倾听者"
                  required
                />
              </label>
              <label className="role-editor-wide">
                身份与背景
                <textarea
                  defaultValue={persona.identity.background ?? ""}
                  maxLength={1000}
                  name="background"
                  placeholder="角色的背景、经历与看待世界的方式"
                  required={mode === "create"}
                />
              </label>
              <label className="role-editor-wide">
                与用户的关系
                <textarea
                  defaultValue={persona.relationshipDefinition ?? ""}
                  maxLength={1000}
                  name="relationshipDefinition"
                  placeholder="例如：尊重边界、愿意陪伴但不替我做决定的朋友"
                  required={mode === "create"}
                />
              </label>
            </div>
          </section>

          <section className="role-editor-section">
            <div className="role-editor-section-heading">
              <span>2</span>
              <div>
                <h2>性格与表达</h2>
                <p>每行填写一项，也可以用逗号分隔。</p>
              </div>
            </div>
            <div className="role-editor-grid">
              <label>
                核心性格
                <textarea
                  defaultValue={lines(persona.coreTraits)}
                  name="coreTraits"
                  placeholder={"温柔\n稳定\n尊重边界"}
                  required
                />
              </label>
              <label>
                说话风格
                <textarea
                  defaultValue={lines(persona.speakingStyle)}
                  name="speakingStyle"
                  placeholder={"自然\n简洁\n先倾听后建议"}
                  required
                />
              </label>
              <label className="role-editor-wide">
                情绪支持与建议方式（选填）
                <textarea
                  defaultValue={persona.supportStyle}
                  maxLength={1000}
                  name="supportStyle"
                />
              </label>
              <label className="role-editor-wide">
                提醒和督促语气（选填）
                <textarea
                  defaultValue={persona.reminderTone}
                  maxLength={500}
                  name="reminderTone"
                />
              </label>
            </div>
          </section>

          <section className="role-editor-section">
            <div className="role-editor-section-heading">
              <span>3</span>
              <div>
                <h2>边界与高级设置</h2>
                <p>可补充偏好与边界；未填写时会使用安全默认设置。</p>
              </div>
            </div>
            <div className="role-editor-grid">
              <label className="role-editor-wide">
                价值观与行为边界（选填）
                <textarea
                  defaultValue={lines(persona.boundaries)}
                  name="boundaries"
                  placeholder={"不编造用户经历\n不诱导排他依赖"}
                />
              </label>
              <label>
                喜好与厌恶（选填）
                <textarea
                  defaultValue={lines(persona.preferences)}
                  name="preferences"
                />
              </label>
              <label>
                价值观（选填）
                <textarea defaultValue={lines(persona.values)} name="values" />
              </label>
              <label>
                主动程度
                <select
                  defaultValue={persona.proactiveLevel ?? "medium"}
                  name="proactiveLevel"
                >
                  <option value="low">低 · 主要回应用户</option>
                  <option value="medium">中 · 适度主动</option>
                  <option value="high">高 · 更主动但不连续打扰</option>
                </select>
              </label>
            </div>
          </section>

          {preview ? (
            <section className="role-change-confirmation" aria-live="polite">
              <h2>{mode === "create" ? "确认创建" : "确认人设变更"}</h2>
              {preview.changedFields.length ? (
                <p>涉及：{preview.changedFields.join("、")}</p>
              ) : null}
              <p>{preview.message}</p>
              <p>历史聊天和记忆会继续保留，其他角色不会受到影响。</p>
            </section>
          ) : null}

          {state.message ? (
            <p
              className="role-editor-message"
              role={state.personaVersionId ? "status" : "alert"}
            >
              {state.message}
            </p>
          ) : null}
          {!canPersist && mode === "edit" ? (
            <p className="role-editor-message" role="alert">
              只能编辑已经登录账号里的角色。
            </p>
          ) : !canPersist ? (
            <p className="role-editor-message" role="status">
              确认后会保存在这台浏览器里，下次打开仍然在。
            </p>
          ) : null}

          <footer className="role-editor-footer">
            <Link href="/roles">取消</Link>
            {preview?.ok ? (
              <button disabled={pending || (mode === "edit" && !canPersist)} type="submit">
                {pending
                  ? "保存中…"
                  : mode === "create"
                    ? "确认创建"
                    : "确认并保存新版本"}
              </button>
            ) : (
              <button
                disabled={previewPending || pending}
                type="button"
                onClick={() => startTransition(prepareConfirmation)}
              >
                {previewPending ? "正在检查…" : "检查并继续"}
              </button>
            )}
          </footer>
        </form>
      </section>
    </AppShell>
  );
}
