// 아이디·비밀번호 로그인 도우미
//
// Supabase Auth는 이메일+비밀번호로 로그인해요. 이 앱은 이메일 대신 "아이디"를 받아서
// 내부적으로 `아이디@lessgo.local` 같은 가짜 이메일로 바꿔 넘겨요.
// 그래서 메일로 비밀번호를 찾을 수는 없고, 잊으면 관리자가 비밀번호를 다시 설정해 줘요 (README 4번).
// Supabase 대시보드에서 "Confirm email"을 꺼야 가입하자마자 로그인돼요.

export const AUTH_EMAIL_DOMAIN = "lessgo.local";
export const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
export const PASSWORD_MIN = 8;
export const NICKNAME_MAX = 20;

export const normalizeUsername = (s) => s.trim().toLowerCase();
export const usernameToEmail = (username) => `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;

// 입력 확인. 문제가 있으면 i18n 문구 키를, 없으면 null을 돌려줘요.
export function checkUsername(username) {
  return USERNAME_RE.test(normalizeUsername(username)) ? null : "err_id_format";
}

export function checkSignup({ username, password, password2, nickname }) {
  return checkUsername(username)
    || (password.length < PASSWORD_MIN ? "err_pw_short" : null)
    || (password !== password2 ? "err_pw_match" : null)
    || (!nickname.trim() || nickname.trim().length > NICKNAME_MAX ? "err_nick" : null);
}

// Supabase 오류 → 한국어/영어 안내 문구 키
export function authErrorKey(error) {
  const code = error?.code || "";
  const msg = (error?.message || "").toLowerCase();
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "err_login";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered") || msg.includes("already been registered")) return "err_id_taken";
  if (code === "weak_password" || msg.includes("password should")) return "err_weak";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "err_confirm_on";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || msg.includes("rate limit")) return "err_rate";
  if (code === "email_address_invalid" || msg.includes("email address") && msg.includes("invalid")) return "err_email_domain";
  if (msg.includes("failed to fetch") || msg.includes("network")) return "err_network";
  return "err_unknown";
}
