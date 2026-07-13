-- 0012_trip_workspace_rls.sql
-- Generated from packages/db/src/rls.ts buildWorkspaceRlsStatements()
-- Enables RLS + policies for workspace, trip, and expense child tables.
-- App still enforces tripProcedure; this is defense-in-depth when app.user_id is set.

alter table "workspace" enable row level security;

alter table "workspace" force row level security;

drop policy if exists "workspace_workspace_select" on "workspace";

drop policy if exists "workspace_workspace_insert" on "workspace";

drop policy if exists "workspace_workspace_update" on "workspace";

drop policy if exists "workspace_workspace_delete" on "workspace";

create policy "workspace_workspace_select" on "workspace"
for select
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace"."id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "workspace_workspace_insert" on "workspace"
for insert
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace"."id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_workspace_update" on "workspace"
for update
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace"."id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace"."id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_workspace_delete" on "workspace"
for delete
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace"."id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

drop policy if exists "workspace_bootstrap_insert" on "workspace";

drop policy if exists "workspace_public_bootstrap_select" on "workspace";

create policy "workspace_bootstrap_insert" on "workspace"
for insert
with check (
  not exists (select 1 from "workspace")
  and current_setting('app.workspace_id', true) = ''
  and "workspace"."owner_user_id" = current_setting('app.user_id', true)
);

create policy "workspace_public_bootstrap_select" on "workspace"
for select
using (
  coalesce(current_setting('app.user_id', true), '') = ''
  and not exists (
    select 1
    from "application_settings" bootstrap_settings
    where bootstrap_settings.setup_completed_at is not null
  )
);

alter table "workspace_membership" enable row level security;

alter table "workspace_membership" force row level security;

drop policy if exists "workspace_membership_workspace_select" on "workspace_membership";

drop policy if exists "workspace_membership_workspace_insert" on "workspace_membership";

drop policy if exists "workspace_membership_workspace_update" on "workspace_membership";

drop policy if exists "workspace_membership_workspace_delete" on "workspace_membership";

create policy "workspace_membership_workspace_select" on "workspace_membership"
for select
using ((exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_membership"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
))
  or (exists (
  select 1
  from "workspace_membership" current_membership
  where current_membership.workspace_id = "workspace_membership"."workspace_id"
    and current_membership.user_id = current_setting('app.user_id', true)
    and current_membership.role in ('owner', 'admin')
    and current_setting('app.workspace_id', true) <> ''
    and current_membership.workspace_id::text = current_setting('app.workspace_id', true)
)));

create policy "workspace_membership_workspace_insert" on "workspace_membership"
for insert
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_membership"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_membership_workspace_update" on "workspace_membership"
for update
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_membership"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_membership"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_membership_workspace_delete" on "workspace_membership"
for delete
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_membership"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

drop policy if exists "workspace_membership_bootstrap_insert" on "workspace_membership";

drop policy if exists "workspace_membership_invite_accept_insert" on "workspace_membership";

create policy "workspace_membership_bootstrap_insert" on "workspace_membership"
for insert
with check (
  current_setting('app.workspace_id', true) = ''
  and "workspace_membership"."user_id" = current_setting('app.user_id', true)
  and exists (
    select 1
    from "workspace" bootstrap_workspace
    where bootstrap_workspace.id = "workspace_membership"."workspace_id"
      and bootstrap_workspace.owner_user_id = current_setting('app.user_id', true)
  )
  and not exists (
    select 1
    from "workspace_membership" existing_membership
    where existing_membership.workspace_id = "workspace_membership"."workspace_id"
  )
);

create policy "workspace_membership_invite_accept_insert" on "workspace_membership"
for insert
with check (
  current_setting('app.workspace_id', true) = ''
  and "workspace_membership"."user_id" = current_setting('app.user_id', true)
  and exists (
    select 1
    from "workspace_invite_allowlist" invite
    where invite.workspace_id = "workspace_membership"."workspace_id"
      and invite.email = current_setting('app.user_email', true)
      and invite.role = "workspace_membership"."role"
  )
);

alter table "workspace_invite_allowlist" enable row level security;

alter table "workspace_invite_allowlist" force row level security;

drop policy if exists "workspace_invite_allowlist_workspace_select" on "workspace_invite_allowlist";

drop policy if exists "workspace_invite_allowlist_workspace_insert" on "workspace_invite_allowlist";

drop policy if exists "workspace_invite_allowlist_workspace_update" on "workspace_invite_allowlist";

drop policy if exists "workspace_invite_allowlist_workspace_delete" on "workspace_invite_allowlist";

create policy "workspace_invite_allowlist_workspace_select" on "workspace_invite_allowlist"
for select
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_invite_allowlist"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
)
  or "workspace_invite_allowlist"."email" = current_setting('app.user_email', true));

create policy "workspace_invite_allowlist_workspace_insert" on "workspace_invite_allowlist"
for insert
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_invite_allowlist"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_invite_allowlist_workspace_update" on "workspace_invite_allowlist"
for update
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_invite_allowlist"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_invite_allowlist"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_invite_allowlist_workspace_delete" on "workspace_invite_allowlist"
for delete
using ((exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_invite_allowlist"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
  or "workspace_invite_allowlist"."email" = current_setting('app.user_email', true));

alter table "workspace_subscription" enable row level security;

alter table "workspace_subscription" force row level security;

drop policy if exists "workspace_subscription_workspace_select" on "workspace_subscription";

drop policy if exists "workspace_subscription_workspace_insert" on "workspace_subscription";

drop policy if exists "workspace_subscription_workspace_update" on "workspace_subscription";

drop policy if exists "workspace_subscription_workspace_delete" on "workspace_subscription";

create policy "workspace_subscription_workspace_select" on "workspace_subscription"
for select
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_subscription"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "workspace_subscription_workspace_insert" on "workspace_subscription"
for insert
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_subscription"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_subscription_workspace_update" on "workspace_subscription"
for update
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_subscription"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_subscription"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_subscription_workspace_delete" on "workspace_subscription"
for delete
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_subscription"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "workspace_usage_rollup" enable row level security;

alter table "workspace_usage_rollup" force row level security;

drop policy if exists "workspace_usage_rollup_workspace_select" on "workspace_usage_rollup";

drop policy if exists "workspace_usage_rollup_workspace_insert" on "workspace_usage_rollup";

drop policy if exists "workspace_usage_rollup_workspace_update" on "workspace_usage_rollup";

drop policy if exists "workspace_usage_rollup_workspace_delete" on "workspace_usage_rollup";

create policy "workspace_usage_rollup_workspace_select" on "workspace_usage_rollup"
for select
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_usage_rollup"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "workspace_usage_rollup_workspace_insert" on "workspace_usage_rollup"
for insert
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_usage_rollup"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_usage_rollup_workspace_update" on "workspace_usage_rollup"
for update
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_usage_rollup"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_usage_rollup"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "workspace_usage_rollup_workspace_delete" on "workspace_usage_rollup"
for delete
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "workspace_usage_rollup"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "trip" enable row level security;

alter table "trip" force row level security;

drop policy if exists "trip_workspace_select" on "trip";

drop policy if exists "trip_workspace_insert" on "trip";

drop policy if exists "trip_workspace_update" on "trip";

drop policy if exists "trip_workspace_delete" on "trip";

create policy "trip_workspace_select" on "trip"
for select
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "trip"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "trip_workspace_insert" on "trip"
for insert
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "trip"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "trip_workspace_update" on "trip"
for update
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "trip"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "trip"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "trip_workspace_delete" on "trip"
for delete
using (exists (
  select 1
  from "workspace_membership" membership
  where membership.workspace_id = "trip"."workspace_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "trip_segment" enable row level security;

alter table "trip_segment" force row level security;

drop policy if exists "trip_segment_workspace_select" on "trip_segment";

drop policy if exists "trip_segment_workspace_insert" on "trip_segment";

drop policy if exists "trip_segment_workspace_update" on "trip_segment";

drop policy if exists "trip_segment_workspace_delete" on "trip_segment";

create policy "trip_segment_workspace_select" on "trip_segment"
for select
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_segment"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "trip_segment_workspace_insert" on "trip_segment"
for insert
with check (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_segment"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "trip_segment_workspace_update" on "trip_segment"
for update
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_segment"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_segment"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "trip_segment_workspace_delete" on "trip_segment"
for delete
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_segment"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "trip_member" enable row level security;

alter table "trip_member" force row level security;

drop policy if exists "trip_member_workspace_select" on "trip_member";

drop policy if exists "trip_member_workspace_insert" on "trip_member";

drop policy if exists "trip_member_workspace_update" on "trip_member";

drop policy if exists "trip_member_workspace_delete" on "trip_member";

create policy "trip_member_workspace_select" on "trip_member"
for select
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_member"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "trip_member_workspace_insert" on "trip_member"
for insert
with check (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_member"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "trip_member_workspace_update" on "trip_member"
for update
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_member"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_member"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "trip_member_workspace_delete" on "trip_member"
for delete
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_member"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "trip_invite" enable row level security;

alter table "trip_invite" force row level security;

drop policy if exists "trip_invite_workspace_select" on "trip_invite";

drop policy if exists "trip_invite_workspace_insert" on "trip_invite";

drop policy if exists "trip_invite_workspace_update" on "trip_invite";

drop policy if exists "trip_invite_workspace_delete" on "trip_invite";

create policy "trip_invite_workspace_select" on "trip_invite"
for select
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_invite"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "trip_invite_workspace_insert" on "trip_invite"
for insert
with check (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_invite"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "trip_invite_workspace_update" on "trip_invite"
for update
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_invite"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_invite"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "trip_invite_workspace_delete" on "trip_invite"
for delete
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "trip_invite"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "segment_member" enable row level security;

alter table "segment_member" force row level security;

drop policy if exists "segment_member_workspace_select" on "segment_member";

drop policy if exists "segment_member_workspace_insert" on "segment_member";

drop policy if exists "segment_member_workspace_update" on "segment_member";

drop policy if exists "segment_member_workspace_delete" on "segment_member";

create policy "segment_member_workspace_select" on "segment_member"
for select
using (exists (
  select 1
  from "trip_segment" segment
  join "trip" trip on trip.id = segment.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where segment.id = "segment_member"."segment_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "segment_member_workspace_insert" on "segment_member"
for insert
with check (exists (
  select 1
  from "trip_segment" segment
  join "trip" trip on trip.id = segment.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where segment.id = "segment_member"."segment_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "segment_member_workspace_update" on "segment_member"
for update
using (exists (
  select 1
  from "trip_segment" segment
  join "trip" trip on trip.id = segment.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where segment.id = "segment_member"."segment_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "trip_segment" segment
  join "trip" trip on trip.id = segment.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where segment.id = "segment_member"."segment_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "segment_member_workspace_delete" on "segment_member"
for delete
using (exists (
  select 1
  from "trip_segment" segment
  join "trip" trip on trip.id = segment.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where segment.id = "segment_member"."segment_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "expense" enable row level security;

alter table "expense" force row level security;

drop policy if exists "expense_workspace_select" on "expense";

drop policy if exists "expense_workspace_insert" on "expense";

drop policy if exists "expense_workspace_update" on "expense";

drop policy if exists "expense_workspace_delete" on "expense";

create policy "expense_workspace_select" on "expense"
for select
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "expense"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "expense_workspace_insert" on "expense"
for insert
with check (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "expense"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "expense_workspace_update" on "expense"
for update
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "expense"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "expense"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "expense_workspace_delete" on "expense"
for delete
using (exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "expense"."trip_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "receipt_image" enable row level security;

alter table "receipt_image" force row level security;

drop policy if exists "receipt_image_workspace_select" on "receipt_image";

drop policy if exists "receipt_image_workspace_insert" on "receipt_image";

drop policy if exists "receipt_image_workspace_update" on "receipt_image";

drop policy if exists "receipt_image_workspace_delete" on "receipt_image";

create policy "receipt_image_workspace_select" on "receipt_image"
for select
using (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "receipt_image"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "receipt_image_workspace_insert" on "receipt_image"
for insert
with check (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "receipt_image"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "receipt_image_workspace_update" on "receipt_image"
for update
using (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "receipt_image"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "receipt_image"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "receipt_image_workspace_delete" on "receipt_image"
for delete
using (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "receipt_image"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "line_item" enable row level security;

alter table "line_item" force row level security;

drop policy if exists "line_item_workspace_select" on "line_item";

drop policy if exists "line_item_workspace_insert" on "line_item";

drop policy if exists "line_item_workspace_update" on "line_item";

drop policy if exists "line_item_workspace_delete" on "line_item";

create policy "line_item_workspace_select" on "line_item"
for select
using (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "line_item"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "line_item_workspace_insert" on "line_item"
for insert
with check (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "line_item"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "line_item_workspace_update" on "line_item"
for update
using (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "line_item"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "line_item"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "line_item_workspace_delete" on "line_item"
for delete
using (exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "line_item"."expense_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "line_item_claim" enable row level security;

alter table "line_item_claim" force row level security;

drop policy if exists "line_item_claim_workspace_select" on "line_item_claim";

drop policy if exists "line_item_claim_workspace_insert" on "line_item_claim";

drop policy if exists "line_item_claim_workspace_update" on "line_item_claim";

drop policy if exists "line_item_claim_workspace_delete" on "line_item_claim";

create policy "line_item_claim_workspace_select" on "line_item_claim"
for select
using (exists (
  select 1
  from "line_item" li
  join "expense" expense on expense.id = li.expense_id
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where li.id = "line_item_claim"."line_item_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
));

create policy "line_item_claim_workspace_insert" on "line_item_claim"
for insert
with check (exists (
  select 1
  from "line_item" li
  join "expense" expense on expense.id = li.expense_id
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where li.id = "line_item_claim"."line_item_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "line_item_claim_workspace_update" on "line_item_claim"
for update
using (exists (
  select 1
  from "line_item" li
  join "expense" expense on expense.id = li.expense_id
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where li.id = "line_item_claim"."line_item_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
))
with check (exists (
  select 1
  from "line_item" li
  join "expense" expense on expense.id = li.expense_id
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where li.id = "line_item_claim"."line_item_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

create policy "line_item_claim_workspace_delete" on "line_item_claim"
for delete
using (exists (
  select 1
  from "line_item" li
  join "expense" expense on expense.id = li.expense_id
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where li.id = "line_item_claim"."line_item_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
));

alter table "application_settings" enable row level security;

alter table "application_settings" force row level security;

drop policy if exists "application_settings_public_read" on "application_settings";

drop policy if exists "application_settings_platform_admin_insert" on "application_settings";

drop policy if exists "application_settings_platform_admin_update" on "application_settings";

drop policy if exists "application_settings_platform_admin_delete" on "application_settings";

create policy "application_settings_public_read" on "application_settings"
for select
using (
  coalesce(current_setting('app.user_id', true), '') = ''
  or coalesce(current_setting('app.user_id', true), '') <> ''
);

create policy "application_settings_platform_admin_insert" on "application_settings"
for insert
with check (current_setting('app.platform_role', true) = 'admin');

create policy "application_settings_platform_admin_update" on "application_settings"
for update
using (current_setting('app.platform_role', true) = 'admin')
with check (current_setting('app.platform_role', true) = 'admin');

create policy "application_settings_platform_admin_delete" on "application_settings"
for delete
using (current_setting('app.platform_role', true) = 'admin');
