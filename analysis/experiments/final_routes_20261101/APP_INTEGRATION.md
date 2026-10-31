# Less GO 최종 경로 앱 연동 가이드

## 이 실험 데이터

이 폴더의 `outputs/app/representative_routes.json`은 기존 앱 인덱스와 같은 조회 구조를 사용합니다. 앱 기본 데이터는 덮어쓰지 않았습니다. 18개 조합이 모두 들어 있으며, 정릉 10km도 phase6_retry의 저장된 OSM 네트워크·제한구역 스냅샷으로 오프라인 재검증했습니다.

```text
destinations[ destination_id ][ "3km" | "5km" | "10km" ].modes[ "low" | "any" ]
```

각 모드 엔트리에는 `route_id`, `generation_status`, `verification_status`, `distance_km`, `duration_minutes`, `ascent_m`, `start`, `waypoints`, `destination`, 경사·러닝 지표, 그리고 `files.json` / `files.geojson`이 들어 있습니다. 파일 경로는 저장소 루트 기준 상대 경로이며, 웹 URL 생성 시 Windows 백슬래시를 `/`로 바꾸세요.

## 기존 카카오맵 미리보기

기존 `serve_kakao_map.py`와 `web/kakao_route_map.html`을 사용합니다. 서버 시작:

```powershell
python serve_kakao_map.py
```

브라우저에서 `http://localhost:8000/?dataset=final_routes&destination=simujang&distance=3&slope=compare&strategy=running_focused`를 열면 최종 실험 인덱스를 사용합니다. 목적지·거리·모드를 화면에서 바꿀 수 있습니다. 지도는 저장된 ORS GeoJSON 좌표를 Kakao Maps Polyline으로 그리며 경로를 다시 계산하지 않습니다.

동일한 데이터는 JSON API로 확인할 수 있습니다.

```text
GET /route.json?dataset=final_routes&destination=jeongneung&distance=10&slope=low&strategy=running_focused
GET /route.geojson?dataset=final_routes&destination=jeongneung&distance=10&slope=low&strategy=running_focused
GET /navigation-route.json?dataset=final_routes&destination_id=jeongneung&route_id=<route_id>
```

서버는 `dataset=app`이면 기존 앱 인덱스를, `dataset=final_routes`이면 이 폴더의 별도 최종 실험 인덱스를 읽습니다. 다른 값은 허용하지 않습니다. 지도 키는 기존 `.env`의 `KAKAO_JS_KEY` 설정을 계속 사용합니다.

## 앱에서 직접 파일을 읽을 때

1. 목적지 ID(`simujang`, `jeongneung`, `uiryeong`), 목표 거리, 경사 모드로 `modes` 엔트리를 조회합니다.
2. `generation_status`가 `success`인지 확인합니다. `no_valid_route`인 경우 경로를 표시하지 않습니다.
3. `verification_status`도 확인합니다. `needs_verification`은 출발 접근 또는 유적지 입구의 현장 확인이 남았다는 뜻입니다.
4. 파일 저장소나 정적 웹 서버에서 `files.geojson`을 불러와 해당 Feature의 `geometry.coordinates`를 사용합니다. 좌표 순서는 GeoJSON 표준 `[longitude, latitude, elevation?]`입니다.
5. 거리·예상 시간·상승고도·경사·러닝 친화도는 같은 엔트리 또는 상세 `files.json`에서 읽습니다.
6. 완주 시 내비게이션의 `destination_id`로 `data/narrations.json`을 조회하고 사용 언어의 `narration.ko` 또는 `narration.en`을 선택합니다.

영어 음성 내비게이션 테스트 페이지의 선택 및 위치 매칭 로직은 `web/english_voice_navigation.js`에 있습니다. 코스의 ORS directions 단계가 저장되어 있지 않으면 임의의 회전 안내를 생성하면 안 됩니다. 역사 해설 UI 및 TTS 연결은 앱에서 별도로 구현해야 합니다.

## 남은 확인

- JSON·GeoJSON 및 ORS/OSM 기반 경로 연결 검사는 자동 확인했지만 실제 현장 통행과 출입구 개방은 확인하지 않았습니다.
- 역 출구에서 러닝 시작점까지의 실제 도보 접근 경로가 데이터에 없는 코스는 출발 접근 거리를 추정하지 않습니다.
- `quality_audit.json`은 좌표 끝점 간격, 출입구 현장 확인 여부, OSM 연결 및 반복 구간 지표를 조합별로 기록합니다.
