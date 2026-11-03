// 사용자 데이터: 프로필(아이디·닉네임), 달리기 기록, 육각형 칸, 스탬프, 쿠폰, 보너스 별
//
// - Supabase가 연결돼 있으면: 아이디·비밀번호 로그인 → 서버(DB)에 저장, 다른 기기·랭킹과 공유
//   (아이디는 lib/auth.js 에서 가짜 이메일로 바꿔 Supabase Auth에 넘겨요)
// - 연결 안 돼 있으면: "로컬 모드" → 아이디만으로 들어가고, 이 브라우저(localStorage)에만 저장
// 화면 코드는 어느 쪽인지 신경 쓰지 않고 user.addRun(...) 처럼만 부르면 돼요.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, hasSupabase } from "../lib/supabase.js";
import { authErrorKey, normalizeUsername, usernameToEmail } from "../lib/auth.js";

const LS = {
  profile: "runtrip.profile", runs: "runtrip.runs", cells: "runtrip.cells",
  stamps: "runtrip.stamps", coupons: "runtrip.coupons", bonus: "runtrip.bonusStars",
};
const readLS = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// 별 규칙 (시안 9번 화면 기준, 숫자는 예시)
export const STAR_RULES = { perKm: 1, perStamp: 3 };
export const NEXT_REWARD = 150;

export function useUserData() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [runs, setRuns] = useState(() => readLS(LS.runs, []));
  const [cells, setCells] = useState(() => new Set(readLS(LS.cells, [])));
  const [stamps, setStamps] = useState(() => new Set(readLS(LS.stamps, [])));
  const [coupons, setCoupons] = useState(() => readLS(LS.coupons, []));
  const [bonus, setBonus] = useState(() => readLS(LS.bonus, 0));
  // 예전 닉네임(익명) 로그인이 이 기기에 남아 있으면 { nickname }. 회원가입하면 그 계정에 아이디를 붙여 기록을 이어가요.
  const [guest, setGuest] = useState(null);

  // 달리는 중에는 화면이 다시 그려지기 전에도 최신 값이 필요해서 ref에도 들고 있어요
  const cellsRef = useRef(cells);
  const stampsRef = useRef(stamps);
  const uidRef = useRef(null);
  const authBusyRef = useRef(false); // 로그인·가입 처리 중에는 onAuthStateChange 쪽에서 또 불러오지 않게

  const remote = () => (hasSupabase && uidRef.current ? supabase : null);
  const logErr = (label) => ({ error }) => { if (error) console.warn(`[supabase] ${label}:`, error.message); };

  // ---------- 서버에서 내 데이터 불러오기 ----------
  const loadRemote = useCallback(async () => {
    const uid = uidRef.current;
    const [p, r, c, s, cp, b] = await Promise.all([
      // "*": username 컬럼을 아직 안 만든 DB(마이그레이션 전)에서도 프로필을 읽을 수 있게
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("runs").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("cells").select("cell"),
      supabase.from("stamps").select("spot_id"),
      supabase.from("coupons").select("*").order("created_at", { ascending: false }),
      supabase.from("star_events").select("amount"),
    ]);
    setProfile(p.data ? { id: uid, nickname: p.data.nickname, username: p.data.username || null } : null);
    const runList = (r.data || []).map((x) => ({
      id: x.id, date: new Date(x.created_at).getTime(), courseId: x.course_id, name: x.name,
      meters: x.meters, seconds: x.seconds, cells: x.cells, stamps: x.stamps,
    }));
    setRuns(runList); writeLS(LS.runs, runList);
    cellsRef.current = new Set((c.data || []).map((x) => x.cell)); setCells(cellsRef.current); writeLS(LS.cells, [...cellsRef.current]);
    stampsRef.current = new Set((s.data || []).map((x) => x.spot_id)); setStamps(stampsRef.current); writeLS(LS.stamps, [...stampsRef.current]);
    const cps = (cp.data || []).map((x) => ({ id: x.id, shopId: x.shop_id, title: x.title, issued: new Date(x.created_at).getTime() }));
    setCoupons(cps); writeLS(LS.coupons, cps);
    const bn = (b.data || []).reduce((sum, x) => sum + x.amount, 0); setBonus(bn); writeLS(LS.bonus, bn);
  }, []);

  const enterSession = useCallback(async (session) => {
    uidRef.current = session.user.id;
    await loadRemote();
  }, [loadRemote]);

  // 이 기기에 저장된 내 데이터를 비워요 (로그아웃할 때)
  const clearLocal = useCallback(() => {
    uidRef.current = null;
    Object.values(LS).forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    cellsRef.current = new Set(); stampsRef.current = new Set();
    setProfile(null); setRuns([]); setCells(new Set()); setStamps(new Set()); setCoupons([]); setBonus(0);
  }, []);

  // ---------- 앱 시작할 때 로그인 상태 확인 (다시 열어도 로그인 유지) ----------
  useEffect(() => {
    if (!hasSupabase) { setProfile(readLS(LS.profile, null)); setReady(true); return; }
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const s = data.session;
        if (s?.user.is_anonymous) {
          // 예전 닉네임 로그인: 로그인으로 치지 않고, 회원가입할 때 이 계정에 아이디를 붙여요
          const p = await supabase.from("profiles").select("nickname").eq("id", s.user.id).maybeSingle();
          if (alive) setGuest({ nickname: p.data?.nickname || "" });
        } else if (s) {
          await enterSession(s);
        }
      } catch (e) { console.warn("[supabase] session", e); }
      if (alive) setReady(true);
    })();
    // 다른 탭에서 로그인·로그아웃하거나 세션이 만료되면 따라가요
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (authBusyRef.current) return;
      if (event === "SIGNED_OUT") { if (uidRef.current) clearLocal(); return; }
      if (event === "SIGNED_IN" && session && !session.user.is_anonymous && session.user.id !== uidRef.current) {
        // 이 콜백 안에서 Supabase를 바로 부르면 멈출 수 있어서 한 박자 뒤에 불러와요
        setTimeout(() => { if (alive) enterSession(session); }, 0);
      }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [enterSession, clearLocal]);

  // ---------- 로그인 / 회원가입 / 로그아웃 ----------
  // 결과는 { ok: true } 또는 { ok: false, error: "i18n 문구 키" }
  const signIn = useCallback(async (username, password) => {
    const id = normalizeUsername(username);
    if (!hasSupabase) {
      const p = { id: "local", nickname: id, username: id };
      writeLS(LS.profile, p); setProfile(p);
      return { ok: true };
    }
    authBusyRef.current = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(id), password });
      if (error) { console.warn("[supabase] signIn", error.message); return { ok: false, error: authErrorKey(error) }; }
      setGuest(null);
      await enterSession(data.session);
      return { ok: true };
    } finally { authBusyRef.current = false; }
  }, [enterSession]);

  const signUp = useCallback(async ({ username, password, nickname }) => {
    if (!hasSupabase) return { ok: false, error: "err_unknown" };
    const id = normalizeUsername(username);
    const nick = nickname.trim();
    const email = usernameToEmail(id);
    authBusyRef.current = true;
    try {
      // 1) 아이디 중복 미리 확인. DB에 함수가 없으면(마이그레이션 전) 건너뛰고 Supabase 응답으로 확인해요
      const avail = await supabase.rpc("username_available", { name: id });
      if (!avail.error && avail.data === false) return { ok: false, error: "err_id_taken" };

      let user;
      const { data: cur } = await supabase.auth.getSession();
      if (cur.session?.user.is_anonymous) {
        // 2-a) 이 기기의 익명 계정에 아이디·비밀번호를 붙여요 → 같은 계정이라 기존 기록이 그대로 이어져요
        const r1 = await supabase.auth.updateUser({ email });
        if (r1.error) return { ok: false, error: authErrorKey(r1.error) };
        if (r1.data.user.email !== email) return { ok: false, error: "err_confirm_on" };
        const r2 = await supabase.auth.updateUser({ password });
        if (r2.error) return { ok: false, error: authErrorKey(r2.error) };
        user = r2.data.user;
      } else {
        // 2-b) 새 계정
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return { ok: false, error: authErrorKey(error) };
        if (!data.session) return { ok: false, error: "err_confirm_on" }; // Confirm email이 켜져 있으면 바로 로그인이 안 돼요
        user = data.user;
      }

      // 3) 프로필 저장 (아이디·닉네임)
      uidRef.current = user.id;
      let up = await supabase.from("profiles").upsert({ id: user.id, nickname: nick, username: id });
      if (up.error?.code === "PGRST204") {
        console.warn("[supabase] profiles.username 컬럼이 없어요. supabase/migrations 의 SQL을 실행해 주세요.");
        up = await supabase.from("profiles").upsert({ id: user.id, nickname: nick });
      }
      if (up.error) console.warn("[supabase] profile", up.error.message);
      setGuest(null);
      await loadRemote();
      return { ok: true };
    } finally { authBusyRef.current = false; }
  }, [loadRemote]);

  const signOut = useCallback(async () => {
    authBusyRef.current = true;
    try { if (hasSupabase) await supabase.auth.signOut(); } finally { authBusyRef.current = false; }
    clearLocal();
  }, [clearLocal]);

  // ---------- 저장하기 ----------
  // 육각형 칸: 이번에 새로 얻은 칸만 넣어요
  const addCells = useCallback((fresh) => {
    if (!fresh.length) return;
    const next = new Set(cellsRef.current);
    fresh.forEach((c) => next.add(c));
    cellsRef.current = next; setCells(next); writeLS(LS.cells, [...next]);
    remote()?.from("cells")
      .upsert(fresh.map((cell) => ({ user_id: uidRef.current, cell })), { onConflict: "user_id,cell", ignoreDuplicates: true })
      .then(logErr("cells"));
  }, []);
  const hasCell = useCallback((c) => cellsRef.current.has(c), []);

  // 스탬프: 처음 찍는 스팟이면 true를 돌려줘요
  const addStamp = useCallback((spotId) => {
    if (stampsRef.current.has(spotId)) return false;
    const next = new Set(stampsRef.current); next.add(spotId);
    stampsRef.current = next; setStamps(next); writeLS(LS.stamps, [...next]);
    remote()?.from("stamps").upsert({ user_id: uidRef.current, spot_id: spotId }, { onConflict: "user_id,spot_id", ignoreDuplicates: true }).then(logErr("stamps"));
    return true;
  }, []);

  const addRun = useCallback((run) => {
    setRuns((prev) => { const n = [run, ...prev].slice(0, 100); writeLS(LS.runs, n); return n; });
    remote()?.from("runs").insert({
      user_id: uidRef.current, course_id: run.courseId, name: run.name,
      meters: run.meters, seconds: run.seconds, cells: run.cells, stamps: run.stamps,
    }).then(logErr("runs"));
  }, []);

  const addCoupon = useCallback((c) => {
    setCoupons((prev) => { const n = [c, ...prev]; writeLS(LS.coupons, n); return n; });
    remote()?.from("coupons").insert({ user_id: uidRef.current, shop_id: c.shopId, title: c.title }).then(logErr("coupons"));
  }, []);

  const addBonus = useCallback((amount, reason) => {
    setBonus((prev) => { writeLS(LS.bonus, prev + amount); return prev + amount; });
    remote()?.from("star_events").insert({ user_id: uidRef.current, amount, reason }).then(logErr("star_events"));
  }, []);

  // 영역 랭킹 (Supabase 함수 territory_leaderboard). 로컬 모드면 null.
  const leaderboard = useCallback(async () => {
    if (!remote()) return null;
    const { data, error } = await supabase.rpc("territory_leaderboard", { limit_n: 20 });
    if (error) { console.warn("[supabase] leaderboard", error.message); return null; }
    return data;
  }, []);

  const totalStars = useMemo(() => {
    const km = runs.reduce((s, r) => s + r.meters / 1000, 0);
    return Math.floor(km) * STAR_RULES.perKm + stamps.size * STAR_RULES.perStamp + bonus;
  }, [runs, stamps, bonus]);

  return {
    ready, profile, runs, cells, stamps, coupons, bonus, totalStars, online: hasSupabase, guest,
    signIn, signUp, signOut, addCells, hasCell, addStamp, addRun, addCoupon, addBonus, leaderboard,
  };
}
