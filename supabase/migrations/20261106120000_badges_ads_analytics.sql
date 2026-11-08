begin;

create type public.organization_badge_type as enum ('verified', 'popular', 'new', 'top', 'open_24_7', 'offer');
revoke all on type public.organization_badge_type from public, anon, authenticated, service_role;
grant usage on type public.organization_badge_type to anon, authenticated;
create table public.organization_badges (
  organization_id text not null references public.organizations(id) on delete cascade,
  badge_type public.organization_badge_type not null,
  source text not null check (char_length(trim(source)) between 2 and 300),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, badge_type),
  check (expires_at is null or expires_at > starts_at)
);
create index organization_badges_active_idx on public.organization_badges (badge_type, expires_at);
alter table public.organization_badges enable row level security;
revoke all on public.organization_badges from anon, authenticated, service_role;
grant select (organization_id, badge_type, source, starts_at, expires_at, created_at)
  on public.organization_badges to anon, authenticated;
grant insert, update, delete on public.organization_badges to authenticated;
create policy organization_badges_read_active on public.organization_badges for select to anon, authenticated
  using (starts_at <= now() and (expires_at is null or expires_at > now()));
create policy organization_badges_admin_manage on public.organization_badges for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  organization_id text references public.organizations(id) on delete set null,
  placement text not null check (placement in ('home_banner', 'search', 'category', 'business')),
  image_url text not null check (image_url ~ '^https://'),
  destination_url text not null check (destination_url ~ '^https://'),
  city text,
  category_id text references public.categories(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index ad_campaigns_public_active_idx on public.ad_campaigns (placement, starts_at, ends_at) where status = 'active';
alter table public.ad_campaigns enable row level security;
revoke all on public.ad_campaigns from anon, authenticated, service_role;
grant select, delete on public.ad_campaigns to authenticated;
grant insert (name, organization_id, placement, image_url, destination_url, city, category_id, starts_at, ends_at, status, created_by)
  on public.ad_campaigns to authenticated;
grant update (name, organization_id, placement, image_url, destination_url, city, category_id, starts_at, ends_at, status)
  on public.ad_campaigns to authenticated;
grant select (id, name, organization_id, placement, image_url, destination_url, city, category_id, starts_at, ends_at, status, created_at)
  on public.ad_campaigns to anon;
create policy ad_campaigns_read_active on public.ad_campaigns for select to anon, authenticated
  using (status = 'active' and starts_at <= now() and ends_at > now());
create policy ad_campaigns_admin_manage on public.ad_campaigns for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create trigger ad_campaigns_set_updated_at before update on public.ad_campaigns
  for each row execute function public.set_updated_at();

create table public.business_owners (
  organization_id text not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
alter table public.business_owners enable row level security;
revoke all on public.business_owners from anon, authenticated, service_role;
grant select, insert, delete on public.business_owners to authenticated;
create policy business_owners_read_self_or_admin on public.business_owners for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy business_owners_admin_manage on public.business_owners for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table public.business_analytics_events (
  id bigint generated always as identity primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  action text not null check (action in ('view', 'website', 'whatsapp', 'phone', 'route')),
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  bucket_start timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, action, session_hash, bucket_start)
);
create index business_analytics_events_org_created_idx on public.business_analytics_events (organization_id, created_at desc);
alter table public.business_analytics_events enable row level security;
revoke all on public.business_analytics_events from anon, authenticated, service_role;

-- Persist ad-event deduplication across serverless instances. The requester
-- value is an HMAC generated by the server; raw network addresses are not stored.
create table public.ad_campaign_event_dedup (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  event_type text not null check (event_type in ('impression', 'click')),
  requester_hash text not null check (requester_hash ~ '^[0-9a-f]{64}$'),
  bucket_start timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, event_type, requester_hash, bucket_start)
);
alter table public.ad_campaign_event_dedup enable row level security;
revoke all on public.ad_campaign_event_dedup from public, anon, authenticated, service_role;
create index ad_campaign_event_dedup_bucket_idx on public.ad_campaign_event_dedup (bucket_start);

create or replace function public.record_business_analytics_event(p_organization_id text, p_action text, p_session_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  if p_action not in ('view', 'website', 'whatsapp', 'phone', 'route')
    or p_session_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid analytics event' using errcode = '22023'; end if;
  insert into public.business_analytics_events(organization_id, action, session_hash, bucket_start)
  select p_organization_id, p_action, p_session_hash,
    date_trunc('hour', now()) + (floor(extract(minute from now()) / 30) * interval '30 minutes')
  where exists (select 1 from public.organizations o where o.id = p_organization_id)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
end;
$$;
revoke all on function public.record_business_analytics_event(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.record_business_analytics_event(text, text, text) to service_role;

create or replace function public.record_ad_campaign_event(p_campaign_id uuid, p_event text, p_requester_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed_count integer; campaign_is_active boolean; event_bucket timestamptz;
begin
  if p_campaign_id is null or p_event is null or p_event not in ('impression', 'click')
    or p_requester_hash is null or p_requester_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid ad event' using errcode = '22023';
  end if;
  event_bucket := date_trunc('hour', now());
  delete from public.ad_campaign_event_dedup
    where bucket_start < event_bucket - interval '1 hour';
  select true into campaign_is_active from public.ad_campaigns
    where id = p_campaign_id and status = 'active' and starts_at <= now() and ends_at > now()
    for update;
  if not coalesce(campaign_is_active, false) then return false; end if;
  insert into public.ad_campaign_event_dedup(campaign_id, event_type, requester_hash, bucket_start)
    values (p_campaign_id, p_event, p_requester_hash, event_bucket)
    on conflict do nothing;
  get diagnostics changed_count = row_count;
  if changed_count = 0 then return false; end if;
  update public.ad_campaigns
    set impressions = impressions + case when p_event = 'impression' then 1 else 0 end,
        clicks = clicks + case when p_event = 'click' then 1 else 0 end
    where id = p_campaign_id and status = 'active' and starts_at <= now() and ends_at > now();
  get diagnostics changed_count = row_count;
  return changed_count > 0;
end;
$$;
revoke all on function public.record_ad_campaign_event(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.record_ad_campaign_event(uuid, text, text) to service_role;

create or replace function public.validate_organization_badge()
returns trigger language plpgsql security definer set search_path = '' as $$
declare org_created timestamptz; recent_views bigint;
begin
  select published_at into org_created from public.organizations where id = new.organization_id;
  if not found then raise exception 'organization not found' using errcode = '23503'; end if;
  if new.badge_type = 'new' and (org_created < now() - interval '30 days' or new.expires_at is null or new.expires_at > now() + interval '30 days') then
    raise exception 'new badge requires an organization created within 30 days and an expiry within 30 days' using errcode = '22023';
  end if;
  if new.badge_type = 'popular' then
    select count(*) into recent_views from public.business_analytics_events
      where organization_id = new.organization_id and action = 'view' and created_at >= now() - interval '30 days';
    if recent_views < 100 or new.expires_at is null or new.expires_at > now() + interval '30 days' then
      raise exception 'popular badge requires at least 100 deduplicated views in 30 days and an expiry within 30 days' using errcode = '22023';
    end if;
  end if;
  if new.badge_type = 'offer' and (new.expires_at is null or new.expires_at > now() + interval '90 days') then
    raise exception 'offer badge requires an expiry within 90 days' using errcode = '22023';
  end if;
  if new.badge_type = 'open_24_7' and (new.expires_at is null or new.expires_at > now() + interval '90 days') then
    raise exception '24/7 badge requires an expiry within 90 days' using errcode = '22023';
  end if;
  if new.badge_type = 'top' and (char_length(trim(new.source)) < 30 or new.expires_at is null or new.expires_at > now() + interval '365 days') then
    raise exception 'top badge requires an editorial rationale and expiry within one year' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_organization_badge() from public, anon, authenticated, service_role;
create trigger organization_badges_validate before insert or update on public.organization_badges
  for each row execute function public.validate_organization_badge();

create or replace function public.business_analytics_summary(p_organization_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_admin() and not exists (
    select 1 from public.business_owners bo where bo.organization_id = p_organization_id and bo.user_id = auth.uid()
  ) then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'today', (select count(*) from public.business_analytics_events e where e.organization_id = p_organization_id and e.created_at >= date_trunc('day', now())),
    'days_7', (select count(*) from public.business_analytics_events e where e.organization_id = p_organization_id and e.created_at >= now() - interval '7 days'),
    'days_30', (select count(*) from public.business_analytics_events e where e.organization_id = p_organization_id and e.created_at >= now() - interval '30 days'),
    'all_time', (select count(*) from public.business_analytics_events e where e.organization_id = p_organization_id),
    'actions', coalesce((select jsonb_object_agg(a.action, a.total) from (
      select e.action, count(*) as total from public.business_analytics_events e
      where e.organization_id = p_organization_id group by e.action
    ) a), '{}'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('day', d.day::date, 'count', coalesce(a.total, 0)) order by d.day)
      from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d(day)
      left join (select date_trunc('day', created_at) as day, count(*) as total from public.business_analytics_events
        where organization_id = p_organization_id and created_at >= now() - interval '30 days' group by 1) a on a.day = d.day
    ), '[]'::jsonb)
  ) into result;
  return coalesce(result, '{}'::jsonb);
end;
$$;
revoke all on function public.business_analytics_summary(text) from public, anon, authenticated, service_role;
grant execute on function public.business_analytics_summary(text) to authenticated;

-- Database-level audit trail for admin-managed badges and campaigns.
create or replace function public.audit_growth_admin_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_id text; row_name text; action_name text;
begin
  if tg_op = 'UPDATE' and
    (old.name, old.organization_id, old.placement, old.image_url, old.destination_url, old.city, old.category_id, old.starts_at, old.ends_at, old.status, old.created_by)
    is not distinct from
    (new.name, new.organization_id, new.placement, new.image_url, new.destination_url, new.city, new.category_id, new.starts_at, new.ends_at, new.status, new.created_by) then
    return new;
  end if;
  if tg_op = 'DELETE' then row_id := old.id::text; row_name := old.name; action_name := 'deleted';
  elsif tg_op = 'INSERT' then row_id := new.id::text; row_name := new.name; action_name := 'created';
  else row_id := new.id::text; row_name := new.name; action_name := 'updated'; end if;
  insert into public.moderation_events(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), action_name, tg_table_name, row_id, jsonb_build_object('name', row_name));
  if tg_op = 'DELETE' then return old; end if; return new;
end;
$$;
revoke all on function public.audit_growth_admin_mutation() from public, anon, authenticated, service_role;
create trigger ad_campaigns_audit_mutation after insert or update or delete on public.ad_campaigns
  for each row execute function public.audit_growth_admin_mutation();

create or replace function public.audit_badge_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_id text; action_name text;
begin
  if tg_op = 'DELETE' then row_id := old.organization_id || ':' || old.badge_type::text; action_name := 'deleted';
  elsif tg_op = 'INSERT' then row_id := new.organization_id || ':' || new.badge_type::text; action_name := 'created';
  else row_id := new.organization_id || ':' || new.badge_type::text; action_name := 'updated'; end if;
  insert into public.moderation_events(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), action_name, 'organization_badge', row_id,
    jsonb_build_object('source', case when tg_op = 'DELETE' then old.source else new.source end));
  if tg_op = 'DELETE' then return old; end if; return new;
end;
$$;
revoke all on function public.audit_badge_mutation() from public, anon, authenticated, service_role;
create trigger organization_badges_audit_mutation after insert or update or delete on public.organization_badges
  for each row execute function public.audit_badge_mutation();

create or replace function public.audit_business_owner_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare org_id text; account_id uuid; action_name text;
begin
  if tg_op = 'DELETE' then org_id := old.organization_id; account_id := old.user_id; action_name := 'business_owner_revoked';
  else org_id := new.organization_id; account_id := new.user_id; action_name := 'business_owner_confirmed'; end if;
  insert into public.moderation_events(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), action_name, 'business_owner', org_id, jsonb_build_object('user_id', account_id));
  if tg_op = 'DELETE' then return old; end if; return new;
end;
$$;
revoke all on function public.audit_business_owner_mutation() from public, anon, authenticated, service_role;
create trigger business_owners_audit_mutation after insert or update or delete on public.business_owners
  for each row execute function public.audit_business_owner_mutation();

commit;
