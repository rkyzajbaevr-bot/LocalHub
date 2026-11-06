-- LocalHub platform schema. This migration does not import or persist 2GIS records.
create extension if not exists pgcrypto;

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'user');
$$;

create or replace function public.is_moderator_or_admin()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('moderator', 'admin');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.current_app_role() = 'admin';
$$;

create table public.categories (
  id text primary key,
  name text not null unique,
  description text not null default '',
  icon text not null default '⌖',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_id_format check (id ~ '^[a-z0-9-]{2,60}$')
);

insert into public.categories (id, name, description, icon) values
  ('restaurant', 'Рестораны и кафе', 'Места для еды и встреч.', '☕'),
  ('dentistry', 'Стоматологии', 'Стоматологические клиники и кабинеты.', '✦'),
  ('medicine', 'Медицина', 'Медицинские организации и услуги.', '⚕'),
  ('education', 'Образование', 'Учебные организации и образовательные услуги.', '⌑'),
  ('english', 'Курсы английского', 'Школы и курсы английского языка.', 'A'),
  ('beauty', 'Красота и здоровье', 'Организации красоты и wellness.', '✧'),
  ('barbershop', 'Барбершопы', 'Барбершопы и мужские парикмахерские.', '✂'),
  ('gym', 'Спортзалы', 'Фитнес-залы и спортивные пространства.', '↗'),
  ('auto', 'Автосервисы', 'Сервис, ремонт и обслуживание автомобилей.', '⚙'),
  ('hotel', 'Гостиницы', 'Гостиницы и места размещения.', '⌂'),
  ('shops', 'Магазины', 'Розничные магазины и торговые точки.', '◇'),
  ('entertainment', 'Развлечения', 'Развлекательные места и активности.', '☆')
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (username is null or char_length(username) between 2 and 40),
  constraint profiles_avatar_url_scheme check (avatar_url is null or avatar_url ~* '^https://')
);

create table public.organizations (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  category_id text not null references public.categories (id) on update cascade,
  city text not null,
  region text,
  address text not null,
  lat double precision,
  lon double precision,
  phone text,
  website text,
  photo text,
  hours text,
  rating numeric(3,2),
  rating_source text,
  source text not null,
  source_ref text unique,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_latitude check (lat is null or lat between -90 and 90),
  constraint organizations_longitude check (lon is null or lon between -180 and 180),
  constraint organizations_coordinates_pair check ((lat is null) = (lon is null)),
  constraint organizations_rating_source check (rating is null or rating_source is not null),
  constraint organizations_website_scheme check (website is null or website ~* '^https://'),
  constraint organizations_photo_scheme check (photo is null or photo ~* '^https://')
);

create index organizations_city_category_idx on public.organizations (city, category_id);
create index organizations_region_idx on public.organizations (region);
create index organizations_name_lower_idx on public.organizations (lower(name));

create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id text not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create index favorites_organization_idx on public.favorites (organization_id);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Сохранённый поиск',
  search_params jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_searches_name_length check (char_length(name) between 1 and 100),
  constraint saved_searches_params_object check (jsonb_typeof(search_params) = 'object')
);

create index saved_searches_user_created_idx on public.saved_searches (user_id, created_at desc);

create table public.search_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  search_params jsonb not null,
  organization_id text references public.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint search_history_params_object check (jsonb_typeof(search_params) = 'object')
);

create index search_history_user_created_idx on public.search_history (user_id, created_at desc);

create type public.submission_status as enum ('pending', 'approved', 'rejected');

create table public.organization_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  organization_name text not null,
  category_id text not null references public.categories (id),
  city text not null,
  region text,
  address text not null,
  phone text,
  website text,
  photo text,
  lat double precision,
  lon double precision,
  source text not null,
  additional_info text,
  status public.submission_status not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submissions_name_length check (char_length(organization_name) between 2 and 160),
  constraint submissions_website_scheme check (website is null or website ~* '^https://'),
  constraint submissions_photo_scheme check (photo is null or photo ~* '^https://'),
  constraint submissions_latitude check (lat is null or lat between -90 and 90),
  constraint submissions_longitude check (lon is null or lon between -180 and 180),
  constraint submissions_coordinates_pair check ((lat is null) = (lon is null))
);

create index submissions_status_created_idx on public.organization_submissions (status, created_at desc);
create index submissions_user_created_idx on public.organization_submissions (user_id, created_at desc);

create table public.moderation_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index moderation_events_created_idx on public.moderation_events (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
create trigger saved_searches_set_updated_at before update on public.saved_searches
for each row execute function public.set_updated_at();
create trigger submissions_set_updated_at before update on public.organization_submissions
for each row execute function public.set_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create or replace function public.review_organization_submission(
  p_submission_id uuid,
  p_decision public.submission_status,
  p_rejection_reason text default null
)
returns public.organization_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.organization_submissions;
begin
  if auth.uid() is null or not public.is_moderator_or_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and nullif(trim(p_rejection_reason), '') is null then
    raise exception 'rejection reason is required' using errcode = '22023';
  end if;

  select * into submission
  from public.organization_submissions
  where id = p_submission_id and status = 'pending'
  for update;
  if not found then
    raise exception 'pending submission not found' using errcode = 'P0002';
  end if;

  update public.organization_submissions
  set status = p_decision,
      rejection_reason = case when p_decision = 'rejected' then left(trim(p_rejection_reason), 1000) else null end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_submission_id
  returning * into submission;

  if p_decision = 'approved' then
    insert into public.organizations (
      id, name, category_id, city, region, address, phone, website, photo, lat, lon, source, source_ref
    ) values (
      'submission:' || submission.id::text,
      submission.organization_name,
      submission.category_id,
      submission.city,
      submission.region,
      submission.address,
      submission.phone,
      submission.website,
      submission.photo,
      submission.lat,
      submission.lon,
      submission.source,
      'submission:' || submission.id::text
    );
  end if;

  insert into public.moderation_events (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_decision::text, 'organization_submission', submission.id::text,
    jsonb_build_object('rejection_reason', submission.rejection_reason));
  return submission;
end;
$$;

create or replace function public.admin_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'registered_users', (select count(*) from auth.users),
    'pending_submissions', (select count(*) from public.organization_submissions where status = 'pending'),
    'approved_submissions', (select count(*) from public.organization_submissions where status = 'approved'),
    'organizations', (select count(*) from public.organizations),
    'recent_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (select action, entity_type, entity_id, created_at from public.moderation_events order by created_at desc limit 20) e), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

alter table public.categories enable row level security;
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.favorites enable row level security;
alter table public.saved_searches enable row level security;
alter table public.search_history enable row level security;
alter table public.organization_submissions enable row level security;
alter table public.moderation_events enable row level security;

revoke all on public.categories, public.profiles, public.organizations, public.favorites,
  public.saved_searches, public.search_history, public.organization_submissions,
  public.moderation_events from anon, authenticated;

grant select on public.categories, public.organizations to anon, authenticated;
grant select, update (username, avatar_url) on public.profiles to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select, insert, update, delete on public.saved_searches to authenticated;
grant select, insert, delete on public.search_history to authenticated;
grant select on public.organization_submissions to authenticated;
grant select, insert, update, delete on public.categories, public.organizations to authenticated;
grant select on public.moderation_events to authenticated;

create policy categories_read_active on public.categories for select to anon, authenticated using (is_active or public.is_admin());
create policy categories_admin_manage on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy profiles_read_self on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy organizations_read_published on public.organizations for select to anon, authenticated using (true);
create policy organizations_admin_manage on public.organizations for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy favorites_read_self on public.favorites for select to authenticated using (user_id = (select auth.uid()));
create policy favorites_insert_self on public.favorites for insert to authenticated with check (user_id = (select auth.uid()));
create policy favorites_delete_self on public.favorites for delete to authenticated using (user_id = (select auth.uid()));

create policy saved_searches_self on public.saved_searches for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy search_history_read_self on public.search_history for select to authenticated using (user_id = (select auth.uid()));
create policy search_history_insert_self on public.search_history for insert to authenticated with check (user_id = (select auth.uid()));
create policy search_history_delete_self on public.search_history for delete to authenticated using (user_id = (select auth.uid()));

create policy submissions_read_own on public.organization_submissions for select to authenticated using (user_id = (select auth.uid()));
create policy submissions_read_staff on public.organization_submissions for select to authenticated using (public.is_moderator_or_admin());
create policy moderation_events_staff_read on public.moderation_events for select to authenticated using (public.is_moderator_or_admin());

revoke all on function public.review_organization_submission(uuid, public.submission_status, text) from public, anon;
grant execute on function public.review_organization_submission(uuid, public.submission_status, text) to authenticated;
revoke all on function public.admin_dashboard_metrics() from public, anon;
grant execute on function public.admin_dashboard_metrics() to authenticated;
