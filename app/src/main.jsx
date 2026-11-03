import { createRoot } from "react-dom/client";
// 글꼴은 앱 안에 같이 들어가요 (인터넷이 느려도 글꼴이 깨지지 않게)
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/600.css";
import "@fontsource/noto-sans-kr/700.css";
import "@fontsource/noto-sans-kr/800.css";
import "@fontsource/roboto/500.css"; // Google 로그인 버튼 글꼴 (Google 가이드)
import "./styles.css";
import { AppProvider } from "./state/AppContext.jsx";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <AppProvider>
    <App />
  </AppProvider>
);
