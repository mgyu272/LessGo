# Less GO

Less GO는 역사 유적지를 목적지로 삼아 실제 보행 경로를 탐색하고 러닝 코스를 추천하는 Python 프로젝트입니다. ORS(OpenRouteService)에서 경로를 계산하고 OSM(OpenStreetMap) 데이터를 후보 탐색과 경로 평가에 사용합니다.

## 실행 준비

Python 3.10 이상과 프로젝트 폴더가 필요합니다.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

`.env`에 발급받은 `ORS_API_KEY`를 입력하세요. Kakao 지도를 사용할 때는 `KAKAO_JS_KEY`도 입력합니다. `.env`는 Git에서 제외됩니다. JavaScript 키는 브라우저에 전달되므로 Kakao Developers에서 허용 도메인을 `http://localhost:8000`으로 제한하세요.

## 현재 구현된 기능

- ORS `foot-walking` 기반 실제 경로 계산과 로컬 경로 캐시
- OSM 출발지·경유지 후보 탐색 및 거리·고도·경사·러닝 친화도 평가
- 저경사(`low`)와 언덕 허용(`any`) 추천 모드
- Kakao Maps 로컬 미리보기
- 앱 연동용 대표 경로 인덱스와 JSON·GeoJSON 데이터

현재 결과 상태는 [`outputs/app/representative_routes.json`](outputs/app/representative_routes.json)에서 확인할 수 있습니다. `verified`, `alternative`, `needs_verification`, `no_route` 상태를 구분하며, 현장 출입 가능성이나 안전을 보증하지 않습니다. 아직 모든 목적지·거리 조합에 추천 경로가 있는 것은 아닙니다.

## 경로 계산

예를 들어 의릉 3km 저경사 코스를 탐색하려면 다음을 실행합니다.

```powershell
python main.py --recommend --destination-id uiryeong --target-distance-km 3 --slope-preference low --running-focused
```

`--slope-preference`에는 `low` 또는 `any`를 지정할 수 있습니다. 목적지와 거리 설정은 `data/destinations.json`과 `data/route_defaults.json`에서 관리합니다. 결과 요약 JSON, 경로 GeoJSON, HTML 지도는 `outputs/recommendations/` 아래에 저장됩니다.

## Kakao 지도 미리보기

```powershell
python serve_kakao_map.py
```

브라우저에서 `http://localhost:8000`을 엽니다. 앱 연동 시 대표 경로 인덱스와 대표 경로 파일을 함께 배포하세요.

- 인덱스: `outputs/app/representative_routes.json`
- 설명: `outputs/app/README.md`
- 각 인덱스 항목의 `files.json`, `files.geojson`, `files.html`: 프로젝트 루트 기준 상대 경로
- 지도 API: `/route.json?destination=simujang&distance=3&slope=low` 및 `/route.geojson` (거리·목적지·경사 모드는 쿼리 파라미터로 선택)

GeoJSON 좌표 순서는 `[longitude, latitude, elevation?]`입니다. API 키나 인증 정보는 앱 데이터에 넣지 마세요.

## 아직 구현하지 않은 기능과 한계

- GPS 실시간 위치 추적과 음성 내비게이션
- 역사 해설 및 장소별 콘텐츠
- 모든 목적지·거리 조합의 경로 확보와 현장 출입구·보행 연결 확인
- 안전성, 통행 개방 여부, 노면 상태의 현장 검증

ORS 경로와 OSM 태그는 참고 데이터입니다. 실제 출입구와 통행 가능 여부는 출발 전에 별도로 확인해야 합니다.
