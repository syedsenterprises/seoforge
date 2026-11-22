-- Baseline matching the original v2 database, for new projects only.
begin;
create table if not exists public.profiles (
  id uuid not null,
  email text,
  plan text default 'free'::text,
  created_at timestamp with time zone default now(),
  weekly_summary boolean default false,
  primary key (id),
  foreign key (id) references auth.users(id) on delete cascade
);
alter table public.profiles enable row level security;
grant select,insert,update,delete on public.profiles to authenticated;
create policy "own profile" on public.profiles for all to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
create table if not exists public.audits (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  url text,
  score integer,
  lcp numeric,
  cls numeric,
  created_at timestamp with time zone default now(),
  primary key (id),
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.audits enable row level security;
grant select,insert,update,delete on public.audits to authenticated;
create policy "own rows" on public.audits for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.keywords (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  keyword text,
  url text,
  created_at timestamp with time zone default now(),
  difficulty integer,
  primary key (id),
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.keywords enable row level security;
grant select,insert,update,delete on public.keywords to authenticated;
create policy "own rows" on public.keywords for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.rank_checks (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  keyword_id uuid,
  position integer,
  checked_at timestamp with time zone default now(),
  primary key (id),
  foreign key (keyword_id) references public.keywords(id) on delete cascade,
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.rank_checks enable row level security;
grant select,insert,update,delete on public.rank_checks to authenticated;
create policy "own rows" on public.rank_checks for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.verified_links (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  page_url text,
  target_domain text,
  anchor text,
  rel text,
  found boolean,
  checked_at timestamp with time zone default now(),
  primary key (id),
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.verified_links enable row level security;
grant select,insert,update,delete on public.verified_links to authenticated;
create policy "own rows" on public.verified_links for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.revenue_entries (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  entry_date date,
  network text,
  amount numeric,
  created_at timestamp with time zone default now(),
  primary key (id),
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.revenue_entries enable row level security;
grant select,insert,update,delete on public.revenue_entries to authenticated;
create policy "own rows" on public.revenue_entries for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.listings (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  site_url text,
  niche text,
  price numeric,
  da integer,
  dr integer,
  listing_type text,
  created_at timestamp with time zone default now(),
  primary key (id),
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.listings enable row level security;
grant select,insert,update,delete on public.listings to authenticated;
create policy "own listings" on public.listings for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.orders (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  listing_id uuid,
  status text default 'pending'::text,
  created_at timestamp with time zone default now(),
  primary key (id),
  foreign key (listing_id) references public.listings(id) on delete cascade,
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.orders enable row level security;
grant select,insert,update,delete on public.orders to authenticated;
create policy "own rows" on public.orders for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.content_briefs (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  keyword text,
  brief jsonb,
  created_at timestamp with time zone default now(),
  primary key (id),
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.content_briefs enable row level security;
grant select,insert,update,delete on public.content_briefs to authenticated;
create policy "own rows" on public.content_briefs for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.competitors (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  url text,
  created_at timestamp with time zone default now(),
  primary key (id),
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.competitors enable row level security;
grant select,insert,update,delete on public.competitors to authenticated;
create policy "own rows" on public.competitors for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.site_checks (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  check_type text,
  url text,
  result jsonb,
  created_at timestamp with time zone default now(),
  primary key (id),
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.site_checks enable row level security;
grant select,insert,update,delete on public.site_checks to authenticated;
create policy "own rows" on public.site_checks for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.google_tokens (
  user_id uuid not null,
  provider text not null,
  access_token text,
  refresh_token text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  primary key (user_id,provider),
  foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.google_tokens enable row level security;
commit;
