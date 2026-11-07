import { createRoot } from "react-dom/client";
// 글꼴은 앱 안에 같이 들어가요 (인터넷이 느려도 글꼴이 깨지지 않게)
import "@fontsource/roboto/500.css"; // Google 로그인 버튼 글꼴 (Google 가이드)
import "./styles.css";
import { AppProvider } from "./state/AppContext.jsx";
import App from "./App.jsx";

// 아이폰 사파리(홈 화면 앱 아님): 아래 주소창이 화면 위에 떠서 가려지는 만큼 아래 여백을 더 줘요 (styles.css --browser-bar)
const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
if (/iPhone|iPod/.test(navigator.userAgent) && !standalone) document.documentElement.classList.add("ios-browser");

createRoot(document.getElementById("root")).render(
  <AppProvider>
    <App />
  </AppProvider>
);
