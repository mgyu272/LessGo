// 로그인 · 회원가입 · 아이디·비밀번호 찾기
// 아이디는 lib/auth.js 에서 가짜 이메일로 바뀌어 Supabase Auth에 넘어가요.
// Supabase 키가 없으면(로컬 모드) 비밀번호 없이 아이디만으로 들어가요.

import { useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";
import { checkSignup, checkUsername, NICKNAME_MAX } from "../lib/auth.js";
import { getKeepLogin, setKeepLogin } from "../lib/supabase.js";
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

  const submit = async (e) => {
    e.preventDefault();
    const bad = checkUsername(id) || (!local && !pw ? "err_pw_empty" : null);
    if (bad) return setErr(t(bad));
    setBusy(true); setErr("");
    setKeepLogin(keep); // 로그인하기 전에 정해야 세션이 맞는 곳(local/sessionStorage)에 저장돼요
    const res = await user.signIn(id, pw);
    setBusy(false);
    if (res.ok) app.go("home"); else setErr(t(res.error));
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
              <input value={id} placeholder={t("login_id_ph")} autoComplete="username" {...idInputProps}
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
        {err && <p className="note cream" role="alert">{err}</p>}
        {!local && user.guest && <p className="note mint">{t("guest_note")}</p>}
        <button type="submit" className="btn btn-cta" disabled={busy || !id}>
          {busy ? t("signing_in") : t("login_btn")}<Icon name="arrow" className="arrow" />
        </button>
        {local ? <p className="foot">{t("local_login_note")}</p> : (
          <>
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
  const [f, setF] = useState(() => ({ username: "", password: "", password2: "", nickname: user.guest?.nickname || "" }));
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
    if (res.ok) app.go("home"); else setErr(t(res.error));
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
          <Field label={t("password")} type="password" value={f.password} placeholder={t("password_ph")} autoComplete="new-password" onChange={set("password")} />
          <Field label={t("password2")} type="password" value={f.password2} placeholder={t("password2_ph")} autoComplete="new-password" onChange={set("password2")} />
          <Field label={t("nickname")} value={f.nickname} placeholder={t("nickname_ph")} hint={t("nickname_hint")} maxLength={NICKNAME_MAX} onChange={set("nickname")} />
          {user.guest && <p className="note mint">{t("guest_note")}</p>}
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
// 가짜 이메일 방식이라 메일을 보낼 수 없어요. 관리자가 Supabase에서 확인하고 새 비밀번호를 설정해 줘요 (README 4번).
export function FindAccount() {
  const app = useApp();
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
      <div className="sheet auth-sheet">
        <h4>{t("find_how")}</h4>
        <ol className="auth-steps">
          <li>{t("find_step1")}</li>
          <li>{t("find_step2")}</li>
          <li>{t("find_step3")}</li>
        </ol>
        <p className="note mint">{t("find_note")}</p>
        <button className="btn btn-soft" onClick={() => app.go("onboarding")}>{t("back_login")}</button>
      </div>
    </section>
  );
}
