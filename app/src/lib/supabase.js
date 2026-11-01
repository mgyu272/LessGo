// Supabase 연결
// .env.local 에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 를 넣으면 켜져요.
// 값이 없으면 hasSupabase = false 가 되고, 앱은 "로컬 모드"(이 휴대폰에만 저장)로 그대로 동작해요.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(url && key && !url.includes("xxxxxxxx"));
export const supabase = hasSupabase ? createClient(url, key) : null;
