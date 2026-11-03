// 로그인 · 회원가입 · 아이디·비밀번호 찾기
// 아이디는 lib/auth.js 에서 가짜 이메일로 바뀌어 Supabase Auth에 넘어가요.
// Supabase 키가 없으면(로컬 모드) 비밀번호 없이 아이디만으로 들어가요.

import { useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";
import { checkSignup, checkUsername, NICKNAME_MAX } from "../lib/auth.js";
import { LangPill, OnboardingArt } from "../components/Bits.jsx";

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const bad = checkUsername(id) || (!local && !pw ? "err_pw_empty" : null);
    if (bad) return setErr(t(bad));
    setBusy(true); setErr("");
    const res = await user.signIn(id, pw);
    setBusy(false);
    if (res.ok) app.go("home"); else setErr(t(res.error));
  };

  return (
    <section className="screen onboarding">
      <div className="ob-top"><LangPill /></div>
      <div className="ob-art"><OnboardingArt /></div>
      <div className="ob-hero">
        <p className="eyebrow light">Seongbuk RunTrip</p>
        <h1>{t("ob_title")}</h1>
        <p className="ob-sub">{t("ob_sub")}</p>
      </div>
      <form className="sheet auth-sheet" onSubmit={submit} noValidate>
        <Field label={t("login_id")} value={id} placeholder={t("login_id_ph")} autoComplete="username" {...idInputProps}
          onChange={(e) => setId(e.target.value.toLowerCase())} />
        {!local && (
          <Field label={t("password")} type="password" value={pw} placeholder={t("password_ph")} autoComplete="current-password"
            onChange={(e) => setPw(e.target.value)} />
        )}
        {err && <p className="note cream" role="alert">{err}</p>}
        {!local && user.guest && <p className="note mint">{t("guest_note")}</p>}
        <button type="submit" className="btn btn-teal" disabled={busy || !id}>{busy ? t("signing_in") : t("login_btn")}</button>
        {local ? <p className="foot">{t("local_login_note")}</p> : (
          <p className="auth-links">
            <button type="button" className="link" onClick={() => app.go("signup")}>{t("to_signup")}</button>
            <span aria-hidden="true">|</span>
            <button type="button" className="link" onClick={() => app.go("find")}>{t("to_find")}</button>
          </p>
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
    <section className="screen onboarding auth-page">
      <button className="round-back" onClick={() => app.go("onboarding")} aria-label={t("back_login")}>‹</button>
      <div className="ob-top"><LangPill /></div>
      <div className="ob-hero auth-hero">
        <p className="eyebrow light">Seongbuk RunTrip</p>
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
        <button type="submit" className="btn btn-teal" disabled={busy}>{busy ? t("signing_up") : t("signup_btn")}</button>
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
    <section className="screen onboarding auth-page">
      <button className="round-back" onClick={() => app.go("onboarding")} aria-label={t("back_login")}>‹</button>
      <div className="ob-top"><LangPill /></div>
      <div className="ob-hero auth-hero">
        <p className="eyebrow light">Seongbuk RunTrip</p>
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
        <button className="btn btn-ink" onClick={() => app.go("onboarding")}>{t("back_login")}</button>
      </div>
    </section>
  );
}
