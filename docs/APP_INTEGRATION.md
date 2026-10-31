# 앱 개발자 연동 가이드

이 문서는 현재 Less GO 저장소의 실제 경로 인덱스, 로컬 서버, 영어 음성 안내 엔진 및 해설 데이터를 기준으로 작성했습니다. 경로 추천 코드는 Python 개발용이며, 앱에서는 저장된 대표 경로 인덱스를 읽어 경로 파일을 선택하는 방식을 권장합니다.

## 필요한 파일

| 용도 | 파일 |
|---|---|
| 목적지 ID와 좌표 | `data/destinations.json` |
| 목적지·거리·경사별 대표 경로 및 상태 | `outputs/app/representative_routes.json` |
| 대표 경로 상세 지표 | 인덱스의 `files.json`이 가리키는 파일 |
| 지도 표시 좌표 | 인덱스의 `files.geojson`이 가리키는 파일 |
| 영어 길 안내 데이터 로더 | `src/navigation_data.py` |
| 브라우저 음성 안내 엔진 | `web/english_voice_navigation.js` |
| 로컬 테스트 지도/API 서버 | `serve_kakao_map.py`, `web/kakao_route_map.html` |
| 한국어·영어 역사 해설 | `data/narrations.json` |

`outputs/cache/`는 경로 재생성에 사용하는 개발 캐시입니다. 앱 런타임 필수 데이터와는 구분하세요.

## ID, 거리 및 경사 값

목적지 ID는 `simujang`, `jeongneung`, `uiryeong`입니다. 거리 레이블은 `3km`, `5km`, `10km`이며 경사 모드는 `low`(경사 싫어요), `any`(경사 괜찮아요)입니다. 인덱스에 없는 조합을 앱에서 경로가 있다고 가정하지 마세요.

## 대표 경로 인덱스 조회

인덱스 구조는 최상단의 `destinations` 아래 목적지 ID, 거리 레이블, `modes` 순서입니다. 선택 경로는 다음과 같이 조회합니다.

~~~js
const index = await fetch("/assets/representative_routes.json").then(r => r.json());
const entry = index.destinations?.[destinationId]?.[`${distanceKm}km`];
const route = entry?.modes?.[slope];

if (!route || route.status === "no_route") {
  showNoRoute(route?.message ?? "해당 조건의 코스가 없습니다.");
} else {
  showRoute(route);
}
~~~

실제 앱에서는 `/assets/representative_routes.json`을 앱 번들 또는 백엔드에 배치해야 합니다. 이 경로는 예시이며 현재 Python 서버가 제공하는 정적 파일 URL은 아닙니다.

각 경로 항목에는 보통 `status`, `route_id`, `target_distance_km`, `distance_km`, `distance_error_m`, `duration_minutes`, `ascent_m`, `descent_m`, `start`, `destination`, `files`, `notes`, `grade_metrics`가 있습니다. 점수 하위 필드는 후보 선정 진단용이므로 앱이 필수로 의존하지 않게 구성하세요.

### 상태별 화면 처리

| status | 앱 처리 |
|---|---|
| `verified` | 저장된 경로를 표시합니다. 현장 운영·안전 보증으로 표현하지 않습니다. |
| `alternative` | 경로를 대안으로 표시하고 목표 거리와 실제 거리 오차를 함께 보여줍니다. |
| `needs_verification` | 경로는 표시할 수 있으나 확인이 남은 항목을 `notes`로 안내합니다. 검증 완료로 바꾸지 않습니다. |
| `no_route` | 지도 경로 대신 조건에 맞는 경로가 없다고 표시합니다. `files`는 비어 있습니다. |

현재 대표 인덱스는 18개 조합 중 16개에 경로가 있고, 의릉 10km의 두 모드는 `no_route`입니다. `low`와 `any`가 같은 `route_id`나 같은 좌표를 가질 수도 있습니다.

## 경로 JSON 및 GeoJSON

`files.json`은 거리·시간·상승/하강고도·ORS 단계·경사 및 러닝 분석을 담은 상세 경로 데이터입니다. 주요 필드는 `route_id`, `profile`, `geometry`, `summary`, `steps`, `start`, `waypoints`, `destination`, `running_analysis` 등입니다. 실제 저장 파일을 기준으로 선택 필드가 있을 수 있으므로 누락에 안전하게 읽으세요.

`files.geojson`은 GeoJSON FeatureCollection이며 선형 경로는 LineString입니다. 좌표 순서는 GeoJSON 규격에 따라 `[longitude, latitude, elevation?]`입니다. 지도 SDK의 좌표 객체로 변환할 때 위도·경도 순서를 확인하세요.

인덱스의 파일 값은 프로젝트 루트 기준 상대 경로입니다. Windows에서 생성된 값은 `outputs\\...`처럼 역슬래시를 포함할 수 있으므로 브라우저 URL이나 웹 서버 경로로 변환하기 전에 정규화하세요.

~~~js
const webPath = route.files.geojson.replaceAll("\\", "/");
~~~

경로 파일은 현재 서버의 `/route.geojson` 응답을 사용하는 것이 가장 간단합니다. 앱 번들에서 직접 불러온다면 인덱스의 경로를 자산 URL로 매핑하고 응답을 GeoJSON으로 파싱하세요.

## Kakao 지도에 GeoJSON 표시

Kakao Maps SDK에는 GeoJSON을 직접 렌더링하는 단일 경로 오버레이가 없으므로 LineString 좌표를 Kakao LatLng 배열로 바꿔 Polyline을 그립니다.

~~~js
const response = await fetch(routeGeoJsonUrl);
if (!response.ok) throw new Error("경로 데이터를 불러오지 못했습니다.");
const collection = await response.json();
const line = collection.features.find(f => f.geometry?.type === "LineString");
const path = line.geometry.coordinates.map(([longitude, latitude]) =>
  new kakao.maps.LatLng(latitude, longitude)
);
const polyline = new kakao.maps.Polyline({
  map,
  path,
  strokeWeight: 6,
  strokeColor: "#246BFD",
  strokeOpacity: 0.9,
  strokeStyle: "solid",
});
~~~

실제 출발 좌표와 목적지 좌표를 마커로 표시하고, 경로 전체가 보이도록 LatLngBounds를 계산해 지도 범위를 맞추세요. 목적지 현장 출입구와 공개 여부가 별도 검증되지 않은 코스가 있으므로 앱에서도 상태와 안내를 숨기지 마세요.

## 실제 로컬 API 엔드포인트

개발용 서버 실행 명령은 프로젝트 루트에서 `python serve_kakao_map.py`입니다. 기본 주소는 `http://localhost:8000`이고 서버는 `127.0.0.1`에만 바인딩됩니다.

| 요청 | 기능 |
|---|---|
| `GET /` | Kakao 지도 테스트 화면 |
| `GET /route.json?destination=simujang&distance=3&slope=low&strategy=running_focused` | 선택 조건의 대표 경로 상세 JSON |
| `GET /route.geojson?destination=simujang&distance=3&slope=low&strategy=running_focused` | 선택 경로 GeoJSON |
| `GET /route-summary.json?destination=simujang&distance=3&slope=low&strategy=running_focused` | 선택 조건에 연결된 대표 경로 인덱스 JSON |
| `GET /navigation-route.json?destination_id=simujang&route_id=ROUTE_ID` | 인덱스의 route_id를 찾아 안내용 좌표와 ORS maneuvers 반환 |
| `GET /english_voice_navigation.js` | 브라우저 내비게이션 모듈 |

유효한 `distance` 값은 3, 5, 10이고 `slope`는 `low`, `any`입니다. `strategy`는 `baseline`, `running_focused`, `access_focused`를 받습니다. 대표 인덱스를 쓰려면 `running_focused` 또는 `access_focused`를 지정하세요. `/route.json`의 기본 전략 `baseline`은 오래된 Simujang 추천 파일을 읽는 경로일 수 있습니다. 없는 경로는 404가 반환될 수 있습니다. 서버 응답은 no-cache 헤더를 붙입니다.

~~~js
const query = new URLSearchParams({
  destination: "simujang",
  distance: "3",
  slope: "low",
  strategy: "running_focused",
});
const route = await fetch(`/route.json?${query}`, { cache: "no-store" }).then(r => {
  if (!r.ok) throw new Error(`route request failed: ${r.status}`);
  return r.json();
});
~~~

`/navigation-route.json`은 `destination_id`와 `route_id`가 필수입니다. `route_id`는 인덱스에서 선택한 경로의 값을 그대로 전달하세요. 이 엔드포인트는 저장된 JSON·GeoJSON만 읽고 새 ORS 요청을 하지 않습니다. `supported: false`이면 해당 경로의 저장된 ORS 방향 안내가 부족하므로 방향 전환을 임의로 만들어 안내하면 안 됩니다.

## 경로 선택부터 음성 안내까지

1. 목적지, 거리, 경사 모드를 받아 대표 인덱스에서 모드 항목을 조회합니다.
2. `no_route`는 시작을 막고, 나머지 상태는 실제 상태 배지를 표시합니다.
3. 지도에 GeoJSON을 그리고 거리, 예상 시간, 고도 요약을 표시합니다.
4. 선택 경로의 `route_id`로 `/navigation-route.json`을 요청합니다.
5. 사용자가 러닝 시작을 누른 동작에서 안내 엔진을 준비하고 GPS 또는 시뮬레이션을 시작합니다.
6. 엔진의 `onUpdate`에서 위치, 다음 maneuvers까지 남은 거리, 이벤트를 UI에 반영합니다.
7. `arrived` 이벤트에서 경로의 destination_id를 사용해 해설 데이터를 조회합니다. 해설 화면과 해설 TTS는 현재 별도 구현이 필요합니다.

## 영어 음성 내비게이션 사용 예

`web/english_voice_navigation.js`는 브라우저에서 전역 `window.LessGoEnglishNavigation.EnglishVoiceNavigation`을 제공합니다. 아래 예는 서버에서 안내용 데이터를 읽고 사용자 버튼으로 시뮬레이션을 시작하는 흐름입니다.

~~~html
<script src="/english_voice_navigation.js"></script>
~~~

~~~js
const navigation = new window.LessGoEnglishNavigation.EnglishVoiceNavigation({
  onUpdate(state) {
    renderNavigationState(state);
    if (state.events?.some(event => event.id === "arrived")) {
      loadNarration(destinationId, selectedLanguage);
    }
  },
  onError(message) { showNavigationError(message); },
});

async function prepareRoute(destinationId, routeId) {
  navigation.stop();
  const params = new URLSearchParams({ destination_id: destinationId, route_id: routeId });
  const response = await fetch(`/navigation-route.json?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  const navRoute = await response.json();
  if (!navigation.setRoute(navRoute)) throw new Error(navRoute.reason || "Navigation unsupported");
}

startButton.addEventListener("click", () => {
  // GPS 또는 simulation. 실제 음성은 브라우저 권한·음성 엔진 상태에 따릅니다.
  navigation.start({ mode: "gps", voiceEnabled: true });
});
stopButton.addEventListener("click", () => navigation.stop());
~~~

시뮬레이션 테스트에는 `navigation.start({ mode: "simulation", speedMultiplier: 1, voiceEnabled: true })`를 사용합니다. `setRoute()`는 이전 추적·안내 기록을 초기화합니다. `setVoiceEnabled(false)`로 음성을 끄고 `stop()`으로 GPS 추적, 시뮬레이션과 현재 발화를 중지합니다. 브라우저가 `speechSynthesis`를 지원해야 영어 `en-US` 음성이 재생됩니다. GPS는 사용자의 위치 권한 및 `localhost` 또는 HTTPS 보안 컨텍스트가 필요합니다.

`arrived` 이벤트는 연속 위치 확인 후 발생합니다. 이벤트 payload에는 `id`와 영어 `text`가 들어오며, 목적지 ID는 `navRoute.destination_id`를 보관해 사용하세요. 한 번 수신한 도착 이벤트를 앱에서 중복 처리하지 않도록 화면 전환도 한 번만 수행하세요.

## 역사 해설 조회

`data/narrations.json`은 목적지 ID를 최상위 키로 갖고, 각 값에 다국어 `name`과 `narration`이 있습니다.

~~~js
const narrationData = await fetch("/assets/narrations.json").then(r => r.json());
const item = narrationData[destinationId];
const title = item?.name?.[language];
const script = item?.narration?.[language];
~~~

`/assets/narrations.json`은 앱 번들이나 배포 백엔드에서 정할 자산 URL 예시입니다. 현재 `serve_kakao_map.py`는 이 파일을 제공하는 API 엔드포인트를 구현하지 않았습니다. 앱은 완주 이벤트의 목적지 ID와 사용자 언어(`ko` 또는 `en`)로 대본을 찾아 화면에 표시하고, 앱에서 별도로 제공하는 TTS로 읽어줘야 합니다.

## 앱 개발자가 추가할 작업

- 앱 자산 또는 백엔드에 대표 인덱스, 참조 JSON·GeoJSON, 해설 데이터를 배포합니다.
- 서버의 프로젝트 상대 파일 경로를 앱 자산 URL로 매핑하고 백슬래시를 `/`로 정규화합니다.
- 상태 배지, 경로 없음 화면, 미검증 안내, 실제 거리·시간·고도 표시를 구현합니다.
- Kakao SDK 키와 허용 도메인을 배포 환경에 맞게 설정합니다.
- 모바일 OS 권한, 백그라운드 GPS, 화면 꺼짐, 배터리 정책과 실제 기기 GPS를 검증합니다.
- 영어 안내 외 역사 해설 UI, 언어 선택과 한국어·영어 해설 TTS를 구현합니다.
- 서버에서 사용자 위치를 기록할지 여부와 개인정보 보존 정책을 별도로 결정합니다.

## 저장소 파일의 역할

| 분류 | 위치 | 용도 |
|---|---|---|
| 앱 연동 필수 | `outputs/app/representative_routes.json`, 인덱스가 가리키는 코스 JSON·GeoJSON, `data/destinations.json`, `data/narrations.json`, `web/english_voice_navigation.js` | 앱에서 선택·표시·내비게이션·해설 조회 |
| 경로 계산 및 재생성 | `main.py`, `src/recommender.py`, `src/routing.py`, `src/osm_data.py`, `src/running_metrics.py`, `data/*candidates*`, 경로 설정 JSON | 후보 탐색, ORS 계산, 경로 평가 및 결과 생성 |
| 개발 서버·화면 | `serve_kakao_map.py`, `web/kakao_route_map.html` | 로컬 Kakao 지도와 JSON API 데모 |
| 테스트·개발 | `tests/`, `src/offline_rerank_saved_candidates.py`, `requirements.txt` | 자동 검증, 저장 후보 재평가, Python 의존성 |
| 로컬 캐시·임시 산출물 | `outputs/cache/`, `*.log`, `*.tmp`, 백업 파일 | 개발 중 재사용 자료. 캐시가 커질 수 있어 앱 배포 자산과 분리 |

현재 `.gitignore`는 `.env`, 자격 증명, Python 임시 파일과 `outputs/cache/`를 제외하면서 앱 대표 인덱스와 선택된 추천 결과 파일은 포함할 수 있도록 allowlist를 둡니다. 이번 작업에서는 기존 파일을 이동·삭제하거나 `.gitignore`를 바꾸지 않았습니다. `outputs/recommendations/`에는 같은 계열의 이전 후보 파일도 남아 있으므로 임의 정리하면 안 됩니다. 인덱스에서 참조하는 파일을 먼저 확인하고, 중복으로 보이는 결과는 별도 보존 정책을 세운 뒤에 정리하세요.

## 로컬 서버와 배포 환경

로컬 서버는 개발·데모 용도이며 `127.0.0.1:8000`에만 바인딩됩니다. 같은 PC의 브라우저에서 시험할 수 있지만, 휴대전화에서 `localhost`는 휴대전화 자신을 가리키므로 PC 서버 주소가 되지 않습니다. 다른 기기 시험에는 개발용 네트워크 설정이 필요하고, 실제 배포는 HTTPS를 제공하는 앱 백엔드 또는 정적 자산 호스팅으로 구성해야 합니다. Kakao Developers에는 실제 서비스 도메인을 등록하고 JavaScript 키 사용 범위를 제한하세요.

현재 제공 서버는 추천 결과 확인과 브라우저 데모를 위한 테스트 서버입니다. 앱용 인증, 사용자별 저장, 운영 모니터링, 해설 JSON 라우팅은 제공하지 않습니다. 추천 계산 명령은 ORS API를 호출할 수 있으나 위의 저장 데이터 조회 및 음성 내비게이션 엔드포인트는 ORS를 호출하지 않습니다.
