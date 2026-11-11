import { createRoot } from "react-dom/client";
// 글꼴은 앱 안에 같이 들어가요 (인터넷이 느려도 글꼴이 깨지지 않게)
import "@fontsource/roboto/500.css"; // Google 로그인 버튼 글꼴 (Google 가이드)
import "./styles.css";
import { AppProvider } from "./state/AppContext.jsx";
import App from "./App.jsx";

// 미리 받아 둔 글꼴(index.html preload)을 바로 쓰게 해요. 브라우저는 그 글꼴로 쓸 글자가 화면에 처음 나올 때에야
// 글꼴을 붙이는데, 소개 화면은 글자가 몇 초 뒤에 나와서 그사이 대체 글꼴로 보였다가 바뀌었어요
document.fonts?.load('400 16px "Pretendard"', "가A").catch(() => {});
document.fonts?.load('400 16px "EF Cucumber"', "성북").catch(() => {});

createRoot(document.getElementById("root")).render(
  <AppProvider>
    <App />
  </AppProvider>
);
