-- Keep weekly plan ranges aligned with the plan workspace's Monday-Sunday view.

begin;

alter table public.plans
  add constraint plans_week_period_start_monday check (
    scope <> 'week' or extract(isodow from period_start) = 1
  );

commit;
