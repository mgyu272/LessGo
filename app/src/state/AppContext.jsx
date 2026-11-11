// 앱 전체가 함께 쓰는 상태 (지금 화면, 데이터, 설정, 고른 코스, 달리기, 사용자)
// 어떤 화면에서든 const app = useApp(); 으로 꺼내 써요.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getLang, setLang } from "../lib/i18n.js";
import { loadData } from "../lib/data.js";
import { useUserData } from "./useUserData.js";
import { useRun } from "./useRun.js";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// 로그인 없이 볼 수 있는 화면
const AUTH_SCREENS = new Set(["loading", "intro", "onboarding", "signup", "find", "nickname"]);
// 로그인 뒤 첫 화면(메인) = 장소와 이야기. 지도(home)는 두 번째 탭이에요
export const MAIN = "places";

export const CENTER = [37.5915, 127.0035]; // 한성대입구역~성북동 사이
export const HOME_CENTER = [37.5894, 127.0167]; // 홈 지도 첫 화면: 성북구 가운데
export const HOME_LEVEL = 6;

function autoTime() {
  const h = new Date().getHours();
  return h < 6 ? "night" : h < 9 ? "dawn" : h < 17 ? "day" : h < 21 ? "evening" : "night";
}

export function AppProvider({ children }) {
  const [lang, setLangState] = useState(getLang());
  const [screen, setScreen] = useState("loading");
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState({
    km: 5, purpose: "run", time: autoTime(), hill: "flat", themes: new Set(["stream"]), quiet: true,
  });
  const [weather, setWeather] = useState(null);
  const [course, setCourse] = useState(null);
  // 코스 고르기 조건 (목적지·거리·언덕·테마·이동 방식). 홈·장소 화면에서 목적지를 미리 골라 넘겨요
  // move: "run"(달리기) | "walk"(걷기)
  const [pick, setPick] = useState({ dest: "uiryeong", km: 5, hill: "flat", themes: [], move: "run" });
  const [spot, setSpot] = useState(null);
  // 둘러볼 곳 상세: { place, from } — from은 뒤로 갈 화면(home · places · place)
  const [explore, setExplore] = useState(null);
  // 장소 상세에서 뒤로 갈 화면 (홈 지도 핀으로 들어오면 home, 그 밖에는 places)
  const [placeFrom, setPlaceFrom] = useState("places");
  // 장소 상세를 열 때 처음 보여줄 탭 (story · history_lens · visit). 비어 있으면 이야기 탭
  const placeTab = useRef(null);
  // AI 역사 렌즈를 열면서 바로 분석할 테스트 사진 id (lib/testPhotos.js). 렌즈 화면이 읽고 비워요
  const lensTest = useRef(null);
  // 홈 지도 상태 { filter, selId, view, focus, sheet }: 둘러볼 곳 상세에 갔다 와도 그대로예요. 앱을 새로 열 때만 처음으로
  const homeMap = useRef(null);
  // 장소 탭 상태 { cat, dest, kind }: 고른 카테고리·코스 목적지는 상세에 갔다 와도 그대로예요
  const placesView = useRef({ cat: "exhibit", dest: "simujang", kind: "all" });
  // 상권 탭에서 가게 사진·이름을 누르면 홈 지도에 그 가게를 핀 하나로 보여줘요. 지도 밖 다른 화면으로 가면 풀려요
  const [mapShop, setMapShop] = useState(null);
  const [couponShop, setCouponShop] = useState(null);
  const [finish, setFinish] = useState(null);
  const [shuffle, setShuffle] = useState(0);
  const [toastMsg, setToastMsg] = useState("");
  // 로그인 직후 한 번 보여주는 사용법 카드 (components/Guide.jsx)
  const [guide, setGuide] = useState(false);
  const [demo, setDemoState] = useState(() => { try { return localStorage.getItem("runtrip.demo") !== "off"; } catch { return true; } });

  const user = useUserData();
  // 달리기 중 콜백이 항상 최신 값을 보게 ref로도 들고 있어요
  const dataRef = useRef(data); dataRef.current = data;
  const userRef = useRef(user); userRef.current = user;

  const go = useCallback((s) => {
    setScreen(s);
    if (s !== "home" && s !== "place" && s !== "explore") setMapShop(null);
  }, []);
  const toastRef = useRef(null); // 아래에서 만든 toast를 달리기 쪽(별 +1 알림)에서도 쓰게
  // 코스로 시작할 때 move를 따로 넘기지 않으면(출발지 화면의 startSavedCourse) 코스 고르기에서 고른 값을 써요
  const moveRef = useRef("run"); moveRef.current = pick.move === "walk" ? "walk" : "run";
  const run = useRun({ dataRef, userRef, moveRef, go, setSpot, setFinish, toast: useCallback((m) => toastRef.current?.(m), []) });

  // 데이터 + 날씨 불러오기
  useEffect(() => {
    loadData().then(setData).catch((e) => console.error("데이터를 못 불러왔어요", e));
    loadWeather().then(setWeather);
  }, []);

  // 로딩 화면의 새가 날아 들어오는 동안(1.8초)은 보여줘요. 움직임 줄이기 설정이면 기다리지 않아요.
  const [introDone, setIntroDone] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    if (introDone) return;
    const id = setTimeout(() => setIntroDone(true), 1800);
    return () => clearTimeout(id);
  }, [introDone]);

  // 데이터와 로그인 확인이 끝나면 첫 화면으로 (로그인 전이면 소개 화면부터, 구글로 처음 들어온 사람은 닉네임 정하기부터)
  useEffect(() => {
    if (screen === "loading" && data && user.ready && introDone) {
      setScreen(user.profile ? MAIN : user.needsNickname ? "nickname" : "intro");
    }
  }, [screen, data, user.ready, user.profile, user.needsNickname, introDone]);

  // 다른 탭에서 로그아웃했거나 세션이 끝나면 로그인 화면으로 돌아가요
  useEffect(() => {
    if (user.ready && !user.profile && !user.needsNickname && !AUTH_SCREENS.has(screen)) setScreen("onboarding");
  }, [screen, user.ready, user.profile, user.needsNickname]);

  // 로그인·가입·닉네임 정하기가 끝나면: 사용법 카드를 띄우고 메인으로
  const enterApp = useCallback(() => { setGuide(true); go(MAIN); }, [go]);
  const changeLang = (l) => { setLang(l); setLangState(l); };
  const setDemo = (v) => { setDemoState(v); try { localStorage.setItem("runtrip.demo", v ? "on" : "off"); } catch {} };
  const toastTimer = useRef(null);
  const toast = toastRef.current = (msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2200);
  };

  const value = {
    lang, changeLang, screen, go, data, settings, setSettings, weather, course, setCourse, pick, setPick,
    spot, setSpot, explore, setExplore, placeFrom, setPlaceFrom, placeTab, lensTest,homeMap, placesView, mapShop, setMapShop, couponShop, setCouponShop, finish, shuffle, setShuffle, toastMsg, toast,
    guide, setGuide, enterApp,
    demo, setDemo, user, run,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// 날씨 (Open-Meteo, 키 없이 무료). 실패하면 날씨 없이 동작해요.
async function loadWeather() {
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${CENTER[0]}&longitude=${CENTER[1]}&current=temperature_2m,precipitation,weather_code`, { signal: ctrl.signal });
    const c = (await r.json()).current;
    return { temp: c.temperature_2m, rain: c.precipitation > 0 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(c.weather_code) };
  } catch { return null; }
}
