-- Feedback must pass through submit_persona_feedback so category, target,
-- visibility, completion state, and idempotency checks cannot be bypassed.

drop policy if exists persona_feedback_insert_own on public.persona_feedback;
revoke insert on table public.persona_feedback from authenticated;
