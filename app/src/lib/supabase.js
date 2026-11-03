// Supabase 연결
// .env.local 에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 를 넣으면 켜져요.
// 값이 없으면 hasSupabase = false 가 되고, 앱은 "로컬 모드"(이 휴대폰에만 저장)로 그대로 동작해요.
//
// "로그인 상태 유지"(로그인 화면 체크박스):
//   켜면 로그인 정보를 localStorage에 둬서 앱을 다시 열어도 유지되고,
//   끄면 sessionStorage에 둬서 브라우저(탭)를 닫으면 로그아웃돼요.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

const KEEP_KEY = "lessgo.keepLogin";
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

export const getKeepLogin = () => safe(() => localStorage.getItem(KEEP_KEY) !== "0", true);
export const setKeepLogin = (on) => safe(() => localStorage.setItem(KEEP_KEY, on ? "1" : "0"));

// 체크 여부에 따라 localStorage / sessionStorage 중 한 곳에만 저장해요
export const authStorage = {
  getItem: (k) => safe(() => localStorage.getItem(k) ?? sessionStorage.getItem(k)),
  setItem: (k, v) => safe(() => {
    const [keep, drop] = getKeepLogin() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
    keep.setItem(k, v); drop.removeItem(k);
  }),
  removeItem: (k) => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k); }),
};

export const hasSupabase = Boolean(url && key && !url.includes("xxxxxxxx"));
export const supabase = hasSupabase ? createClient(url, key, { auth: { storage: authStorage, persistSession: true } }) : null;
