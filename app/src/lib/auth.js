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

// 구글 로그인은 PC·휴대폰 브라우저 모두 팝업(휴대폰은 새 탭)으로 해요.
// 리다이렉트는 앱 주소와 Firebase 로그인 주소(*.firebaseapp.com)가 달라서, 요즘 브라우저의 저장소 분리 때문에
// 돌아와도 로그인이 안 될 수 있어요. 팝업을 열 수 없는 홈 화면 앱(standalone)에서만 리다이렉트를 써요.
export function preferRedirect() {
  return Boolean(navigator.standalone || window.matchMedia?.("(display-mode: standalone)").matches);
}
