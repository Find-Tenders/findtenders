-- FindTenders — initial schema
-- Run this once against a fresh Supabase project (SQL Editor, or `supabase db push`).

create extension if not exists pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================
create type plan_key as enum ('free', 'basic', 'professional', 'comprehensive');
create type user_role as enum ('user', 'admin');
create type subscription_status as enum ('pending', 'active', 'rejected');
create type payment_method as enum ('stripe', 'wallet');
create type source_state as enum ('active', 'error', 'paused', 'off');
create type tender_priority as enum ('high', 'medium', 'normal');

-- ============================================================
-- PLAN LIMITS (single source of truth, read by the app + RPCs)
-- ============================================================
create table plan_limits (
  plan            plan_key primary key,
  monthly_price   numeric not null,
  searches_per_month int not null,
  max_sectors     int not null,
  max_sites       int not null,
  updates_label   text not null
);

insert into plan_limits (plan, monthly_price, searches_per_month, max_sectors, max_sites, updates_label) values
  ('free',          0,  3,  1,  6,  'عند الطلب فقط'),
  ('basic',        20,  7,  6, 10,  '2–3 تحديثات شهريًا'),
  ('professional', 50, 10, 12, 15,  'تحديثات متكررة بالبريد'),
  ('comprehensive',99, 20, 20, 20,  'تحديث أسبوعي كامل');

-- ============================================================
-- SECTORS (lookup list, editable later without a code change)
-- ============================================================
create table sectors (
  slug   text primary key,
  label_ar text not null,
  sort_order int not null default 0
);

insert into sectors (slug, label_ar, sort_order) values
  ('energy',        'الطاقة',            1),
  ('water',         'المياه',             2),
  ('health',        'صحة',                3),
  ('construction',  'إنشاءات',            4),
  ('food_logistics','غذاء ولوجستيات',     5),
  ('telecom',       'اتصالات',            6),
  ('education',     'تعليم',              7),
  ('transport',     'نقل',                8),
  ('agriculture',   'زراعة',              9),
  ('housing',       'إسكان',              10),
  ('renewable',     'طاقة متجددة',        11),
  ('environment',   'بيئة',               12);

-- ============================================================
-- PROFILES — one row per Supabase Auth user (customer or admin)
-- ============================================================
create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text not null default '',
  role              user_role not null default 'user',
  plan              plan_key not null default 'free',
  account_status    text not null default 'active' check (account_status in ('active','suspended')),
  selected_sectors  text[] not null default '{}',
  searches_used     int not null default 0,
  search_period_start date not null default date_trunc('month', now())::date,
  notify_email      boolean not null default false,
  plan_renews_at    date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Auto-create a profile row whenever a new Supabase Auth user is created.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper used inside RLS policies — SECURITY DEFINER so it can read profiles
-- without recursing into the RLS policy that calls it.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ============================================================
-- SOURCES — one row per scraped site (admin-only, operational data)
-- ============================================================
create table sources (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null,        -- e.g. 'أممي' / 'محلي'
  frequency_label text not null,       -- human label shown in admin UI
  cron_schedule text,                  -- for reference: matches the GitHub Actions cron
  enabled       boolean not null default true,
  state         source_state not null default 'off',
  last_check_at timestamptz,
  last_result   text,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- TENDERS — normalized records, from scrapers (service role) or manual admin entry
-- ============================================================
create table tenders (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  org            text,
  sector         text references sectors(slug),
  location_label text,
  published_date date,
  deadline       date,
  source_url     text,
  excerpt        text,
  priority       tender_priority not null default 'normal',
  source_id      uuid references sources(id),   -- null = manual entry
  fingerprint    text not null unique,           -- hash of url + title + org + deadline, for dedupe
  created_by     uuid references profiles(id),   -- set for manual entries
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index tenders_sector_idx on tenders (sector);
create index tenders_deadline_idx on tenders (deadline);

-- ============================================================
-- SAVED TENDERS (bookmarks)
-- ============================================================
create table saved_tenders (
  user_id    uuid references profiles(id) on delete cascade,
  tender_id  uuid references tenders(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tender_id)
);

-- ============================================================
-- SUBSCRIPTION REQUESTS — upgrade requests awaiting admin review
-- ============================================================
create table subscription_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  requested_plan  plan_key not null,
  payment_method  payment_method not null,
  wallet_name     text,
  receipt_path    text,          -- Supabase Storage object path, not a public URL
  amount          numeric not null,
  status          subscription_status not null default 'pending',
  activated_plan  plan_key,      -- package the admin actually picked when activating
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- ADMIN OTP CODES — second factor for admin login (email-delivered code)
-- No client access at all; only the Edge Function (service role) touches this.
-- ============================================================
create table admin_otp_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null,
  expires_at  timestamptz not null,
  consumed    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- SEARCH QUOTA — enforced server-side via RPC, not trusted to client JS
-- ============================================================
create or replace function consume_search()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p profiles;
  lim plan_limits;
  current_month date := date_trunc('month', now())::date;
begin
  select * into p from profiles where id = auth.uid() for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  if p.search_period_start <> current_month then
    update profiles set searches_used = 0, search_period_start = current_month
      where id = p.id returning * into p;
  end if;

  select * into lim from plan_limits where plan = p.plan;

  if p.searches_used >= lim.searches_per_month then
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded',
      'used', p.searches_used, 'limit', lim.searches_per_month);
  end if;

  update profiles set searches_used = p.searches_used + 1
    where id = p.id returning searches_used into p.searches_used;

  return jsonb_build_object('ok', true, 'used', p.searches_used, 'limit', lim.searches_per_month);
end;
$$;

-- ============================================================
-- ADMIN ACTIONS — atomic RPCs so a subscription decision updates the
-- request record and the user's plan together, never just one of them.
-- ============================================================
create or replace function admin_activate_subscription(request_id uuid, chosen_plan plan_key)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  req subscription_requests;
  lim plan_limits;
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select * into req from subscription_requests where id = request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into lim from plan_limits where plan = chosen_plan;

  update subscription_requests
    set status = 'active', activated_plan = chosen_plan,
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = request_id;

  update profiles
    set plan = chosen_plan,
        searches_used = 0,
        search_period_start = date_trunc('month', now())::date,
        plan_renews_at = (current_date + interval '1 month')::date,
        selected_sectors = case
          when array_length(selected_sectors, 1) > lim.max_sectors
            then selected_sectors[1:lim.max_sectors]
          else selected_sectors
        end
    where id = req.user_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function admin_reject_subscription(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  update subscription_requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where id = request_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- User-initiated downgrade back to the free plan (mirrors the mockup's "cancel subscription").
create or replace function cancel_my_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
    set plan = 'free', plan_renews_at = null,
        searches_used = 0, search_period_start = date_trunc('month', now())::date,
        selected_sectors = case
          when array_length(selected_sectors, 1) > 1 then selected_sectors[1:1]
          else selected_sectors
        end
    where id = auth.uid();

  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table sectors enable row level security;
alter table plan_limits enable row level security;
alter table sources enable row level security;
alter table tenders enable row level security;
alter table saved_tenders enable row level security;
alter table subscription_requests enable row level security;
alter table admin_otp_codes enable row level security;

-- sectors / plan_limits: public reference data, readable by any signed-in user
create policy "sectors readable by authenticated" on sectors
  for select to authenticated using (true);
create policy "plan_limits readable by authenticated" on plan_limits
  for select to authenticated using (true);

-- profiles: a user sees/edits their own row; admins see/edit all.
-- Note: plan, role, searches_used, account_status are NOT in the user's
-- allowed update set at the app layer — only admin actions or the
-- consume_search()/activation RPCs (SECURITY DEFINER) may change them.
create policy "profiles select own" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "profiles update own" on profiles
  for update using (id = auth.uid() or is_admin());

-- sources: admin-only
create policy "sources admin all" on sources
  for all using (is_admin()) with check (is_admin());

-- tenders: any authenticated user can read; only admins can write manually.
-- Scrapers write using the service role key, which bypasses RLS entirely.
create policy "tenders readable by authenticated" on tenders
  for select to authenticated using (true);
create policy "tenders admin write" on tenders
  for insert to authenticated with check (is_admin());
create policy "tenders admin update" on tenders
  for update to authenticated using (is_admin());
create policy "tenders admin delete" on tenders
  for delete to authenticated using (is_admin());

-- saved_tenders: user manages their own bookmarks only
create policy "saved_tenders own" on saved_tenders
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- subscription_requests: user can create/read their own; admin can read/update all
create policy "subscription_requests insert own" on subscription_requests
  for insert to authenticated with check (user_id = auth.uid());
create policy "subscription_requests select own or admin" on subscription_requests
  for select to authenticated using (user_id = auth.uid() or is_admin());
create policy "subscription_requests admin update" on subscription_requests
  for update to authenticated using (is_admin());

-- admin_otp_codes: no policies at all -> default-deny for every client role.
-- Only the service-role key (used inside the Edge Function) can touch this table.

-- ============================================================
-- FUNCTION GRANTS — Supabase revokes PUBLIC execute by default,
-- so signed-in users need explicit permission to call these.
-- ============================================================
grant execute on function is_admin() to authenticated;
grant execute on function consume_search() to authenticated;
grant execute on function admin_activate_subscription(uuid, plan_key) to authenticated;
grant execute on function admin_reject_subscription(uuid) to authenticated;
grant execute on function cancel_my_subscription() to authenticated;
