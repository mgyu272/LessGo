-- 성북 런트립 Supabase 테이블
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 내용을 전부 붙여넣고 Run
-- 여러 번 실행해도 괜찮게 만들어 뒀어요.
--
-- 보안: 모든 테이블에 RLS(행 단위 보안)를 켜서 "내 데이터는 나만" 읽고 쓰게 해요.
-- 랭킹은 territory_leaderboard() 함수로만 다른 사람 닉네임·칸 수를 볼 수 있어요.

-- 1) 프로필 (아이디·닉네임)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  username text,             -- 로그인 아이디 (영문 소문자·숫자·_ 4~20자). 예전 익명 사용자는 비어 있을 수 있어요
  created_at timestamptz not null default now()
);

-- 1-1) 아이디: 중복 금지 + 형식 검사 (예전에 만든 DB에도 붙도록 따로 실행해요)
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (username);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_username_format') then
    alter table public.profiles add constraint profiles_username_format check (username ~ '^[a-z0-9_]{4,20}$');
  end if;
end $$;

-- 2) 달리기 기록
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id text,
  name jsonb,                -- {"en": "...", "ko": "..."}
  meters integer not null default 0,
  seconds integer not null default 0,
  cells integer not null default 0,   -- 이번에 새로 얻은 육각형 수
  stamps integer not null default 0,  -- 이번에 들른 스팟 수
  created_at timestamptz not null default now()
);
create index if not exists runs_user_idx on public.runs (user_id, created_at desc);

-- 3) 내 육각형 칸 (H3 해상도 10)
create table if not exists public.cells (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cell text not null,
  first_at timestamptz not null default now(),
  primary key (user_id, cell)
);

-- 4) 스팟 스탬프
create table if not exists public.stamps (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  spot_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, spot_id)
);

-- 5) 쿠폰
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  shop_id text,
  title jsonb,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

-- 6) 보너스 별 (구매 인증 등)
create table if not exists public.star_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount integer not null,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------- RLS: 내 것만 ----------
alter table public.profiles    enable row level security;
alter table public.runs        enable row level security;
alter table public.cells       enable row level security;
alter table public.stamps      enable row level security;
alter table public.coupons     enable row level security;
alter table public.star_events enable row level security;

drop policy if exists "own profile select" on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile select" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

do $$
declare tbl text;
begin
  foreach tbl in array array['runs', 'cells', 'stamps', 'coupons', 'star_events'] loop
    execute format('drop policy if exists "own select" on public.%I', tbl);
    execute format('drop policy if exists "own insert" on public.%I', tbl);
    execute format('drop policy if exists "own update" on public.%I', tbl);
    execute format('create policy "own select" on public.%I for select to authenticated using (user_id = auth.uid())', tbl);
    execute format('create policy "own insert" on public.%I for insert to authenticated with check (user_id = auth.uid())', tbl);
    execute format('create policy "own update" on public.%I for update to authenticated using (user_id = auth.uid())', tbl);
  end loop;
end $$;

-- ---------- 영역 랭킹 ----------
-- 닉네임과 칸 수만 돌려줘요 (다른 사람의 위치·기록은 안 보여요)
create or replace function public.territory_leaderboard(limit_n int default 20)
returns table (nickname text, cells bigint, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.nickname, count(c.cell) as cells, (p.id = auth.uid()) as is_me
  from public.profiles p
  left join public.cells c on c.user_id = p.id
  group by p.id, p.nickname
  order by cells desc, p.created_at asc
  limit least(limit_n, 100);
$$;

revoke all on function public.territory_leaderboard(int) from public;
grant execute on function public.territory_leaderboard(int) to authenticated;

-- ---------- 아이디 중복 확인 (회원가입 화면) ----------
-- 그 아이디를 쓸 수 있는지(true/false)만 알려줘요. 다른 사람의 프로필 내용은 안 보여요.
create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.profiles where username = lower(name));
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- 앱(로그인한 사용자)이 테이블을 쓸 수 있게 권한 부여 (RLS가 "내 것만"으로 다시 막아줘요)
grant select, insert, update on public.profiles, public.runs, public.cells, public.stamps, public.coupons, public.star_events to authenticated;
