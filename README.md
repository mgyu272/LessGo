# Less GO

Less GO는 역사문화 장소를 목적지로 삼아 러닝 코스를 추천하는 서비스입니다. 사용자는 목적지, 목표 거리, 경사 선호를 선택하고 저장된 경로와 안내 데이터를 이용할 수 있습니다.

- 목적지: 심우장 (`simujang`), 정릉 (`jeongneung`), 의릉 (`uiryeong`)
- 거리: 3km, 5km, 10km
- 경사 선호: `low`(완만한 길 선호), `any`(언덕 허용)
- 러닝 완료 후 한국어·영어 역사 해설을 제공하는 것을 목표로 합니다. 현재 준비된 것은 해설 데이터이며, 앱 화면과 해설 TTS는 별도 구현이 필요합니다.

## 1. 핵심 기능 및 구현 상태

| 기능 | 상태 | 설명 |
|---|---|---|
| ORS 보행 경로 추천 | 구현됨 | `foot-walking` 경로 계산과 저장된 추천 데이터를 사용합니다. 새 경로 탐색에는 ORS 키와 외부 네트워크가 필요합니다. |
| 거리·경사별 코스 선택 | 일부 구현 | 대표 인덱스에 거리·경사별 경로 상태가 있습니다. 모든 조합에 별도 경로가 있지는 않습니다. |
| Kakao 지도 경로 표시 | 구현됨 | 로컬 Python 서버와 Kakao Maps JavaScript SDK로 저장 경로를 표시합니다. |
| 영어 음성 내비게이션 | 구현됨, 기기 검증 미완료 | 저장된 ORS 안내 단계, GPS 또는 시뮬레이션, 브라우저 Web Speech API(`en-US`)를 사용합니다. 실제 GPS 기기 현장 검증은 하지 않았습니다. |
| 한국어·영어 역사 해설 데이터 | 구현됨 | 세 유적지의 6개 대본이 `data/narrations.json`에 있습니다. |
| 역사 해설 화면·TTS | 미구현 | 앱 완주 이벤트 연결, 해설 화면, 언어 선택, 해설 음성은 앱에서 추가해야 합니다. |
| 실제 출입구·안전·노면 확인 | 미완료 | ORS·OSM 데이터만으로 현장 개방 여부나 안전을 보증하지 않습니다. |

## 2. 현재 코스 지원 현황

18개 목적지·거리·경사 조합 중 16개에 경로 파일이 있습니다. 의릉 10km의 두 모드는 `no_route`입니다.

| 목적지 | 3km (`low` / `any`) | 5km (`low` / `any`) | 10km (`low` / `any`) |
|---|---|---|---|
| 심우장 | 검증 완료 / 검증 필요 | 검증 완료 / 검증 완료 | 검증 필요 / 검증 필요 |
| 정릉 | 검증 완료 / 검증 완료 | 검증 완료 / 검증 완료 | 검증 필요 / 검증 필요 |
| 의릉 | 검증 완료 / 검증 완료 | 검증 완료 / 검증 완료 | 경로 없음 / 경로 없음 |

최신 상태와 실제 파일 경로는 [대표 경로 인덱스](outputs/app/representative_routes.json)의 각 `modes` 항목을 확인하세요. 일부 `low`와 `any`는 같은 route ID 또는 좌표를 공유합니다. 경사 모드가 항상 다른 코스를 뜻하지는 않습니다.

## 3. 앱 개발자 빠른 시작

| 용도 | 파일 |
|---|---|
| 목적지·거리·경사 인덱스 | [outputs/app/representative_routes.json](outputs/app/representative_routes.json) |
| 상세 코스 JSON·GeoJSON | 인덱스 항목의 `files.json`, `files.geojson` |
| 영어 음성 내비게이션 | [web/english_voice_navigation.js](web/english_voice_navigation.js), [src/navigation_data.py](src/navigation_data.py) |
| 한국어·영어 해설 원문 | [data/narrations.json](data/narrations.json) |
| 앱 연동 상세 안내 | [docs/APP_INTEGRATION.md](docs/APP_INTEGRATION.md) |

앱에는 대표 경로 인덱스와 참조된 경로 데이터를 함께 제공하세요. 현재 Python 서버에는 역사 해설 JSON 전용 API가 없으므로 앱 리소스로 번들하거나 배포 백엔드에서 제공해야 합니다.

## 4. 프로젝트 폴더 구조

~~~text
.
├── data/                       # 목적지, 탐색 설정, 해설 및 후보 입력
├── docs/                       # 앱 연동 가이드
├── outputs/
│   ├── app/                    # 대표 경로 인덱스와 설명
│   ├── recommendations/        # 앱에서 쓰는 경로 JSON·GeoJSON·HTML
│   └── cache/                  # 로컬 ORS·OSM 캐시 (Git 제외)
├── src/                        # 경로 계산·평가·내비게이션 데이터 로더
├── tests/                      # 영어 내비게이션 자동 테스트
├── web/                        # Kakao 지도 화면과 음성 안내 모듈
├── main.py                     # 추천 실행 진입점
├── serve_kakao_map.py          # 로컬 지도/API 서버
└── requirements.txt
~~~

주요 설정 파일은 `data/destinations.json`, `data/route_defaults.json`, `data/route_exclusions.json`, `data/running_fitness.json`입니다.

## 5. 로컬 실행 방법

PowerShell에서 프로젝트 폴더를 열어 실행 환경을 준비합니다.

~~~powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
~~~

`.env`에 본인이 발급한 `ORS_API_KEY`를 입력하세요. Kakao 지도에는 `KAKAO_JS_KEY`도 필요합니다. `.env`는 Git에서 제외됩니다. Kakao JavaScript 키는 브라우저에 전달되므로 Kakao Developers의 허용 도메인을 제한하세요.

저장된 지도와 로컬 API 서버:

~~~powershell
python serve_kakao_map.py
~~~

브라우저에서 [http://localhost:8000](http://localhost:8000)을 엽니다. 새 추천 경로 계산 예시는 ORS API를 호출할 수 있습니다.

~~~powershell
python main.py --recommend --destination-id uiryeong --target-distance-km 3 --slope-preference low --running-focused
~~~

음성 안내 로직 테스트:

~~~powershell
node --test tests/english_voice_navigation.test.cjs
~~~

## 6. 사용 기술

- Python: 경로 추천, 데이터 조회, 로컬 HTTP 서버
- OpenRouteService: `foot-walking` 경로 및 방향 안내 단계
- OpenStreetMap: 보행 네트워크·장소·도로 정보
- Folium: 결과 HTML 지도 생성
- Kakao Maps JavaScript SDK: 지도 시각화
- Browser Geolocation API 및 Web Speech API: 영어 GPS 안내와 브라우저 음성
- JSON·GeoJSON: 코스와 역사 해설 데이터

## 7. 현재 한계 및 주의사항

- 18개 조합 중 16개만 경로가 있으며, 의릉 10km는 경로가 없습니다. 일부 경로는 `needs_verification`입니다.
- 저경사와 언덕 허용 모드가 동일한 도로를 반환할 수 있습니다. 실제 `route_id`와 좌표를 비교하세요.
- 영어 음성 내비게이션은 구현됐지만 실제 GPS 기기·야외 테스트가 필요합니다. GPS는 위치 권한과 HTTPS 또는 `localhost` 보안 컨텍스트가 필요합니다.
- 역사 해설은 JSON 데이터만 있습니다. 완주 이벤트 연결, 해설 UI, 앱 TTS는 미구현입니다.
- `serve_kakao_map.py`는 `127.0.0.1:8000`에 바인딩하는 개발용 서버로 인터넷 배포용이 아닙니다.
- 대표 경로 인덱스의 `files.*`는 프로젝트 루트 기준 상대 경로입니다. Windows 백슬래시는 웹 경로로 사용할 때 슬래시로 정규화하세요.
- 경로 데이터는 출입 개방, 안전 또는 노면 상태를 보증하지 않습니다.
- `outputs/cache/`, 로그, 백업은 로컬 개발 자료입니다. 앱용 추천 JSON·GeoJSON과 혼동하거나 저장소에 추가하지 마세요.
