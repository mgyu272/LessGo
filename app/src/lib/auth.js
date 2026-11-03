// 아이디·비밀번호 로그인 도우미
//
// Firebase Auth는 이메일+비밀번호로 로그인해요. 가입할 때 진짜 이메일을 받고,
// usernames/{아이디} 문서에 { uid, email } 을 남겨 둬요.
// 로그인 화면에서는 "아이디"를 받아 이 문서로 이메일을 찾아 로그인해요.
// 비밀번호를 잊으면 그 이메일로 재설정 메일(sendPasswordResetEmail)을 보내요.
// 아이디를 잊었으면 아이디 칸에 가입한 이메일을 넣어도 로그인돼요.

export const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 8;
export const NICKNAME_MAX = 20;

export const normalizeUsername = (s) => s.trim().toLowerCase();
export const isEmail = (s) => s.includes("@");

// 입력 확인. 문제가 있으면 i18n 문구 키를, 없으면 null을 돌려줘요.
export function checkUsername(username) {
  return USERNAME_RE.test(normalizeUsername(username)) ? null : "err_id_format";
}

// 로그인 칸: 아이디 또는 이메일
export function checkLoginId(value) {
  return isEmail(value) ? (EMAIL_RE.test(value.trim()) ? null : "err_email_format") : checkUsername(value);
}

export function checkNickname(nickname) {
  return !nickname.trim() || nickname.trim().length > NICKNAME_MAX ? "err_nick" : null;
}

export function checkSignup({ username, email, password, password2, nickname }) {
  return checkUsername(username)
    || (EMAIL_RE.test(email.trim()) ? null : "err_email_format")
    || (password.length < PASSWORD_MIN ? "err_pw_short" : null)
    || (password !== password2 ? "err_pw_match" : null)
    || checkNickname(nickname);
}

// Firebase 오류 코드 → 안내 문구 키 (i18n.js)
const ERRORS = {
  "auth/invalid-credential": "err_login",
  "auth/wrong-password": "err_login",
  "auth/user-not-found": "err_login",
  "auth/invalid-login-credentials": "err_login",
  "auth/email-already-in-use": "err_email_taken",
  "auth/invalid-email": "err_email_format",
  "auth/missing-email": "err_email_format",
  "auth/weak-password": "err_weak",
  "auth/too-many-requests": "err_rate",
  "auth/network-request-failed": "err_network",
  "auth/popup-closed-by-user": "err_popup_closed",
  "auth/cancelled-popup-request": "err_popup_closed",
  "auth/user-cancelled": "err_popup_closed",
  "auth/unauthorized-domain": "err_domain",
  "auth/operation-not-allowed": "err_provider_off",
  "auth/account-exists-with-different-credential": "err_account_exists",
  "auth/user-disabled": "err_disabled",
  "permission-denied": "err_permission",
  unavailable: "err_network",
};
export function authErrorKey(error) {
  return ERRORS[error?.code] || (error?.message?.includes("network") ? "err_network" : "err_unknown");
}

// 모바일(특히 iOS Safari·홈 화면 앱)은 팝업이 잘 막혀서 리다이렉트로 로그인해요
export function preferRedirect() {
  const ua = navigator.userAgent || "";
  const standalone = navigator.standalone || window.matchMedia?.("(display-mode: standalone)").matches;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return Boolean(standalone || iPadOS || /iPhone|iPad|iPod|Android|Mobile/i.test(ua));
}
