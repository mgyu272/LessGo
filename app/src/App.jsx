// 어떤 화면을 보여줄지 정하는 곳
// 화면 이름 → 컴포넌트. app.go("run") 처럼 부르면 화면이 바뀌어요.

import { useApp, MAIN } from "./state/AppContext.jsx";
import { PhoneFrame } from "./components/PhoneFrame.jsx";
import { TabBar, Toast } from "./components/Bits.jsx";
import Home from "./screens/Home.jsx";
import CoursePicker from "./screens/Courses.jsx";
import Run from "./screens/Run.jsx";
import { Spot, Shops, Coupon } from "./screens/Spot.jsx";
import { Stars, Records } from "./screens/Me.jsx";
import { Login, Signup, FindAccount, Nickname } from "./screens/Auth.jsx";
import Loading from "./screens/Loading.jsx";
import RunDone from "./screens/RunDone.jsx";
import Places from "./screens/Places.jsx";
import PlaceDetail from "./screens/PlaceDetail.jsx";
import Events from "./screens/Events.jsx";
import Stats from "./screens/Stats.jsx";
import ToCourseStart from "./screens/ToCourseStart.jsx";
import ExplorePlace from "./screens/ExplorePlace.jsx";
import Market from "./screens/Market.jsx";
import Intro from "./screens/Intro.jsx";
import Guide from "./components/Guide.jsx";

const SCREENS = {
  intro: [Intro],                  // 로그인 전 소개 (행사 문구 → 성북런 소개)
  onboarding: [Login],             // 로그인
  signup: [Signup],
  find: [FindAccount],
  nickname: [Nickname],            // 구글로 처음 들어온 사람
  home: [Home],                    // 지도 (두 번째 탭)
  courses: [CoursePicker],         // 코스 고르기 (예전 조건 시트 · 코스 3개 · 코스 상세를 합침)
  places: [Places],                // 장소와 이야기 = 로그인 뒤 메인
  market: [Market],                // 동네 상권 (식당 · 카페 등)
  place: [PlaceDetail],            // 장소 상세 (app.spot)
  explore: [ExplorePlace],         // 둘러볼 곳 상세 (app.explore.place)
  events: [Events],                // 문화 활동
  run: [Run],
  toStart: [ToCourseStart],
  spot: [Spot],
  shops: [Spot, Shops],            // 스팟 화면 위에 가게 시트
  coupon: [Coupon],
  finish: [RunDone],               // 완주 요약 (자유 달리기 · 코스 중간 종료)
  stars: [Stars],
  records: [Records],
  stats: [Stats],                  // 내 기록 (오늘 · 주간 · 배지)
};
// 하단 메뉴가 보이는 화면
const WITH_TABS = new Set(["home", "places", "market", "events", "stats", "stars", "records"]);
const DARK = new Set(["stars", "coupon"]); // 상태 표시줄 글자를 흰색으로 쓰는 어두운 화면

export default function App() {
  const { screen, data, spot, placeFrom, guide } = useApp();
  if (screen === "loading" || !data) {
    return <PhoneFrame><Loading /></PhoneFrame>;
  }
  let layers = SCREENS[screen] || SCREENS[MAIN];
  if (screen === "shops" && !spot) layers = [Shops];
  // 홈 지도 핀으로 연 장소 상세는 홈 위에 팝업으로 띄워요 (홈은 그대로 두고 X로 닫기)
  const popup = screen === "place" && placeFrom === "home";
  if (popup) layers = [Home, PlaceDetail];
  return (
    <PhoneFrame dark={DARK.has(screen)}>
      {layers.map((C, i) => <C key={popup && i === 0 ? "home0" : screen + i} />)}
      {WITH_TABS.has(screen) && <TabBar />}
      {guide && screen === MAIN && <Guide />}
      <Toast />
    </PhoneFrame>
  );
}
