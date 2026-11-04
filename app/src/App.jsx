// 어떤 화면을 보여줄지 정하는 곳
// 화면 이름 → 컴포넌트. app.go("run") 처럼 부르면 화면이 바뀌어요.

import { useApp } from "./state/AppContext.jsx";
import { PhoneFrame } from "./components/PhoneFrame.jsx";
import { TabBar, Toast } from "./components/Bits.jsx";
import Home from "./screens/Home.jsx";
import CoursePicker from "./screens/Courses.jsx";
import Run from "./screens/Run.jsx";
import { Spot, Shops, Coupon } from "./screens/Spot.jsx";
import { Finish, Stars, Records } from "./screens/Me.jsx";
import { Login, Signup, FindAccount, Nickname } from "./screens/Auth.jsx";
import Loading from "./screens/Loading.jsx";

const SCREENS = {
  onboarding: [Login],             // 시작 화면 = 로그인
  signup: [Signup],
  find: [FindAccount],
  nickname: [Nickname],            // 구글로 처음 들어온 사람
  home: [Home],
  courses: [CoursePicker],         // 코스 고르기 (예전 조건 시트 · 코스 3개 · 코스 상세를 합침)
  run: [Run],
  spot: [Spot],
  shops: [Spot, Shops],            // 스팟 화면 위에 가게 시트
  coupon: [Coupon],
  finish: [Finish],
  stars: [Stars],
  records: [Records],
  stats: [Records],
};
// 하단 메뉴가 보이는 화면 (places·events·stats는 화면이 생기기 전까지 기존 화면으로 이어져요)
const WITH_TABS = new Set(["home", "places", "events", "stats", "stars", "records"]);
const DARK = new Set(["run", "stars", "coupon"]); // 상태 표시줄 글자를 흰색으로 쓰는 어두운 화면

export default function App() {
  const { screen, data, spot } = useApp();
  if (screen === "loading" || !data) {
    return <PhoneFrame><Loading /></PhoneFrame>;
  }
  let layers = SCREENS[screen] || [Home];
  if (screen === "shops" && !spot) layers = [Shops];
  return (
    <PhoneFrame dark={DARK.has(screen)}>
      {layers.map((C, i) => <C key={screen + i} />)}
      {WITH_TABS.has(screen) && <TabBar />}
      <Toast />
    </PhoneFrame>
  );
}
