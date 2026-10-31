# 대표 경로 내보내기

`representative_routes.json`은 앱 연동용 목적지·거리·경사모드별 경로 인덱스입니다. 각 모드의 `status`는 `verified`, `alternative`, `needs_verification`, `no_route` 중 하나입니다.

- `verified`: ORS 실제 보행 경로와 OSM 매칭을 확인했고, 매칭 도로에 명시적 보행 제한 태그가 없습니다. OSM/ORS 정보만으로 현장 출입 통제나 안전을 보증하지 않습니다.
- `needs_verification`: 경로는 있지만 출발지 접근선 또는 구간의 현장 개방 여부가 확인되지 않았습니다. 경계 중첩만으로 통행 불가라고 단정하지 않습니다.
- `alternative`: 목표 거리 오차가 ±100m를 넘지만 ±200m 이내입니다.
- `no_route`: 표시 기준을 만족하는 경로가 없습니다.

각 경로의 `files.json`, `files.geojson`, `files.html`은 프로젝트 루트 기준 상대 경로입니다. GeoJSON 좌표 순서는 `[longitude, latitude, elevation?]`입니다. 출구와 시작점이 다른 경우 `start.station_access`의 출구 마커를 표시할 수 있습니다. `route_verified: false`인 경우 `straight_line_distance_m`은 직선거리 추정이며 보행 연결이나 도보 시간을 뜻하지 않습니다.

`grade_metrics.thresholds.8_percent.share`와 `.10_percent.share`는 각 경로 중 해당 비율 이상의 **오르막** 길이 비중입니다. `max_sustained_uphill_grade_percent`는 100m 창에서 계산한 최대 지속 오르막 경사 추정치입니다. 이 지표는 ORS 고도 좌표를 20m 간격으로 표본화하고 60m 중앙값 창으로 평활화해 계산하며, 현장 측량값은 아닙니다. `slope_diagnostic_score`는 경사 선호별 경사 지표 점수이며 전체 추천 점수나 후보 재정렬 결과와는 다릅니다. `shared_route_fraction_between_modes`는 두 모드의 OSM 매칭 도로 구간 공유 비율입니다.
