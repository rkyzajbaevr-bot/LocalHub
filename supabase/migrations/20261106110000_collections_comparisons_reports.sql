begin;

-- Organization facts that are useful for comparison. Empty values remain unknown.
alter table public.organizations
  add column description text,
  add column price_summary text,
  add column services jsonb not null default '[]'::jsonb;

alter table public.organizations
  add constraint organizations_services_array
    check (jsonb_typeof(services) = 'array');

create table public.business_collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_collections_owner_created_idx
  on public.business_collections (owner_id, created_at desc);

create table public.business_collection_items (
  collection_id uuid not null references public.business_collections (id) on delete cascade,
  organization_id text not null references public.organizations (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, organization_id)
);

create index business_collection_items_organization_idx
  on public.business_collection_items (organization_id);

create trigger business_collections_set_updated_at
before update on public.business_collections
for each row execute function public.set_updated_at();

alter table public.business_collections enable row level security;
alter table public.business_collection_items enable row level security;

revoke all on public.business_collections, public.business_collection_items from anon, authenticated;
-- Public collection metadata must not expose the account UUID stored in owner_id.
grant select (id, name, description, is_public, created_at, updated_at)
  on public.business_collections to anon, authenticated;
grant select (collection_id, organization_id, added_at)
  on public.business_collection_items to anon, authenticated;
grant insert, update, delete on public.business_collections to authenticated;
grant insert, delete on public.business_collection_items to authenticated;

-- Expose only whether the current authenticated caller owns this collection.
-- The function never returns owner_id and treats all non-owned IDs alike.
create function public.is_business_collection_owner(p_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.business_collections as c
    where c.id = p_collection_id
      and c.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.is_business_collection_owner(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.is_business_collection_owner(uuid) to authenticated;

create policy business_collections_read_visible
  on public.business_collections for select to anon, authenticated
  using (is_public or owner_id = (select auth.uid()));
create policy business_collections_insert_owner
  on public.business_collections for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy business_collections_update_owner
  on public.business_collections for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy business_collections_delete_owner
  on public.business_collections for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy business_collection_items_read_public
  on public.business_collection_items for select to anon, authenticated
  using (exists (
    select 1 from public.business_collections c
    where c.id = collection_id
      and c.is_public
  ));
create policy business_collection_items_read_owner
  on public.business_collection_items for select to authenticated
  using (public.is_business_collection_owner(collection_id));
create policy business_collection_items_insert_owner
  on public.business_collection_items for insert to authenticated
  with check (public.is_business_collection_owner(collection_id));
create policy business_collection_items_delete_owner
  on public.business_collection_items for delete to authenticated
  using (public.is_business_collection_owner(collection_id));

create type public.organization_report_status as enum ('new', 'reviewing', 'resolved', 'rejected');
revoke all on type public.organization_report_status from public, anon, authenticated, service_role;
grant usage on type public.organization_report_status to authenticated;

create table public.organization_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  issue_type text not null check (issue_type in (
    'wrong_address', 'wrong_phone', 'closed', 'wrong_hours',
    'duplicate', 'wrong_category', 'other'
  )),
  description text not null default '' check (char_length(description) <= 2000),
  status public.organization_report_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organization_reports_status_created_idx
  on public.organization_reports (status, created_at desc);
create index organization_reports_org_created_idx
  on public.organization_reports (organization_id, created_at desc);

create table public.organization_report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.organization_reports (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index organization_report_events_report_created_idx
  on public.organization_report_events (report_id, created_at desc);

create trigger organization_reports_set_updated_at
before update on public.organization_reports
for each row execute function public.set_updated_at();

alter table public.organization_reports enable row level security;
alter table public.organization_report_events enable row level security;
revoke all on public.organization_reports, public.organization_report_events from anon, authenticated;
grant select on public.organization_reports, public.organization_report_events to authenticated;

create policy organization_reports_admin_read
  on public.organization_reports for select to authenticated
  using (public.is_admin());
create policy organization_report_events_admin_read
  on public.organization_report_events for select to authenticated
  using (public.is_admin());

-- The server authenticates the reporter and supplies their ID. This RPC both
-- rate-limits and inserts the report atomically; clients cannot execute it.
create or replace function public.submit_organization_report(
  p_reporter_id uuid,
  p_organization_id text,
  p_issue_type text,
  p_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_id uuid;
  recent_count integer;
begin
  if p_reporter_id is null
    or p_organization_id is null
    or p_issue_type not in ('wrong_address', 'wrong_phone', 'closed', 'wrong_hours', 'duplicate', 'wrong_category', 'other')
    or char_length(coalesce(p_description, '')) > 2000 then
    raise exception 'invalid report' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_reporter_id::text, 971));
  select count(*) into recent_count
  from public.organization_reports r
  where r.reporter_id = p_reporter_id
    and r.created_at >= now() - interval '1 hour';
  if recent_count >= 5 then
    raise exception 'report rate limit exceeded' using errcode = 'P0001';
  end if;

  insert into public.organization_reports (reporter_id, organization_id, issue_type, description)
  values (p_reporter_id, p_organization_id, p_issue_type, trim(coalesce(p_description, '')))
  returning id into report_id;

  insert into public.organization_report_events (report_id, actor_id, action, details)
  values (report_id, p_reporter_id, 'created', jsonb_build_object('issue_type', p_issue_type));
  return report_id;
end;
$$;

revoke all on function public.submit_organization_report(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_organization_report(uuid, text, text, text) to service_role;

create or replace function public.review_organization_report(
  p_report_id uuid,
  p_status public.organization_report_status,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_status public.organization_report_status;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('reviewing', 'resolved', 'rejected')
    or char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'invalid report status' using errcode = '22023';
  end if;

  select r.status into old_status
  from public.organization_reports r
  where r.id = p_report_id
  for update;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;

  update public.organization_reports
  set status = p_status
  where id = p_report_id;

  insert into public.organization_report_events (report_id, actor_id, action, details)
  values (p_report_id, auth.uid(), 'status_changed',
    jsonb_build_object('from', old_status, 'to', p_status, 'note', trim(coalesce(p_note, ''))));
end;
$$;

revoke all on function public.review_organization_report(uuid, public.organization_report_status, text) from public, anon, service_role;
grant execute on function public.review_organization_report(uuid, public.organization_report_status, text) to authenticated;

-- Keep service_role limited to the report submission RPC; the definer-owned
-- function performs writes without granting the API key direct table access.
revoke all on public.business_collections, public.business_collection_items,
  public.organization_reports, public.organization_report_events from service_role;

commit;
