// 로그인 · 회원가입 · 닉네임 정하기 · 아이디·비밀번호 찾기
// 아이디로 로그인하면 usernames/{아이디}에서 가입 이메일을 찾아 Firebase Auth에 넘겨요 (state/useUserData.js).
// Firebase 키가 없으면(로컬 모드) 비밀번호 없이 아이디만으로 들어가고, 구글 로그인은 숨겨요.

import { useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";
import { checkSignup, checkUsername, checkLoginId, checkNickname, NICKNAME_MAX } from "../lib/auth.js";
import { getKeepLogin, setKeepLogin } from "../lib/firebase.js";
import { LangPill } from "../components/Bits.jsx";
import { Brand } from "../components/LogoBird.jsx";
import LoginScene from "../components/LoginScene.jsx";

// 작은 선 아이콘 (24×24)
const ICONS = {
  user: "M12 12a4 4 0 100-8 4 4 0 000 8z M4 21c.8-4 4-6 8-6s7.2 2 8 6",
  lock: "M6 11h12v10H6z M8.5 11V8a3.5 3.5 0 017 0v3",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 15a3 3 0 100-6 3 3 0 000 6z",
  eyeOff: "M3 3l18 18 M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4.2 M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 004.4-1 M9.9 9.9a3 3 0 004.2 4.2",
  arrow: "M5 12h14 M13 6l6 6-6 6",
};
export const Icon = ({ name, className = "" }) => (
  <svg className={`ic ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

// 입력칸 하나 (이름표 + 칸 + 도움말)
function Field({ label, hint, ...input }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" {...input} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

const idInputProps = {
  autoCapitalize: "none", autoCorrect: "off", spellCheck: false, maxLength: 20, inputMode: "text",
};

// Google 공식 "G" 로고 (색·모양을 바꾸지 않아요)
const GoogleG = () => (
  <svg className="g-logo" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

// 로그인 결과에 따라 다음 화면으로 (구글로 처음 들어왔으면 닉네임 정하기, 리다이렉트면 페이지가 바뀌니 그대로)
const afterLogin = (app, res) => {
  if (res.redirect) return;
  app.go(res.needsNickname ? "nickname" : "home");
};

// ---------------- 로그인 (시작 화면) ----------------
export function Login() {
  const app = useApp();
  const { user } = app;
  const local = !user.online;
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [keep, setKeep] = useState(getKeepLogin);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 구글 리다이렉트에서 돌아와 실패했으면 그 안내를 보여줘요
  const shownErr = err || (user.authError ? t(user.authError) : "");

  const submit = async (e) => {
    e.preventDefault();
    // 로컬 모드는 아이디만, Firebase 모드는 아이디 또는 가입한 이메일로 들어와요
    const bad = (local ? checkUsername(id) : checkLoginId(id)) || (!local && !pw ? "err_pw_empty" : null);
    if (bad) return setErr(t(bad));
    setBusy(true); setErr(""); user.clearAuthError();
    setKeepLogin(keep); // 로그인하기 전에 정해야 맞는 저장 방식(local/session)으로 로그인돼요
    const res = await user.signIn(id, pw);
    setBusy(false);
    if (res.ok) afterLogin(app, res); else setErr(t(res.error));
  };

  const google = async () => {
    setBusy(true); setErr(""); user.clearAuthError();
    setKeepLogin(keep);
    const res = await user.signInGoogle();
    setBusy(false);
    if (res.ok) afterLogin(app, res); else if (res.error !== "err_popup_closed") setErr(t(res.error));
  };

  return (
    <section className="screen login-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <header className="login-top">
        <Brand />
        <LangPill glass />
      </header>
      <div className="login-title">
        <p className="kicker">RUN · SEONGBUK</p>
        <h1>{t("login_title1")}<br /><mark>{t("login_title_mark")}</mark>{t("login_title2")}</h1>
      </div>
      <LoginScene />
      <form className="login-form" onSubmit={submit} noValidate>
        <div className="cred-box soft">
          <label className="cred-row">
            <Icon name="user" />
            <span className="cred-field">
              <small>{t("login_id")}</small>
              <input value={id} placeholder={t("login_id_ph")} autoComplete="username" {...idInputProps} maxLength={local ? 20 : 254}
                onChange={(e) => setId(e.target.value.toLowerCase())} />
            </span>
          </label>
          {!local && (
            <>
              <span className="cred-divider" aria-hidden="true" />
              <div className="cred-row">
                <Icon name="lock" />
                <label className="cred-field">
                  <small>{t("password")}</small>
                  <input type={showPw ? "text" : "password"} value={pw} placeholder={t("password_ph")} autoComplete="current-password"
                    onChange={(e) => setPw(e.target.value)} />
                </label>
                <button type="button" className="eye-btn" onClick={() => setShowPw(!showPw)}
                  aria-label={t(showPw ? "pw_hide" : "pw_show")} aria-pressed={showPw}>
                  <Icon name={showPw ? "eyeOff" : "eye"} />
                </button>
              </div>
            </>
          )}
        </div>
        <div className="login-opts">
          <label className="keep">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>{t("keep_login")}</span>
          </label>
          {!local && <button type="button" className="link" onClick={() => app.go("find")}>{t("to_find_short")}</button>}
        </div>
        {shownErr && <p className="note cream" role="alert">{shownErr}</p>}
        <button type="submit" className="btn btn-cta" disabled={busy || !id}>
          {busy ? t("signing_in") : t("login_btn")}<Icon name="arrow" className="arrow" />
        </button>
        {local ? <p className="foot">{t("local_login_note")}</p> : (
          <>
            <p className="or-line"><span>{t("or")}</span></p>
            <button type="button" className="btn-google" onClick={google} disabled={busy}>
              <GoogleG /><span>{t("google_continue")}</span>
            </button>
            <p className="or-line"><span>{t("first_time")}</span></p>
            <button type="button" className="btn btn-soft" onClick={() => app.go("signup")}>{t("new_account")}</button>
          </>
        )}
      </form>
    </section>
  );
}

// ---------------- 회원가입 ----------------
export function Signup() {
  const app = useApp();
  const { user } = app;
  const [f, setF] = useState({ username: "", email: "", password: "", password2: "", nickname: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: k === "username" ? e.target.value.toLowerCase() : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const bad = checkSignup(f);
    if (bad) return setErr(t(bad));
    setBusy(true); setErr("");
    const res = await user.signUp(f);
    setBusy(false);
    if (res.ok) afterLogin(app, res); else setErr(t(res.error));
  };

  return (
    <section className="screen auth-page">
      <div className="hanji-layer" aria-hidden="true" />
      <button className="round-back glass" onClick={() => app.go("onboarding")} aria-label={t("back_login")}>‹</button>
      <div className="ob-top"><LangPill glass /></div>
      <div className="ob-hero auth-hero">
        <p className="kicker">RUN · SEONGBUK</p>
        <h1>{t("signup_title")}</h1>
        <p className="ob-sub">{t("signup_sub")}</p>
      </div>
      <form className="sheet auth-sheet" onSubmit={submit} noValidate>
        <div className="scroll-y">
          <Field label={t("login_id")} value={f.username} placeholder={t("login_id_ph")} hint={t("login_id_hint")} autoComplete="username" {...idInputProps}
            onChange={set("username")} />
          <Field label={t("email")} type="email" value={f.email} placeholder={t("email_ph")} hint={t("email_hint")} autoComplete="email" inputMode="email"
            autoCapitalize="none" spellCheck={false} onChange={set("email")} />
          <Field label={t("password")} type="password" value={f.password} placeholder={t("password_ph")} autoComplete="new-password" onChange={set("password")} />
          <Field label={t("password2")} type="password" value={f.password2} placeholder={t("password2_ph")} autoComplete="new-password" onChange={set("password2")} />
          <Field label={t("nickname")} value={f.nickname} placeholder={t("nickname_ph")} hint={t("nickname_hint")} maxLength={NICKNAME_MAX} onChange={set("nickname")} />
          {err && <p className="note cream" role="alert">{err}</p>}
        </div>
        <button type="submit" className="btn btn-cta" disabled={busy}>{busy ? t("signing_up") : t("signup_btn")}<Icon name="arrow" className="arrow" /></button>
        <p className="auth-links">
          <button type="button" className="link" onClick={() => app.go("onboarding")}>{t("have_account")}</button>
        </p>
      </form>
    </section>
  );
}

// ---------------- 아이디·비밀번호 찾기 ----------------
// 아이디(또는 가입한 이메일)를 넣으면 가입 이메일로 비밀번호 재설정 메일을 보내요.
// 아이디를 잊었으면 로그인 화면 아이디 칸에 가입한 이메일을 넣어도 돼요.
export function FindAccount() {
  const app = useApp();
  const { user } = app;
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  const submit = async (e) => {
    e.preventDefault();
    const bad = checkLoginId(id);
    if (bad) return setMsg({ ok: false, text: t(bad) });
    setBusy(true); setMsg(null);
    const res = await user.sendReset(id);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: t("find_sent") } : { ok: false, text: t(res.error) });
  };

  return (
    <section className="screen auth-page">
      <div className="hanji-layer" aria-hidden="true" />
      <button className="round-back glass" onClick={() => app.go("onboarding")} aria-label={t("back_login")}>‹</button>
      <div className="ob-top"><LangPill glass /></div>
      <div className="ob-hero auth-hero">
        <p className="kicker">RUN · SEONGBUK</p>
        <h1>{t("find_title")}</h1>
        <p className="ob-sub">{t("find_sub")}</p>
      </div>
      <form className="sheet auth-sheet" onSubmit={submit} noValidate>
        <div className="scroll-y">
          <Field label={t("find_id_label")} value={id} placeholder={t("find_id_ph")} autoComplete="username" {...idInputProps} maxLength={254}
            onChange={(e) => setId(e.target.value.toLowerCase())} />
          {msg && <p className={`note ${msg.ok ? "mint" : "cream"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
          <p className="note mint">{t("find_id_tip")}</p>
        </div>
        <button type="submit" className="btn btn-cta" disabled={busy || !id}>{busy ? t("find_sending") : t("find_send")}<Icon name="arrow" className="arrow" /></button>
        <p className="auth-links">
          <button type="button" className="link" onClick={() => app.go("onboarding")}>{t("back_login")}</button>
        </p>
      </form>
    </section>
  );
}

// ---------------- 닉네임 정하기 ----------------
// 구글로 처음 들어온 사람은 users/{uid} 문서가 없어서 한 번 여기서 닉네임을 정해요. (아이디는 없어도 돼요)
export function Nickname() {
  const app = useApp();
  const { user } = app;
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const bad = checkNickname(nick);
    if (bad) return setErr(t(bad));
    setBusy(true); setErr("");
    const res = await user.setNickname(nick);
    setBusy(false);
    if (res.ok) app.go("home"); else setErr(t(res.error));
  };
  const other = async () => { await user.signOut(); app.go("onboarding"); };

  return (
    <section className="screen auth-page">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="ob-top"><LangPill glass /></div>
      <div className="ob-hero auth-hero">
        <p className="kicker">RUN · SEONGBUK</p>
        <h1>{t("nick_title")}</h1>
        <p className="ob-sub">{t("nick_sub")}</p>
      </div>
      <form className="sheet auth-sheet" onSubmit={submit} noValidate>
        <div className="scroll-y">
          <Field label={t("nickname")} value={nick} placeholder={t("nickname_ph")} hint={t("nickname_hint")} maxLength={NICKNAME_MAX}
            onChange={(e) => setNick(e.target.value)} />
          {err && <p className="note cream" role="alert">{err}</p>}
        </div>
        <button type="submit" className="btn btn-cta" disabled={busy || !nick.trim()}>{busy ? t("nick_saving") : t("nick_btn")}<Icon name="arrow" className="arrow" /></button>
        <p className="auth-links">
          <button type="button" className="link" onClick={other}>{t("other_account")}</button>
        </p>
      </form>
    </section>
  );
}
