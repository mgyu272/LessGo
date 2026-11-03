# 성북 런트립 (가칭) — React + Vite + Supabase

외국인 러너를 성북구 명소와 동네 가게로 잇는 러닝 관광 **웹앱**입니다. 아이폰 16 화면(393×852)에 맞췄어요.

- **PC에서 열면** 아이폰 16 프레임 안에 보여요 (발표 화면·캡처용). 프레임 없이 보려면 주소 끝에 `?frame=off`를 붙이세요.
- **휴대폰에서 열면** 프레임 없이 꽉 차게 보이고, 노치·홈 바 여백(safe area)을 지켜요.
- **Supabase를 연결하기 전에도 동작해요** ("로컬 모드": 이 브라우저에만 저장). 연결하면 로그인, 서버 저장, 영역 랭킹이 켜져요.

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
4. **Settings → Environment Variables** 에 `.env.local`과 같은 값(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)을 넣고 다시 배포
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

## 4. Supabase 연결 (아이디·비밀번호 로그인 + DB + 랭킹)

로그인은 **아이디·비밀번호** 방식이에요. 화면에서는 아이디만 받고, 앱이 내부에서 `아이디@lessgo.local` 형태의 가짜 이메일로 바꿔 Supabase Auth(이메일+비밀번호)에 넘겨요. 메일은 보내지 않아요.

1. https://supabase.com 가입 → **New project** (Region은 Seoul 추천, 비밀번호는 따로 적어 두기)
2. 왼쪽 **SQL Editor → New query** → `supabase/schema.sql` 내용을 전부 붙여넣고 **Run**
   → `profiles(아이디·닉네임), runs, cells, stamps, coupons, star_events` 테이블, 랭킹 함수, 아이디 중복 확인 함수가 생겨요
   - **이미 예전 schema.sql로 만든 프로젝트라면** `supabase/migrations/20261103_username_login.sql` 만 한 번 실행하세요
3. 왼쪽 **Authentication → Sign In / Providers → Email**
   - **Enable Email provider**: 켜기
   - **Confirm email**: **끄기** (가짜 이메일이라 확인 메일을 받을 수 없어요. 켜 두면 가입은 돼도 로그인이 안 돼요)
   - **Secure email change**: 끄기 권장 (예전 익명 사용자가 회원가입할 때 그 계정에 아이디를 붙이는 데 필요해요)
   - **Allow anonymous sign-ins**: 새로 쓰지는 않아요. 예전에 닉네임으로 시작한 사람들이 회원가입으로 옮겨 올 때까지는 켜 둬도 되고, 다 옮겨 왔으면 꺼도 돼요
4. **Project Settings → API**(또는 위쪽 **Connect**)에서 **Project URL**과 **anon(또는 publishable) key** 복사
5. 이 폴더의 `.env.example`을 복사해서 이름을 **`.env.local`**로 바꾸고 값 붙여넣기
6. 터미널에서 `Ctrl + C` 후 `npm run dev` 다시 실행 → 시작 화면에서 **회원가입** → 아이디·비밀번호·닉네임 입력

연결되면 시작 화면에 비밀번호 칸과 "회원가입 | 아이디·비밀번호 찾기"가 보이고, **스탬프·별 탭에 영역 랭킹**이 떠요.
연결하지 않으면(로컬 모드) 비밀번호 없이 아이디만으로 들어가고, 기록은 그 휴대폰에만 저장돼요.

### 아이디 규칙
- 아이디: 영문 소문자·숫자·`_` 4~20자 (대문자로 입력해도 소문자로 바뀌어요). 중복 불가
- 비밀번호: 8자 이상
- 예전에 닉네임으로 시작한 사람은 **같은 휴대폰에서 회원가입**하면 그 기록이 새 아이디 계정으로 그대로 이어져요

### 비밀번호를 잊었을 때 (관리자가 할 일)
메일을 보낼 수 없어서 앱의 "아이디·비밀번호 찾기" 화면은 팀에 연락하라는 안내만 보여줘요. 연락이 오면 **SQL Editor**에서:
```sql
-- 1) 닉네임으로 아이디 찾기
select p.username, p.nickname, u.created_at
from public.profiles p join auth.users u on u.id = p.id
where p.nickname = '닉네임';

-- 2) 임시 비밀번호 설정 (8자 이상). 알려 준 뒤 로그인하게 하세요
update auth.users
set encrypted_password = extensions.crypt('임시비밀번호123', extensions.gen_salt('bf'))
where email = '아이디@lessgo.local';
```
비밀번호는 메시지로 받지 말고, 새 임시 비밀번호만 알려 주세요.

### 알아 둘 점
- 가입할 때 "서버가 로그인 주소를 받아 주지 않았어요"가 뜨면 Supabase가 `lessgo.local` 주소를 거부한 거예요. `src/lib/auth.js`의 `AUTH_EMAIL_DOMAIN`을 팀이 가진 도메인 등으로 바꾸세요. **바꾸면 그전에 만든 계정은 로그인할 수 없으니** 사용자가 생기기 전에 정하세요.
- 표(테이블)는 Supabase **Table Editor**에서 바로 볼 수 있어요. 가입한 계정은 **Authentication → Users**에 `아이디@lessgo.local`로 보여요.
- 모든 표에 RLS(행 단위 보안)를 켜 둬서 각자 자기 기록만 읽고 써요. 랭킹은 닉네임과 칸 수만, 아이디 중복 확인은 "쓸 수 있다/없다"만 알려줘요.
- 무료 프로젝트는 한동안 안 쓰면 일시정지될 수 있어요. 본선 전에 한 번 열어 두세요.
- `anon` 키는 앱에 넣어도 되는 공개용 키예요. **`service_role` 키는 절대 넣지 마세요.**

---

## 5. AI 연결 (Gemini): 질문 답변 + AI 코스 추천

AI 기능 두 가지가 들어 있어요. 둘 다 **키만 넣으면 바로** 동작하게 만들어 뒀어요.

| 기능 | 서버 함수 | 하는 일 | 키가 없거나 실패하면 |
|---|---|---|---|
| 질문 답변 | `api/ask.js` | 스팟 자료(`spots.json`)만 근거로 답하고 출처 표시. 자료에 없으면 "자료에 없다"고 답함 | `faq`의 저장된 답변 |
| AI 코스 추천 | `api/recommend.js` | 규칙 점수로 후보 6개를 거른 뒤 Gemini가 3개를 고르고 추천 이유 한 문장 작성 | 규칙 점수 결과 |

**키 없이 미리 확인하기 (목업 모드)**: `.env.local`에 `GEMINI_MOCK=1` → `npm run dev`.
코스 목록에 "✦ 추천 이유 (mock)", 질문 답변에 "✦ AI · mock"이 보이면 연결 흐름이 정상이에요.

**키가 생기면**
1. https://aistudio.google.com → **Get API key** → 키 복사
2. `.env.local`의 `GEMINI_API_KEY=` 뒤에 붙여넣기 → `npm run dev` 다시 실행 (목업 모드는 자동으로 꺼져요)
3. 배포 사이트에도 쓰려면 Vercel → Settings → Environment Variables 에 `GEMINI_API_KEY`(필수), `GEMINI_MODEL`(선택) 추가 후 다시 배포

**정확도 채점** (기획서 성공 지표 "해설 답변 정확도")
```
npm run eval:ask
```
`eval/qa-gilsangsa.json`의 질문들을 AI에 물어보고 정답 여부와 정확도(%)를 보여줘요. 자료에 없는 질문(입장료 등)에 "모른다"고 하는지도 채점해요. 명소가 늘면 `eval/` 에 같은 모양 파일을 추가하고 `npm run eval:ask -- eval/파일이름.json`.

**말로 묻기**: 스팟 화면 질문 칸 옆 🎤 버튼 (Chrome·Safari 등 음성 인식을 지원하는 브라우저에서만 보여요)

**알아 둘 점**
- 기본 모델은 `gemini-3.5-flash-lite` (무료 등급에서 쓸 수 있는 정식 Flash-Lite). 바꾸려면 `GEMINI_MODEL`.
- 무료 등급은 하루 요청 수 한도가 있고, 대화 내용이 Google 서비스 개선에 쓰일 수 있어요. 공개된 역사 자료만 보내고 개인정보는 넣지 마세요.
- 키는 절대 `src` 코드나 `VITE_`로 시작하는 이름에 넣지 마세요 (브라우저로 새어 나가요).

## 6. 폴더 구조

```
run/
├─ index.html                 앱이 들어갈 빈 페이지 (건드릴 일 거의 없음)
├─ src/
│  ├─ main.jsx                시작점
│  ├─ App.jsx                 화면 이름 → 화면 컴포넌트 연결표
│  ├─ styles.css              색·모양 (맨 위 :root 색만 바꾸면 전체 색이 바뀜)
│  ├─ screens/                화면들 (시안 번호대로)
│  │  ├─ Home.jsx             ① 홈
│  │  ├─ Courses.jsx          ② 설정 · ③ 코스 3개 · ④ 상세
│  │  ├─ Run.jsx              ⑤ 달리기
│  │  ├─ Spot.jsx             ⑥ 스팟 도착 · ⑦ 주변 가게 · ⑧ 쿠폰
│  │  └─ Me.jsx               시작(로그인) · 완주 · ⑨ 스탬프·별·랭킹 · 내 기록
│  ├─ components/
│  │  ├─ PhoneFrame.jsx       아이폰 16 프레임
│  │  ├─ MapView.jsx          카카오 지도·육각형·마커 (지도 쓰는 화면 공통)
│  │  └─ Bits.jsx             고도 그래프, 가게 줄, QR 자리, 탭바
│  ├─ state/
│  │  ├─ AppContext.jsx       앱 전체 상태 (지금 화면, 설정, 고른 코스…)
│  │  ├─ useRun.js            달리기 진행 (GPS → 거리 → 안내 → 도착 → 완주)
│  │  └─ useUserData.js       기록 저장 (Supabase 또는 로컬)
│  └─ lib/                    화면과 상관없는 계산 도구
│     ├─ i18n.js              화면 문구 (영어/한국어) ← 문구 수정은 여기
│     ├─ gps.js               실제 GPS + 시연 모드
│     ├─ territory.js         육각형(H3)
│     ├─ voice.js             음성 안내
│     ├─ recommend.js         코스 추천 (규칙 → 나중에 AI)
│     ├─ ask.js / ai.js       질문하기 / AI 추천 호출
│     ├─ supabase.js          Supabase 연결
│     ├─ data.js / geo.js     데이터 불러오기 / 거리 계산
├─ public/data/               ← 데이터 담당이 채우는 곳 (빌드 없이 바로 반영)
│  ├─ spots.json · courses.geojson · shops.json
├─ supabase/schema.sql        Supabase 표 만들기
├─ api/
│  ├─ ask.js                  AI 질문 답변 (Vercel 서버 함수)
│  ├─ recommend.js            AI 코스 추천
│  └─ _lib/gemini.js          Gemini 호출 공통 (재시도·JSON 형식)
├─ eval/qa-gilsangsa.json     AI 정확도 채점용 정답 질문
├─ scripts/eval-ask.mjs       채점 스크립트 (npm run eval:ask)
└─ .env.example               Supabase 키 넣는 법 (복사해서 .env.local)
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

### 코스: `public/data/courses.geojson`
https://geojson.io 에서 선으로 실제 길을 따라 그리고 `properties`를 채워요.
```json
{
  "id": "gilsangsa-run",
  "name": { "en": "", "ko": "" },
  "themes": ["fortress","stream","park","alley"],
  "hill": "flat | mild | hard",
  "tone": "easy | normal | hard",
  "lamps": 1,
  "crowd": "low | mid",
  "residential": true,
  "spots": ["gilsangsa"],
  "elevation": [40, 45, 52],
  "cues": [ { "at": [경도, 위도], "text": { "en": "", "ko": "" } } ]
}
```
좌표 순서는 **[경도, 위도]** 예요. 거리·예상 시간·오르막 합계는 앱이 계산해요.

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

**React 18 + Vite · Noto Sans KR · 카카오맵 (react-kakao-maps-sdk) · H3 육각형 격자 · Web Speech 음성 · Supabase(아이디·비밀번호 로그인·Postgres·RLS) · Gemini(자료 기반 질의응답) · Vercel 배포 — 운영비 0원**

## 10. 다음에 할 일

1. Supabase 연결 (4번), 실제 데이터로 교체 (7번)
2. Vercel 배포 후 성북천에서 실제로 달려 보기 (GPS·음성 타이밍 확인)
3. Gemini 키 받아서 연결 (5번) → `npm run eval:ask`로 정확도 확인
4. 발표 대비: 시연 모드로 전체 흐름 화면 녹화
5. 2단계: 진짜 QR, 구글 로그인, Capacitor로 앱 감싸 화면 꺼진 상태 GPS

---
지도 © Kakao · H3 (Uber, Apache 2.0) · react-kakao-maps-sdk (MIT) · React (MIT)
