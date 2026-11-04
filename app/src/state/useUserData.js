// 사용자 데이터: 프로필(아이디·닉네임), 달리기 기록, 육각형 칸, 스탬프, 쿠폰, 보너스 별
//
// - Firebase가 연결돼 있으면: 아이디·비밀번호 또는 구글 로그인 → Firestore에 저장, 다른 기기·랭킹과 공유
//     users/{uid}                     nickname, username(구글 계정은 없음), provider, createdAt
//     users/{uid}/runs·stamps·coupons·starEvents   기존 Supabase 테이블과 같은 필드
//     usernames/{아이디}               { uid, email }  아이디 중복 막기 + 아이디로 로그인할 때 이메일 찾기
// 별: starEvents의 amount 합계 = 지금 가진 별(보유), +만 더한 값 = 지금까지 모은 별(누적). 쿠폰을 만들면 -10
// 예전 영역(육각형) 기능은 없앴어요. 이미 저장된 users/{uid}/cells, leaderboard 문서는 지우지 않고 읽지도 쓰지도 않아요.
// - 연결 안 돼 있으면: "로컬 모드" → 아이디만으로 들어가고, 이 브라우저(localStorage)에만 저장
// 화면 코드는 어느 쪽인지 신경 쓰지 않고 user.addRun(...) 처럼만 부르면 돼요.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, getRedirectResult,
  GoogleAuthProvider, onAuthStateChanged, signOut as fbSignOut, sendPasswordResetEmail, deleteUser,
} from "firebase/auth";
import {
  doc, getDoc, getDocs, addDoc, collection, query, orderBy, limit, writeBatch, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { auth, db, hasFirebase, getKeepLogin, applyKeepLogin } from "../lib/firebase.js";
import { authErrorKey, isEmail, normalizeUsername, preferRedirect } from "../lib/auth.js";
import { getLang } from "../lib/i18n.js";

const LS = {
  profile: "runtrip.profile", runs: "runtrip.runs",
  stamps: "runtrip.stamps", coupons: "runtrip.coupons", bonus: "runtrip.bonusStars", earned: "runtrip.starsEarned",
};
const readLS = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
// 로컬 모드 로그인 정보: "로그인 상태 유지"를 끄면 sessionStorage에 둬서 브라우저를 닫으면 로그아웃돼요
const readLocalProfile = () => {
  try { const v = localStorage.getItem(LS.profile) ?? sessionStorage.getItem(LS.profile); return v ? JSON.parse(v) : null; } catch { return null; }
};
const writeLocalProfile = (p) => {
  try {
    const [keep, drop] = getKeepLogin() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
    keep.setItem(LS.profile, JSON.stringify(p)); drop.removeItem(LS.profile);
  } catch {}
};

const millis = (ts) => ts?.toMillis?.() ?? Date.now();
const warn = (label) => (e) => console.warn(`[firebase] ${label}:`, e?.code || e?.message || e);
const fail = (label, e) => { warn(label)(e); return { ok: false, error: authErrorKey(e) }; };

// 별 규칙: 코스는 500m마다 놓인 별을 줍고(30m 안), 자유 달리기는 500m마다 1개. 별 10개 = 쿠폰 1장
export const STAR_RULES = { everyM: 500, pickM: 30, perCoupon: 10 };

export function useUserData() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [runs, setRuns] = useState(() => readLS(LS.runs, []));
  const [stamps, setStamps] = useState(() => new Set(readLS(LS.stamps, [])));
  const [coupons, setCoupons] = useState(() => readLS(LS.coupons, []));
  const [bonus, setBonus] = useState(() => readLS(LS.bonus, 0));          // 지금 가진 별 (쿠폰으로 바꾸면 줄어요)
  const [starsEarned, setStarsEarned] = useState(() => readLS(LS.earned, 0)); // 지금까지 모은 별 (줄지 않아요)
  // 로그인은 됐는데 users/{uid} 문서가 없음 (구글로 처음 들어온 사람) → "닉네임 정하기" 화면
  const [needsNickname, setNeedsNickname] = useState(false);
  // 구글 리다이렉트 로그인에서 돌아왔을 때 난 오류 (로그인 화면에 보여줘요)
  const [authError, setAuthError] = useState(null);

  // 달리는 중에는 화면이 다시 그려지기 전에도 최신 값이 필요해서 ref에도 들고 있어요
  const bonusRef = useRef(bonus); // 달리는 중 별을 주울 때 바로 보유 수를 알아야 해서
  const stampsRef = useRef(stamps);
  const uidRef = useRef(null);
  const profileRef = useRef(profile); profileRef.current = profile;
  const authBusyRef = useRef(false); // 로그인·가입 처리 중에는 onAuthStateChanged 쪽에서 또 불러오지 않게

  const remoteUid = () => (hasFirebase ? uidRef.current : null);

  // ---------- 서버에서 내 데이터 불러오기 ----------
  // users/{uid} 문서가 있으면 true, 없으면(닉네임을 아직 안 정함) false
  const loadRemote = useCallback(async (uid) => {
    const me = await getDoc(doc(db, "users", uid));
    if (!me.exists()) { setProfile(null); setNeedsNickname(true); return false; }
    const sub = (name, ...q) => getDocs(query(collection(db, "users", uid, name), ...q));
    const [r, s, cp, b] = await Promise.all([
      sub("runs", orderBy("created_at", "desc"), limit(100)),
      sub("stamps"),
      sub("coupons", orderBy("created_at", "desc")),
      sub("starEvents"),
    ]);
    const u = me.data();
    const runList = r.docs.map((d) => {
      const x = d.data();
      return { id: d.id, date: millis(x.created_at), courseId: x.course_id, name: x.name, meters: x.meters, seconds: x.seconds, stamps: x.stamps, starsGot: x.stars_got || 0 };
    });
    setRuns(runList); writeLS(LS.runs, runList);
    stampsRef.current = new Set(s.docs.map((d) => d.id)); setStamps(stampsRef.current); writeLS(LS.stamps, [...stampsRef.current]);
    const cps = cp.docs.map((d) => { const x = d.data(); return { id: d.id, shopId: x.shop_id, title: x.title, issued: millis(x.created_at), pending: !!x.pending }; });
    setCoupons(cps); writeLS(LS.coupons, cps);
    const amounts = b.docs.map((d) => d.data().amount || 0);
    const bn = amounts.reduce((sum, a) => sum + a, 0); bonusRef.current = bn; setBonus(bn); writeLS(LS.bonus, bn);
    const earned = amounts.filter((a) => a > 0).reduce((sum, a) => sum + a, 0); setStarsEarned(earned); writeLS(LS.earned, earned);
    setNeedsNickname(false);
    setProfile({ id: uid, nickname: u.nickname, username: u.username || null, provider: u.provider });
    return true;
  }, []);

  // 이 기기에 저장된 내 데이터를 비워요 (로그아웃할 때)
  const clearLocal = useCallback(() => {
    uidRef.current = null;
    Object.values(LS).forEach((k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} });
    stampsRef.current = new Set(); bonusRef.current = 0;
    setProfile(null); setNeedsNickname(false);
    setRuns([]); setStamps(new Set()); setCoupons([]); setBonus(0); setStarsEarned(0);
  }, []);

  // ---------- 앱 시작할 때 로그인 상태 확인 (다시 열어도 로그인 유지) ----------
  useEffect(() => {
    if (!hasFirebase) { setProfile(readLocalProfile()); setReady(true); return; }
    let alive = true;
    // 구글 리다이렉트 로그인에서 돌아온 경우: 성공하면 아래 onAuthStateChanged가 이어 받고, 실패하면 오류만 보여줘요
    getRedirectResult(auth).catch((e) => { warn("redirect")(e); if (alive) setAuthError(authErrorKey(e)); });
    // 다른 탭에서 로그인·로그아웃하거나 세션이 만료되면 따라가요
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!authBusyRef.current) {
        if (u && u.uid !== uidRef.current) {
          uidRef.current = u.uid;
          try { await loadRemote(u.uid); } catch (e) { warn("load")(e); }
        } else if (!u && uidRef.current) {
          clearLocal();
        }
      }
      if (alive) setReady(true);
    });
    return () => { alive = false; unsub(); };
  }, [loadRemote, clearLocal]);

  // 로그인 직후 공통: 내 데이터를 불러와요. 닉네임이 없으면 needsNickname: true
  const enter = useCallback(async (user) => {
    uidRef.current = user.uid;
    const has = await loadRemote(user.uid);
    return { ok: true, needsNickname: !has };
  }, [loadRemote]);

  // ---------- 로그인 / 회원가입 / 로그아웃 ----------
  // 결과는 { ok: true, needsNickname?, redirect? } 또는 { ok: false, error: "i18n 문구 키" }
  const signIn = useCallback(async (idOrEmail, password) => {
    if (!hasFirebase) {
      const id = normalizeUsername(idOrEmail);
      const p = { id: "local", nickname: id, username: id };
      writeLocalProfile(p); setProfile(p);
      return { ok: true };
    }
    authBusyRef.current = true;
    try {
      await applyKeepLogin();
      let email = idOrEmail.trim();
      if (!isEmail(email)) {
        const snap = await getDoc(doc(db, "usernames", normalizeUsername(email)));
        if (!snap.exists()) return { ok: false, error: "err_login" };
        email = snap.data().email;
      }
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return await enter(cred.user);
    } catch (e) { return fail("signIn", e); }
    finally { authBusyRef.current = false; }
  }, [enter]);

  const signInGoogle = useCallback(async () => {
    if (!hasFirebase) return { ok: false, error: "err_unknown" };
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    auth.languageCode = getLang();
    setAuthError(null);
    if (preferRedirect()) {
      try { await applyKeepLogin(); await signInWithRedirect(auth, provider); return { ok: true, redirect: true }; }
      catch (e) { return fail("google redirect", e); }
    }
    // 팝업은 버튼을 누른 그 순간에 열어야 안 막혀서, 저장 방식 설정을 기다리지 않아요 (로그인 뒤에도 옮겨져요)
    applyKeepLogin().catch(warn("persistence"));
    authBusyRef.current = true;
    try {
      const cred = await signInWithPopup(auth, provider);
      return await enter(cred.user);
    } catch (e) {
      if (e.code === "auth/popup-blocked") {
        try { await signInWithRedirect(auth, provider); return { ok: true, redirect: true }; }
        catch (e2) { return fail("google redirect", e2); }
      }
      return fail("google popup", e);
    } finally { authBusyRef.current = false; }
  }, [enter]);

  const signUp = useCallback(async ({ username, email, password, nickname }) => {
    if (!hasFirebase) return { ok: false, error: "err_unknown" };
    const id = normalizeUsername(username);
    const nick = nickname.trim();
    authBusyRef.current = true;
    try {
      await applyKeepLogin();
      // 1) 아이디 중복 미리 확인 (진짜 선점은 아래 트랜잭션에서)
      if ((await getDoc(doc(db, "usernames", id))).exists()) return { ok: false, error: "err_id_taken" };
      // 2) 계정 만들기
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const uid = cred.user.uid;
      // 3) 아이디 선점 + 프로필 + 랭킹을 한 번에. 그사이 누가 같은 아이디를 가져갔으면 실패해요
      try {
        await runTransaction(db, async (tx) => {
          const ref = doc(db, "usernames", id);
          if ((await tx.get(ref)).exists()) throw Object.assign(new Error("id taken"), { code: "lessgo/id-taken" });
          tx.set(ref, { uid, email: cred.user.email });
          tx.set(doc(db, "users", uid), { nickname: nick, username: id, provider: "password", createdAt: serverTimestamp() });
        });
      } catch (e) {
        // 아이디를 못 잡았으면 방금 만든 계정을 지워서, 같은 이메일로 다시 가입할 수 있게 해요
        await deleteUser(cred.user).catch(() => fbSignOut(auth));
        uidRef.current = null;
        return e.code === "lessgo/id-taken" ? { ok: false, error: "err_id_taken" } : fail("signUp profile", e);
      }
      return await enter(cred.user);
    } catch (e) { return fail("signUp", e); }
    finally { authBusyRef.current = false; }
  }, [enter]);

  // 구글로 처음 들어온 사람의 닉네임 저장 (아이디는 없어요)
  const setNickname = useCallback(async (nickname) => {
    const u = auth?.currentUser;
    if (!u) return { ok: false, error: "err_unknown" };
    const nick = nickname.trim();
    const provider = u.providerData.some((p) => p.providerId === "google.com") ? "google" : "password";
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "users", u.uid), { nickname: nick, provider, createdAt: serverTimestamp() });
      await batch.commit();
      return await enter(u);
    } catch (e) { return fail("setNickname", e); }
  }, [enter]);

  // 비밀번호 재설정 메일 (아이디 또는 가입한 이메일)
  const sendReset = useCallback(async (idOrEmail) => {
    if (!hasFirebase) return { ok: false, error: "err_unknown" };
    try {
      let email = idOrEmail.trim();
      if (!isEmail(email)) {
        const snap = await getDoc(doc(db, "usernames", normalizeUsername(email)));
        if (!snap.exists()) return { ok: false, error: "err_id_unknown" };
        email = snap.data().email;
      }
      auth.languageCode = getLang();
      await sendPasswordResetEmail(auth, email);
      return { ok: true };
    } catch (e) { return fail("reset", e); }
  }, []);

  const signOut = useCallback(async () => {
    authBusyRef.current = true;
    try { if (hasFirebase) await fbSignOut(auth); } catch (e) { warn("signOut")(e); }
    finally { authBusyRef.current = false; }
    clearLocal();
  }, [clearLocal]);

  // ---------- 저장하기 ----------

  // 스탬프: 처음 찍는 스팟이면 true를 돌려줘요
  const addStamp = useCallback((spotId) => {
    if (stampsRef.current.has(spotId)) return false;
    const next = new Set(stampsRef.current); next.add(spotId);
    stampsRef.current = next; setStamps(next); writeLS(LS.stamps, [...next]);
    const uid = remoteUid();
    if (uid) writeBatch(db).set(doc(db, "users", uid, "stamps", spotId), { spot_id: spotId, created_at: serverTimestamp() }).commit().catch(warn("stamps"));
    return true;
  }, []);

  const addRun = useCallback((run) => {
    setRuns((prev) => { const n = [run, ...prev].slice(0, 100); writeLS(LS.runs, n); return n; });
    const uid = remoteUid();
    if (uid) addDoc(collection(db, "users", uid, "runs"), {
      course_id: run.courseId ?? null, name: run.name ?? null,
      meters: run.meters, seconds: run.seconds, stamps: run.stamps, stars_got: run.starsGot || 0, created_at: serverTimestamp(),
    }).catch(warn("runs"));
  }, []);

  const addCoupon = useCallback((c) => {
    setCoupons((prev) => { const n = [c, ...prev]; writeLS(LS.coupons, n); return n; });
    const uid = remoteUid();
    // pending: 제휴 협의 중인 가게의 별 쿠폰 (아직 쓸 수 없어요)
    if (uid) addDoc(collection(db, "users", uid, "coupons"), { shop_id: c.shopId ?? null, title: c.title ?? null, used: false, pending: !!c.pending, created_at: serverTimestamp() }).catch(warn("coupons"));
  }, []);

  const addBonus = useCallback((amount, reason) => {
    bonusRef.current += amount;
    setBonus(bonusRef.current); writeLS(LS.bonus, bonusRef.current);
    if (amount > 0) setStarsEarned((prev) => { writeLS(LS.earned, prev + amount); return prev + amount; });
    const uid = remoteUid();
    if (uid) addDoc(collection(db, "users", uid, "starEvents"), { amount, reason: reason ?? null, created_at: serverTimestamp() }).catch(warn("starEvents"));
  }, []);

  // 장소 정보 신고 (정보가 달라요) → Firestore reports. 로그인한 사용자만, 읽기는 막혀 있어요(보안 규칙)
  const sendReport = useCallback(async ({ spotId, reason, note }) => {
    if (!hasFirebase) return { ok: false, error: "report_local" };
    const uid = remoteUid(); if (!uid) return { ok: false, error: "report_login" };
    try {
      await addDoc(collection(db, "reports"), { spotId, reason, note: (note || "").trim().slice(0, 500), uid, createdAt: serverTimestamp() });
      return { ok: true };
    } catch (e) { return fail("report", e); }
  }, []);

  const getStarBalance = useCallback(() => bonusRef.current, []);

  return {
    ready, profile, runs, stamps, coupons, bonus, totalStars: bonus, starsEarned, getStarBalance, online: hasFirebase, needsNickname,
    authError, clearAuthError: () => setAuthError(null),
    signIn, signInGoogle, signUp, setNickname, sendReset, signOut,
    addStamp, addRun, addCoupon, addBonus, sendReport,
  };
}
