import { createRoot } from "react-dom/client";
// 글꼴은 앱 안에 같이 들어가요 (인터넷이 느려도 글꼴이 깨지지 않게)
import "@fontsource/roboto/500.css"; // Google 로그인 버튼 글꼴 (Google 가이드)
import "./styles.css";
import { AppProvider } from "./state/AppContext.jsx";
import App from "./App.jsx";


createRoot(document.getElementById("root")).render(
  <AppProvider>
    <App />
  </AppProvider>
);
