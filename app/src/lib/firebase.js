// Firebase 연결 (무료 Spark 플랜 안에서만 써요: Authentication + Firestore)
// .env.local 에 VITE_FIREBASE_* 값을 넣으면 켜져요.
// 값이 없으면 hasFirebase = false 가 되고, 앱은 "로컬 모드"(이 휴대폰에만 저장)로 그대로 동작해요.
//
// "로그인 상태 유지"(로그인 화면 체크박스):
//   켜면 browserLocalPersistence → 앱을 다시 열어도 로그인 유지
//   끄면 browserSessionPersistence → 브라우저(탭)를 닫으면 로그아웃

import { initializeApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const KEEP_KEY = "lessgo.keepLogin";
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

export const getKeepLogin = () => safe(() => localStorage.getItem(KEEP_KEY) !== "0", true);
export const setKeepLogin = (on) => safe(() => localStorage.setItem(KEEP_KEY, on ? "1" : "0"));

export const hasFirebase = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

const app = hasFirebase ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

// 테스트용: VITE_FIREBASE_EMULATOR=1 이면 실제 서버 대신 이 컴퓨터의 Firebase 에뮬레이터에 붙어요 (README 4번)
if (app && env.VITE_FIREBASE_EMULATOR === "1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

// 로그인하기 직전에 불러요. 체크 여부에 맞는 곳에 로그인 정보가 저장돼요.
export function applyKeepLogin(keep = getKeepLogin()) {
  setKeepLogin(keep);
  return auth ? setPersistence(auth, keep ? browserLocalPersistence : browserSessionPersistence) : Promise.resolve();
}
