-- 아이디·비밀번호 로그인으로 바꾸기 (2026-11-03)
-- 이미 schema.sql 로 테이블을 만든 Supabase 프로젝트에서 한 번 실행하세요.
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 내용을 전부 붙여넣고 Run
-- 여러 번 실행해도 괜찮아요. 처음 만드는 프로젝트라면 schema.sql 만 실행하면 돼요(같은 내용이 들어 있어요).
--
-- 바뀌는 것
--   1) profiles.username : 로그인 아이디. 중복 금지, 영문 소문자·숫자·_ 4~20자
--      예전 익명(닉네임) 사용자는 비어 있어요. 그 사람이 같은 휴대폰에서 회원가입하면 채워져요.
--   2) username_available(name) : 회원가입 화면의 아이디 중복 확인용 (쓸 수 있으면 true)

alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (username);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_username_format') then
    alter table public.profiles add constraint profiles_username_format check (username ~ '^[a-z0-9_]{4,20}$');
  end if;
end $$;

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
