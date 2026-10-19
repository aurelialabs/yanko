"use client";

import { startTransition, useActionState, useState } from "react";

import { confirmMemoryCandidate, rejectMemoryCandidate } from "@/app/me/actions";
import { initialMemoryActionState } from "@/modules/profile/memory-action-state";

import {
  memoryCategoryLabel,
  type PendingMemoryCandidatePresentation,
} from "./memory-presentation";

export function MemoryCandidateCard({
  candidate,
}: {
  candidate: PendingMemoryCandidatePresentation;
}) {
  const [content, setContent] = useState(candidate.content);
  const [scope, setScope] = useState(candidate.suggestedScope);
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmMemoryCandidate,
    initialMemoryActionState,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectMemoryCandidate,
    initialMemoryActionState,
  );
  const decided = Boolean(confirmState.succeeded || rejectState.succeeded);

  if (decided) {
    return (
      <article className="memory-candidate-card" data-state="completed">
        <p className="memory-card-eyebrow">长期记忆</p>
        <strong>{confirmState.succeeded ? "已保存这条记忆" : "已选择不保存"}</strong>
        <p>{content}</p>
      </article>
    );
  }

  return (
    <article
      className="memory-candidate-card"
      aria-labelledby={`memory-${candidate.id}`}
    >
      <header>
        <span>
          <small>想记住这件事</small>
          <strong id={`memory-${candidate.id}`}>
            {memoryCategoryLabel(candidate.category)}
          </strong>
        </span>
        <span className="memory-scope-badge">
          {scope === "user_shared" ? "所有角色共享" : `仅${candidate.roleName}`}
        </span>
      </header>

      {candidate.sensitivity === "sensitive" ? (
        <p className="memory-sensitive-note">
          这可能涉及健康、关系、家庭或重要情绪经历。只有你确认后才会保存，并且仅供当前角色使用。
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(() => confirmAction(new FormData(event.currentTarget)));
        }}
      >
        <input name="candidateId" type="hidden" value={candidate.id} />
        <input
          name="idempotencyKey"
          type="hidden"
          value={`memory-confirm-${candidate.id}`}
        />
        <input name="editedScope" type="hidden" value={scope} />
        <input
          name="editedRoleId"
          type="hidden"
          value={scope === "role_private" ? (candidate.roleId ?? "") : ""}
        />
        <label>
          记忆内容
          <textarea
            maxLength={5000}
            name="editedContent"
            required
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
          />
        </label>
        <label>
          作用范围
          <select
            disabled={candidate.sensitivity === "sensitive"}
            value={scope}
            onChange={(event) => setScope(event.currentTarget.value as typeof scope)}
          >
            <option value="role_private">仅当前角色 · {candidate.roleName}</option>
            <option value="user_shared">所有角色共享</option>
          </select>
        </label>
        {confirmState.message ? (
          <p className="memory-action-error" role="alert">
            {confirmState.message}
          </p>
        ) : null}
        <footer>
          <button disabled={confirmPending || rejectPending} type="submit">
            {confirmPending ? "正在保存…" : "确认保存"}
          </button>
        </footer>
      </form>

      <form
        className="memory-reject-form"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(() => rejectAction(new FormData(event.currentTarget)));
        }}
      >
        <input name="candidateId" type="hidden" value={candidate.id} />
        <input
          name="idempotencyKey"
          type="hidden"
          value={`memory-reject-${candidate.id}`}
        />
        <button disabled={confirmPending || rejectPending} type="submit">
          {rejectPending ? "处理中…" : "不保存"}
        </button>
        {rejectState.message ? (
          <p className="memory-action-error" role="alert">
            {rejectState.message}
          </p>
        ) : null}
      </form>
    </article>
  );
}
