-- The viewport API filters by coordinate bounds; keep those reads index-backed.
create index if not exists organizations_coordinates_idx
  on public.organizations (lat, lon)
  where lat is not null and lon is not null;

-- Site-wide page analytics. Only keyed hashes are stored; raw browser or network IDs never enter the table.
create table public.site_analytics_events (
  id bigint generated always as identity primary key,
  page_path text not null check (page_path ~ '^/[a-z0-9._/-]{1,100}$'),
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  bucket_start timestamptz not null,
  created_at timestamptz not null default now(),
  unique (session_hash, page_path, bucket_start)
);
create index site_analytics_events_created_idx on public.site_analytics_events (created_at desc);
alter table public.site_analytics_events enable row level security;
revoke all on public.site_analytics_events from public, anon, authenticated, service_role;

create or replace function public.record_site_page_view(p_page_path text, p_visitor_hash text, p_session_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  if p_page_path !~ '^/[a-z0-9._/-]{1,100}$' or p_visitor_hash !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid site analytics event' using errcode = '22023';
  end if;
  insert into public.site_analytics_events(page_path, visitor_hash, session_hash, bucket_start)
  values (p_page_path, p_visitor_hash, p_session_hash,
    date_trunc('hour', now()) + floor(extract(minute from now()) / 30) * interval '30 minutes')
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
end;
$$;
revoke all on function public.record_site_page_view(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.record_site_page_view(text, text, text) to service_role;

create or replace function public.site_analytics_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'today_views', count(*) filter (where created_at >= date_trunc('day', now())),
    'days_7_views', count(*) filter (where created_at >= now() - interval '7 days'),
    'days_30_views', count(*) filter (where created_at >= now() - interval '30 days'),
    'all_time_views', count(*),
    'today_visits', count(distinct session_hash) filter (where created_at >= date_trunc('day', now())),
    'days_7_visits', count(distinct session_hash) filter (where created_at >= now() - interval '7 days'),
    'days_30_visits', count(distinct session_hash) filter (where created_at >= now() - interval '30 days'),
    'today_visitors', count(distinct visitor_hash) filter (where created_at >= date_trunc('day', now())),
    'days_7_visitors', count(distinct visitor_hash) filter (where created_at >= now() - interval '7 days'),
    'days_30_visitors', count(distinct visitor_hash) filter (where created_at >= now() - interval '30 days'),
    'popular_pages', coalesce((select jsonb_agg(jsonb_build_object('page', p.page_path, 'views', p.views) order by p.views desc)
      from (select page_path, count(*) views from public.site_analytics_events where created_at >= now() - interval '30 days' group by page_path order by count(*) desc limit 10) p), '[]'::jsonb),
    'popular_organizations', coalesce((select jsonb_agg(jsonb_build_object('id', p.organization_id, 'name', o.name, 'views', p.views) order by p.views desc)
      from (select organization_id, count(*) views from public.business_analytics_events where action = 'view' and created_at >= now() - interval '30 days' group by organization_id order by count(*) desc limit 10) p
      join public.organizations o on o.id = p.organization_id), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('day', d.day::date, 'views', coalesce(a.views, 0), 'visitors', coalesce(a.visitors, 0)) order by d.day)
      from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d(day)
      left join (select date_trunc('day', created_at) AS day, count(*) views, count(distinct visitor_hash) visitors
        from public.site_analytics_events where created_at >= now() - interval '30 days' group by 1) a on a.day = d.day), '[]'::jsonb)
  ) into result from public.site_analytics_events;
  return coalesce(result, '{}'::jsonb);
end;
$$;
revoke all on function public.site_analytics_summary() from public, anon, authenticated, service_role;
grant execute on function public.site_analytics_summary() to authenticated;

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null check (notification_type in ('submission_approved','submission_rejected','system')),
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 1000),
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index user_notifications_user_created_idx on public.user_notifications(user_id, created_at desc);
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from public, anon, authenticated, service_role;
grant select, delete on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
create policy user_notifications_read_self on public.user_notifications for select to authenticated using (user_id = (select auth.uid()));
create policy user_notifications_update_self on public.user_notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy user_notifications_delete_self on public.user_notifications for delete to authenticated using (user_id = (select auth.uid()));

create table public.organization_verification_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  evidence_url text not null check (evidence_url ~ '^https://'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index organization_verification_one_pending_idx on public.organization_verification_requests(organization_id) where status = 'pending';
alter table public.organization_verification_requests enable row level security;
revoke all on public.organization_verification_requests from public, anon, authenticated, service_role;
grant select on public.organization_verification_requests to authenticated;
grant insert (organization_id, user_id, evidence_url) on public.organization_verification_requests to authenticated;
create policy organization_verification_read_owner_admin on public.organization_verification_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy organization_verification_insert_user on public.organization_verification_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and review_note is null and reviewed_by is null and reviewed_at is null and exists (
    select 1 from public.business_owners bo where bo.organization_id = organization_verification_requests.organization_id and bo.user_id = (select auth.uid())
  ));

create or replace function public.notify_submission_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending' and new.status in ('approved','rejected') then
    insert into public.user_notifications(user_id, notification_type, title, body)
    values (new.user_id, case when new.status = 'approved' then 'submission_approved' else 'submission_rejected' end,
      case when new.status = 'approved' then 'Организация одобрена' else 'Предложение отклонено' end,
      case when new.status = 'approved' then new.organization_name else coalesce(new.rejection_reason, 'Проверьте данные предложения и отправьте его повторно.') end);
  end if;
  return new;
end;
$$;
revoke all on function public.notify_submission_decision() from public, anon, authenticated, service_role;
create trigger organization_submission_notify_decision after update of status on public.organization_submissions
  for each row execute function public.notify_submission_decision();

create or replace function public.record_organization_view(p_organization_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'invalid organization history event' using errcode = '22023';
  end if;
  delete from public.search_history where user_id = auth.uid() and organization_id = p_organization_id;
  insert into public.search_history(user_id, search_params, organization_id)
    values (auth.uid(), '{"type":"view"}'::jsonb, p_organization_id);
end;
$$;
revoke all on function public.record_organization_view(text) from public, anon, authenticated, service_role;
grant execute on function public.record_organization_view(text) to authenticated;

create or replace function public.review_organization_verification(p_request_id uuid, p_decision text, p_note text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare request_row public.organization_verification_requests%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_decision not in ('approved','rejected') or p_note is not null and char_length(p_note) > 1000 then raise exception 'invalid review' using errcode = '22023'; end if;
  select * into request_row from public.organization_verification_requests where id = p_request_id and status = 'pending' for update;
  if not found then return false; end if;
  update public.organization_verification_requests set status = p_decision, review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
  if p_decision = 'approved' then
    insert into public.organization_badges(organization_id, badge_type, source, assigned_by)
      values (request_row.organization_id, 'verified', 'Заявка владельца одобрена администратором', auth.uid())
      on conflict (organization_id, badge_type) do update set source = excluded.source, starts_at = now(), expires_at = null, assigned_by = auth.uid();
  end if;
  insert into public.user_notifications(user_id, notification_type, title, body)
  values (request_row.user_id, 'system', case when p_decision = 'approved' then 'Организация подтверждена' else 'Заявка на подтверждение рассмотрена' end,
    coalesce(p_note, case when p_decision = 'approved' then 'Организация получила отметку проверки.' else 'Администратор отклонил заявку.' end));
  return true;
end;
$$;
revoke all on function public.review_organization_verification(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.review_organization_verification(uuid, text, text) to authenticated;

create or replace function public.public_map_city_counts(p_category text default null)
returns table(city text, organization_count bigint, center_lon double precision, center_lat double precision)
language sql stable security definer set search_path = '' as $$
  select o.city, count(*)::bigint, avg(o.lon), avg(o.lat)
  from public.organizations o
  where o.lat between 40 and 56 and o.lon between 45 and 88
    and (p_category is null or o.category_id = p_category)
  group by o.city
  order by o.city;
$$;
revoke all on function public.public_map_city_counts(text) from public, anon, authenticated, service_role;
grant execute on function public.public_map_city_counts(text) to service_role;

create table public.business_claim_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_name text not null check (char_length(trim(contact_name)) between 2 and 100),
  contact_phone text not null check (char_length(trim(contact_phone)) between 5 and 40),
  evidence_url text not null check (evidence_url ~ '^https://'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index business_claim_one_pending_idx on public.business_claim_requests(organization_id, user_id) where status = 'pending';
alter table public.business_claim_requests enable row level security;
revoke all on public.business_claim_requests from public, anon, authenticated, service_role;
grant select on public.business_claim_requests to authenticated;
grant insert (organization_id, user_id, contact_name, contact_phone, evidence_url) on public.business_claim_requests to authenticated;
create policy business_claim_read_owner_admin on public.business_claim_requests for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy business_claim_insert_self on public.business_claim_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and review_note is null and reviewed_by is null and reviewed_at is null);

create or replace function public.review_business_claim_request(p_request_id uuid, p_decision text, p_note text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare request_row public.business_claim_requests%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_decision not in ('approved','rejected') or p_note is not null and char_length(p_note) > 1000 then raise exception 'invalid review' using errcode = '22023'; end if;
  select * into request_row from public.business_claim_requests where id = p_request_id and status = 'pending' for update;
  if not found then return false; end if;
  update public.business_claim_requests set status = p_decision, review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
  if p_decision = 'approved' then
    insert into public.business_owners(organization_id, user_id, confirmed_by) values (request_row.organization_id, request_row.user_id, auth.uid())
      on conflict (organization_id, user_id) do nothing;
  end if;
  insert into public.user_notifications(user_id, notification_type, title, body)
  values (request_row.user_id, 'system', case when p_decision = 'approved' then 'Заявка на владение одобрена' else 'Заявка на владение отклонена' end,
    coalesce(p_note, case when p_decision = 'approved' then 'Вам предоставлен доступ к кабинету организации.' else 'Администратор рассмотрел вашу заявку.' end));
  return true;
end;
$$;
revoke all on function public.review_business_claim_request(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.review_business_claim_request(uuid, text, text) to authenticated;
