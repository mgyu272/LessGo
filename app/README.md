# 성북 런트립 (가칭) — React + Vite + Firebase

외국인 러너를 성북구 명소와 동네 가게로 잇는 러닝 관광 **웹앱**입니다. 아이폰 16 화면(393×852)에 맞췄어요.

- **PC에서 열면** 아이폰 16 프레임 안에 보여요 (발표 화면·캡처용). 프레임 없이 보려면 주소 끝에 `?frame=off`를 붙이세요.
- **휴대폰에서 열면** 프레임 없이 꽉 차게 보이고, 노치·홈 바 여백(safe area)을 지켜요.
- **Firebase를 연결하기 전에도 동작해요** ("로컬 모드": 이 브라우저에만 저장). 연결하면 아이디·구글 로그인, 서버 저장, 영역 랭킹이 켜져요.

> 이전 HTML 버전은 `_html_v1` 폴더에 보관했어요. 이제 안 써도 돼요.

---

## 1. 처음 한 번만: 준비

1. **Node.js 설치**: https://nodejs.org 에서 **LTS** 버전을 받아 기본 설정으로 설치
2. VS Code에서 `run` 폴더 열기
3. VS Code 위 메뉴 **Terminal → New Terminal** 을 열고:
   ```
   npm install
   ```
   (`node_modules` 폴더가 생기면 성공. 몇 분 걸릴 수 있어요)

## 2. 실행하기 (매번)

```
npm run dev
```
→ 터미널에 나오는 `Local: http://localhost:8000/` 을 **Ctrl + 클릭**하면 브라우저에서 열려요.
코드를 고치고 저장하면 화면이 자동으로 바뀌어요. 끌 때는 터미널에서 `Ctrl + C`.

> Live Server는 이제 안 써요. React는 `npm run dev`로 열어야 해요.

### 시연 모드
- 코스 상세 화면 아래의 **시연 모드**가 켜져 있으면 GPS 없이 코스를 따라 자동으로 움직여요 (기본: 켜짐)
- 주소 끝에 `?speed=30` → 30배 빠르게. 예: `http://localhost:8000/?speed=30`
- 밖에서 실제로 달릴 때는 스위치를 끄세요

### 같은 와이파이의 휴대폰으로 화면 보기
`npm run dev` 터미널에 나오는 `Network: http://192.168.x.x:8000/` 주소를 휴대폰에서 열면 돼요.
(화면 확인용이에요. **실제 GPS는 https 주소에서만** 되니까 3번 Vercel 배포 후에 테스트하세요)

---

## 3. 휴대폰에서 실제 GPS로 테스트 (Vercel 무료 배포)

1. GitHub에 저장소를 만들고 이 폴더를 올리기 (`node_modules`, `.env.local`은 자동으로 빠져요)
2. https://vercel.com 에 GitHub로 가입 (Hobby 무료)
3. **Add New → Project** → 저장소 선택 → Framework가 **Vite**로 잡히면 그대로 **Deploy**
4. **Settings → Environment Variables** 에 `VITE_FIREBASE_*` 6개, `NEXT_PUBLIC_KAKAO_MAP_KEY`, 서버용 `GEMINI_API_KEY`를 설정하고 다시 배포. Gemini 키는 Preview/Production 중 사용할 환경에만 설정하고, Firebase **승인된 도메인**에 배포 주소도 추가 (4번)
5. 나온 https 주소를 휴대폰으로 열기 → 위치 권한 허용
6. 아이폰 Safari에서 **공유 → 홈 화면에 추가**를 하면 주소창 없이 앱처럼 열려요

알아 둘 점: 웹앱이라 **화면이 켜져 있어야** 위치가 계속 들어와요(화면 꺼짐 방지는 넣어 뒀어요). 화면을 끈 채 달리기는 나중에 Capacitor로 앱을 감싸면 가능해요.

---

## 지도 키 (카카오맵)

지도는 카카오맵이에요. `.env.example`을 복사한 `.env.local`에 카카오 디벨로퍼스의 **JavaScript 키**를 넣고 `npm run dev`를 다시 실행하세요.
```
NEXT_PUBLIC_KAKAO_MAP_KEY=여기에_JavaScript_키
```
키가 없으면 지도 자리에 안내 문구만 보여요. 카카오 디벨로퍼스 → 내 애플리케이션 → 플랫폼 → **Web 사이트 도메인**에 `http://localhost:8000` 과 배포 주소를 등록해야 지도가 떠요. Vercel에 올릴 때는 Environment Variables에도 같은 이름으로 넣어 주세요.

---

## 4. Firebase 연결 (아이디·비밀번호 + 구글 로그인 + DB + 랭킹)

무료 **Spark 플랜**만 써요 (Authentication + Firestore). Cloud Functions 같은 유료(Blaze) 기능은 쓰지 않아요.

- **아이디 로그인**: 가입할 때 아이디·이메일·비밀번호·닉네임을 받아요. 로그인은 아이디(또는 가입한 이메일) + 비밀번호
- **구글 로그인**: PC·휴대폰 브라우저 모두 팝업(휴대폰은 새 탭)으로 로그인해요. 팝업이 막히거나 홈 화면 앱이면 페이지 이동 방식으로 바뀌어요. 처음 들어오면 닉네임을 한 번 정해요
- **비밀번호 찾기**: 앱의 "아이디 · 비밀번호 찾기"에서 아이디나 이메일을 넣으면 가입 이메일로 재설정 메일이 가요

### 4-1. 콘솔 설정 (한 번만)
1. https://console.firebase.google.com → 프로젝트 → **웹 앱 등록** (`</>` 아이콘)
2. **Authentication → 로그인 방법**에서 **이메일/비밀번호**, **Google** 사용 설정
3. **Firestore Database → 데이터베이스 만들기** → 위치 `asia-northeast3 (서울)`, **프로덕션 모드**
4. **Authentication → 설정 → 승인된 도메인**에 앱 주소 추가
   - `localhost`는 기본으로 들어 있어요
   - Vercel 배포 주소(예: `lessgo.vercel.app`)를 꼭 추가하세요. 빠지면 구글 로그인이 "이 주소에서는 아직 로그인할 수 없어요"로 실패해요

### 4-2. `.env.local`
**프로젝트 설정(톱니바퀴) → 일반 → 내 앱 → SDK 설정 및 구성 → 구성**에 나오는 값을 넣어요.
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```
`.env.example`을 복사해 `.env.local`로 이름을 바꾸고 채운 뒤, 터미널에서 `Ctrl + C` → `npm run dev`로 다시 켜세요.
이 값들은 브라우저로 가는 공개용 설정이라 앱에 들어가도 괜찮아요. 대신 아래 **보안 규칙**이 데이터를 지켜요.

### 4-3. 보안 규칙 적용 (꼭 하기)
프로덕션 모드는 처음에 모든 읽기·쓰기를 막아 둬서, 규칙을 안 넣으면 가입·저장이 "서버가 저장을 거부했어요"로 실패해요.
1. **Firestore Database → 규칙** 탭
2. 편집기 내용을 전부 지우고 `firestore.rules` 파일 내용을 그대로 붙여 넣기
3. **게시** 클릭 (1분쯤 뒤에 적용돼요)

규칙 요약:
- `users/{uid}`와 그 아래 기록(runs·cells·stamps·coupons·starEvents): **본인만** 읽고 쓰기
- `usernames/{아이디}` (`uid`, `email`): 누구나 **하나씩 조회**만 가능(전체 목록은 막음), 본인 uid로 **만들기만**, 수정·삭제 금지
- `leaderboard/{uid}` (`nickname`, `cells`): 누구나 읽기, 본인 문서만 쓰기. 이 두 필드만, `cells`는 0 이상 숫자

### 4-4. Vercel 환경변수
**Vercel → 프로젝트 → Settings → Environment Variables**에 위 `VITE_FIREBASE_*` 6개를 같은 값으로 넣고 **다시 배포(Redeploy)** 하세요. `VITE_` 값은 빌드할 때 들어가서, 넣은 뒤 다시 배포해야 반영돼요.

### 4-5. 에뮬레이터로 테스트 (실제 서버 없이, 선택)
진짜 Firebase에 테스트 계정을 만들지 않고 이 컴퓨터에서 가입·로그인·보안 규칙을 확인할 수 있어요. Java가 필요해요.
```bash
npm install -g firebase-tools
firebase emulators:start --only auth,firestore --project demo-lessgo
```
다른 터미널에서 (PowerShell 기준, 값은 가짜여도 돼요):
```powershell
$env:VITE_FIREBASE_EMULATOR="1"; $env:VITE_FIREBASE_API_KEY="demo-key"; $env:VITE_FIREBASE_AUTH_DOMAIN="demo-lessgo.firebaseapp.com"; $env:VITE_FIREBASE_PROJECT_ID="demo-lessgo"; $env:VITE_FIREBASE_APP_ID="demo-app"; npx vite --port 5201
```
`http://127.0.0.1:5201` 로 여세요 (`localhost`로 열면 에뮬레이터의 구글 로그인 리다이렉트가 브라우저 저장소 분리 때문에 안 돌아와요). 설정은 `firebase.json`에 있어요.

### 데이터 구조 (Firestore)
| 위치 | 내용 |
|---|---|
| `users/{uid}` | `nickname`, `username`(구글 계정은 없음), `provider`(`password`/`google`), `createdAt` |
| `users/{uid}/runs` | `course_id`, `name`, `meters`, `seconds`, `cells`, `stamps`, `created_at` |
| `users/{uid}/cells/{h3}` | `cell`, `first_at` |
| `users/{uid}/stamps/{spotId}` | `spot_id`, `created_at` |
| `users/{uid}/coupons` | `shop_id`, `title`, `used`, `created_at` |
| `users/{uid}/starEvents` | `amount`, `reason`, `created_at` |
| `usernames/{아이디}` | `uid`, `email` (아이디 중복 막기, 아이디로 로그인할 때 이메일 찾기) |
| `leaderboard/{uid}` | `nickname`, `cells` (칸 저장과 같은 writeBatch로 갱신, 칸 수 많은 순 20명) |

### 아이디 규칙
- 아이디: 영문 소문자·숫자·`_` 4~20자 (대문자로 입력해도 소문자로 바뀌어요). 중복 불가 (가입할 때 `usernames` 문서를 트랜잭션으로 먼저 잡아요)
- 비밀번호: 8자 이상
- 구글 계정은 아이디 없이 닉네임만 있어요

### 알아 둘 점
- **이메일 공개 범위**: 아이디로 로그인하려면 로그인 전에 이메일을 찾아야 해서, 아이디를 아는 사람은 그 아이디의 이메일을 조회할 수 있어요 (목록으로 한꺼번에 가져가는 건 막혀 있어요). 가입 화면에도 이 안내를 적어 뒀어요.
- **같은 사람이 계정 두 개**: 아이디 계정과 구글 계정은 따로예요. 지금은 연결(linkWithCredential) 기능을 넣지 않았어요.
- **랭킹 칸 수는 앱이 직접 써요**: 무료 플랜이라 서버 함수로 검증하지 않아요. 규칙은 "본인 문서만, 0 이상 숫자"까지만 막아요.
- **홈 화면 앱에서 구글 로그인**: 홈 화면에 추가한 앱은 팝업을 못 열어서 페이지 이동 방식으로 로그인해요. 그런데 `authDomain`(`*.firebaseapp.com`)이 앱 주소와 다른 사이트라, 요즘 브라우저(Chrome·Safari·Firefox)의 저장소 분리 때문에 돌아와도 로그인이 안 될 수 있어요 (에뮬레이터로 확인함). 이때는 Safari에서 로그인한 뒤 홈 화면 앱을 쓰거나, 아이디 로그인을 쓰세요. 완전히 고치려면 Firebase 문서 "signInWithRedirect 권장사항"의 프록시 방식(`/__/auth/`를 `firebaseapp.com`으로 넘기고 `VITE_FIREBASE_AUTH_DOMAIN`을 배포 주소로)을 쓰면 돼요.
- 예전 Supabase 표·SQL은 저장소 맨 위 `docs/legacy-supabase/`에 보관했어요. 예전 Supabase 계정과 기록은 옮겨 오지 않아요.
- 키를 안 넣으면(로컬 모드) 비밀번호 없이 아이디만으로 들어가고, 구글 버튼은 숨겨지며, 기록은 그 휴대폰에만 저장돼요.

---

## 5. AI 기능 (Gemini)

Gemini 호출은 `api/`의 서버 API에서 수행합니다. 브라우저 코드에 API 키를 포함하지 마세요.

| 기능 | API | 동작 |
|---|---|---|
| 자료 기반 질문 답변 | `POST /api/ask` | 장소 자료와 FAQ를 바탕으로 답하고 근거를 연결합니다. |
| AI 코스 추천 | `POST /api/recommend` | 규칙 점수 후보에서 Gemini가 추천을 고릅니다. |
| AI 역사 렌즈 사진 분석 | `POST /api/analyze-image` | 사진의 대상 후보와 시각 특징을 분석하고, 현재 장소 범위에서 역사 근거를 조회합니다. |
| 역사 해설 생성 | `POST /api/generate-image-explanation` | 사진 분석 결과와 검증 근거를 사용해 자료 기반 또는 시각 중심 해설을 생성합니다. |
| 언어 전환 | `POST /api/localize-image-analysis` | 저장된 분석·근거를 다시 사용해 언어를 바꿉니다. 사진을 다시 전송하지 않습니다. |

AI 역사 렌즈는 도착 화면과 장소 상세의 `AI 역사 렌즈` 탭에서 사용할 수 있습니다. 사진 속 대상 식별과 역사 자료의 뒷받침 여부는 별도로 표시하며, 근거가 부족하거나 사진 판정이 불확실하면 대상을 확정하지 않습니다. 정확도 확률이나 임의의 신뢰도 퍼센트는 표시하지 않습니다. 한국어·영어 해설을 제공하고 브라우저 Web Speech API로 음성을 재생합니다.

### 로컬 및 Vercel 환경변수

로컬에서는 이 폴더(`app/`)의 `.env.example`을 `.env.local`로 복사해 설정하세요.

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
# 선택 사항: Vision만 별도 모델 사용
GEMINI_IMAGE_MODEL=
```

`npm run dev`는 Vite 화면과 프로젝트의 `/api/*` 로컬 미들웨어를 함께 실행합니다. 키가 없으면 AI 역사 렌즈는 준비 중 안내를 표시합니다. Vercel에서는 `GEMINI_API_KEY`를 서버 환경변수로 등록하고, Preview와 Production에 적용할 환경을 각각 지정한 뒤 재배포하세요. `GEMINI_MODEL`은 텍스트 기본 모델, `GEMINI_IMAGE_MODEL`은 선택적 이미지 모델입니다.

### 목업과 참고 사진 보호

- `GEMINI_MOCK=1`은 질문 답변·코스 추천 등 기존 텍스트 기능의 개발용 목업입니다.
- 이미지 목업은 별도 `GEMINI_IMAGE_MOCK=1`과 테스트 요청이 함께 있을 때만 동작하며, 결과에 테스트 데이터라고 표시합니다. 키가 없다고 이미지 분석 결과를 자동 생성하지 않습니다.
- 참고 사진 기능은 `GEMINI_IMAGE_REFERENCE_MODE=1`로 선택하는 opt-in 기능입니다. 외부 Gemini 전송에는 별도 권한 설정 및 manifest 승인도 필요합니다. 출처와 권한이 확인되기 전까지 원본 사진을 Git에 추가하거나 외부 API에 보내지 마세요.

### 테스트와 정확도 평가

```bash
npm run eval:heritage:validate
npm run eval:heritage:self-test
```

첫 명령은 평가 데이터셋의 라벨과 파일 경로를 확인하고, 둘째 명령은 오프라인 평가 로직을 점검합니다. 실제 인식 정확도 평가는 검증된 정답 사진·라벨과 사진 사용 권한이 준비된 경우에만 실행하세요. 기존 참고 사진 manifest는 정확도 평가용 정답 데이터가 아니며, 정답이 확인되지 않은 사진으로 정확도 수치를 만들지 않습니다. 실제 Gemini 요청은 비용·할당량이 발생할 수 있습니다.

질문 답변용 기존 평가 명령은 `npm run eval:ask`입니다. 명소 화면의 🎤 질문 버튼은 브라우저 음성 인식 지원 여부에 따라 표시됩니다.

## 6. 폴더 구조

```
run/
├─ index.html                 앱이 들어갈 빈 페이지 (건드릴 일 거의 없음)
├─ src/
│  ├─ main.jsx                시작점
│  ├─ App.jsx                 화면 이름 → 화면 컴포넌트 연결표
│  ├─ styles.css              색·모양 (맨 위 :root 색만 바꾸면 전체 색이 바뀜)
│  ├─ screens/                화면들 (디자인 원본: 저장소 맨 위 docs/design/*.dc.html)
│  │  ├─ Loading.jsx · Auth.jsx  로딩 · 로그인·회원가입
│  │  ├─ Home.jsx             홈 (지도 + 오늘의 추천)
│  │  ├─ Courses.jsx          코스 고르기 (조건 칩 · 경로 카드 · 비교표)
│  │  ├─ Run.jsx              달리는 중
│  │  ├─ Spot.jsx             도착 (레코드판 해설) · 주변 가게 · 쿠폰
│  │  ├─ RunDone.jsx          완주 요약
│  │  ├─ Places.jsx · PlaceDetail.jsx  장소와 이야기 · 장소 상세(신고)
│  │  ├─ HistoryLens.jsx       사진 분석 · 근거 대조 · 해설 · 음성
│  │  ├─ Events.jsx           문화 활동 (public/data/events.json)
│  │  ├─ Stats.jsx            내 기록 (오늘 · 주간 · 배지, 규칙은 lib/badges.js)
│  │  └─ Me.jsx               도장·쿠폰 · 기록 목록 (내 기록에서 열려요)
│  ├─ components/
│  │  ├─ PhoneFrame.jsx       아이폰 16 프레임
│  │  ├─ MapView.jsx          카카오 지도·육각형·마커 (지도 쓰는 화면 공통)
│  │  ├─ Bits.jsx             고도 그래프, 가게 줄, QR 자리, 탭바
│  │  └─ ui.jsx               공통 부품 (바텀시트 · 칩 · 세그먼트 · 배지 · 확인 다이얼로그 · 옵션 시트)
│  ├─ state/
│  │  ├─ AppContext.jsx       앱 전체 상태 (지금 화면, 설정, 고른 코스…)
│  │  ├─ useRun.js            달리기 진행 (GPS → 거리 → 안내 → 도착 → 완주)
│  │  └─ useUserData.js       로그인·기록 저장 (Firebase 또는 로컬)
│  └─ lib/                    화면과 상관없는 계산 도구
│     ├─ i18n.js              화면 문구 (영어/한국어) ← 문구 수정은 여기
│     ├─ gps.js               실제 GPS + 시연 모드
│     ├─ territory.js         육각형(H3)
│     ├─ voice.js             음성 안내
│     ├─ recommend.js         코스 추천 (규칙 → 나중에 AI)
│     ├─ ask.js / ai.js       질문·추천·역사 렌즈 API 호출
│     ├─ firebase.js          Firebase 연결 · auth.js 아이디 규칙·오류 안내
│     ├─ data.js / geo.js     데이터 불러오기 / 거리 계산
├─ public/data/               ← 데이터 담당이 채우는 곳 (빌드 없이 바로 반영)
│  ├─ spots.json · shops.json
│  ├─ lessgo/routes.json · routes.geojson   코스 번들 (팀원 데이터, 목적지 3 × 3/5/10km × low/high)
├─ firestore.rules            Firestore 보안 규칙 (콘솔에 붙여 넣기)
├─ api/
│  ├─ ask.js · recommend.js   AI 질문 답변 · 코스 추천
│  ├─ analyze-image.js        Gemini Vision 사진 분석 · 역사 근거 대조
│  ├─ generate-image-explanation.js · localize-image-analysis.js
│  │                           해설 생성 · 분석 결과 언어 전환
│  └─ _lib/                   Gemini · 역사 근거 · 해설 · 참고 사진
├─ server-data/               서버 측 역사 근거 및 참고 사진 manifest
├─ eval/qa-gilsangsa.json     AI 정확도 채점용 정답 질문
├─ scripts/eval-ask.mjs       채점 스크립트 (npm run eval:ask)
└─ .env.example               Firebase·카카오·Gemini 키 넣는 법 (복사해서 .env.local)
```

**박민규 님과 나누기 좋은 단위**: 화면 파일 단위(예: 한 명은 `Courses.jsx`, 한 명은 `Spot.jsx`)로 나누면 서로 충돌이 적어요.

---

## 7. 데이터 담당(박소영·조가은 님)께 전달할 형식

**지금 데이터는 화면 확인용 예시예요.** 길상사 좌표·이야기는 실제 자료 기준이고, 나머지 코스 좌표와 "스팟 A/B"는 자리표시예요.
파일 위치만 `public/data/`로 바뀌었고 형식은 그대로예요.

### 명소: `public/data/spots.json`
(아래 예시의 `//` 뒤 설명은 실제 파일에 넣으면 오류가 나요. 지우고 넣어 주세요.)
```json
{
  "id": "gilsangsa",
  "name": { "en": "Gilsangsa Temple", "ko": "길상사" },
  "category": "history",            // history | stream | park
  "lat": 37.59913, "lng": 126.99427,
  "radius_m": 45,                   // 이 반경 안에 들어오면 '도착'
  "cards": [ { "title": {"en":"","ko":""}, "body": {"en":"","ko":""} } ],
  "narration": { "en": "음성 해설 원고 (1~2분)", "ko": "" },
  "notice": { "en": "주민·예절 안내", "ko": "" },
  "sources": [ { "title": "출처 이름", "url": "https://..." } ],
  "faq": [ { "keywords": ["when","언제"], "answer": {"en":"","ko":""}, "sources": [0] } ],
  "docs": [ "AI가 참고할 추가 원문 (선택)" ]
}
```

### 코스: `public/data/lessgo/` (팀원 번들 그대로 복사)
`outputs/react_vite_integration_20261103_final/`의 `routes.json`, `routes.geojson`을 이 폴더에 복사해요. 앱은 `src/lib/routes.js`에서 이렇게 읽어요.
- 조회: `routes.destinations[목적지].distances['3km'|'5km'|'10km'].routes['low'|'high']` (`'any'`는 `'high'`로)
- 선: `route.feature_id`로 `routes.geojson`의 feature를 찾아 ORS LineString 그대로 (좌표는 **[경도, 위도, 고도]**)
- 거리·오르막: `route.summary`. 예상 시간은 1km 6분 30초로 앱이 계산 (ORS 걷기 시간은 안 씀)
- 배지: `status === 'review_required'` → 검토 필요, `elevation.confidence === 'low'` → 고도 추정값, `formal_recommendation === true`일 때만 "오늘 가장 잘 맞는 코스"
- 목적지 id(`simujang`, `jeongneung`, `uiryeong`)가 `spots.json`의 id와 같아서 그걸로 해설을 연결해요
- 화면에서 숨길 장소는 `src/lib/data.js`의 `HIDDEN_SPOTS` (지금은 길상사)

---

## 8. 디자인 ("가을 성곽")

- **모티프**: 한양도성 화강암 · 단청 색 · 은행잎과 단풍 · 먹 · 낙관(도장)
- **색**: 먹 `#1F1C2C` · 화강암 `#E8E4DC` · 한지 `#FBF9F5` · 주홍 `#D2461F` · 은행 `#ECB22E` · 뇌록 `#2F6E5E`
  (`src/styles.css` 맨 위 `:root`에서 바꾸면 전체가 바뀌어요)
- **글꼴**: 제목·숫자·본문 모두 Noto Sans KR (앱 안에 포함돼 있어 인터넷이 느려도 안 깨져요)
- **움직임**: 시작 화면에서 성곽 위로 달리기 길이 그려짐 · 스팟 도착 때 도장이 쾅 찍힘 · 달리는 중 내 위치 맥박, 새 육각형 반짝임, 코스 진행 막대
  (휴대폰의 "동작 줄이기" 설정을 켜면 움직임이 꺼져요)
- 스팟마다 도장 글자는 `public/data/spots.json`의 `seal` (예: `"길상"`)

## 9. 기술 스택 (발표용 한 줄)

**React 18 + Vite · Noto Sans KR · 카카오맵 (react-kakao-maps-sdk) · H3 육각형 격자 · Web Speech 음성 · Firebase(아이디·구글 로그인·Firestore·보안 규칙, 무료 Spark) · Gemini(자료 기반 질의응답) · Vercel 배포 — 운영비 0원**

## 10. 다음에 할 일

1. Firebase 보안 규칙 게시·승인된 도메인 추가 (4번), 실제 데이터로 교체 (7번)
2. Vercel 배포 후 성북천에서 실제로 달려 보기 (GPS·음성 타이밍 확인)
3. Gemini 키 받아서 연결 (5번) → `npm run eval:ask`로 정확도 확인
4. 발표 대비: 시연 모드로 전체 흐름 화면 녹화
5. 2단계: 진짜 QR, 아이디·구글 계정 연결, Capacitor로 앱 감싸 화면 꺼진 상태 GPS

---
지도 © Kakao · H3 (Uber, Apache 2.0) · react-kakao-maps-sdk (MIT) · React (MIT)
