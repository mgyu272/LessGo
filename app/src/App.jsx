// 어떤 화면을 보여줄지 정하는 곳
// 화면 이름 → 컴포넌트. app.go("run") 처럼 부르면 화면이 바뀌어요.

import { useApp } from "./state/AppContext.jsx";
import { PhoneFrame } from "./components/PhoneFrame.jsx";
import { TabBar, Toast } from "./components/Bits.jsx";
import Home from "./screens/Home.jsx";
import { Settings, CourseList, CourseDetail } from "./screens/Courses.jsx";
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
  settings: [Home, Settings],      // 시안처럼 홈 지도 위에 설정 시트를 띄워요
  list: [CourseList],
  detail: [CourseDetail],
  run: [Run],
  spot: [Spot],
  shops: [Spot, Shops],            // 스팟 화면 위에 가게 시트
  coupon: [Coupon],
  finish: [Finish],
  stars: [Stars],
  records: [Records],
};
const WITH_TABS = new Set(["home", "stars", "records"]);
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
