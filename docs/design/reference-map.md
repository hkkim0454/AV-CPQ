# 디자인 계승 대응표 (설계서 §2)

확인일: 2026-10-03

사용자 재확정(2026-10-04): 사용자가 직접 제작한 RTCOM `https://seoulav.github.io/rtcom-configurator/#matrix-configurator`와 LED `https://hkkim0454.github.io/svt-led-calculator/src/index.html`의 디자인을 그대로 계승해 앱 간 통일감을 유지한다. 아래 대응표를 화면 구현 기준으로 사용한다. 기존 사례 선택, 원가 파일 불러오기, 공수·노임·적용률 관리 화면에도 같은 글꼴·색상·버튼·입력창·패널·간격을 적용한다. 실제 화면 검수 전 디자인 일치 완료로 보고하지 않는다.

## 1. 기준 화면과 소스

| # | 앱 | 공개 URL | 로컬 소스 (확인한 경로) | 역할 |
|---|---|---|---|---|
| 1 | RTCOM Configurator | https://seoulav.github.io/rtcom-configurator/ | `C:\Users\khk00\Desktop\paseo project\rtcom-configurator\src\styles.css`, `index.html` | **기준(base)**. 셸·헤더·패널·버튼·탭·간격 |
| 2 | LED Configurator | https://hkkim0454.github.io/svt-led-calculator/src/index.html | `C:\Users\khk00\Desktop\paseo project\svt-led-calculator\src\styles.css` | **상태색·폼 컨트롤** 출처 |

RTCOM `src/styles.css`의 주석 `/* 0.5 — Seoul AV LED calculator inspired visual system */`가
RTCOM 현재 테마 자체가 LED 구성기에서 파생된 것임을 소스에서 직접 밝힌다.
따라서 두 앱은 경쟁하는 두 테마가 아니라 **LED → RTCOM 순의 같은 계열**이고,
견적 앱은 더 나중 단계인 RTCOM 셸을 기준으로 삼는다. 새 제3의 테마는 만들지 않는다.

## 2. 토큰 대응 (→ `src/styles/tokens.css`)

값은 전부 위 두 소스에서 그대로 읽은 것이다. 추정값 없음.

### 2.1 RTCOM에서 그대로 계승

| 토큰 | 값 | RTCOM 출처 |
|---|---|---|
| `--q-bg` | `#fff` | `--rt-bg` |
| `--q-soft` | `#f3f6fb` | `--rt-soft` |
| `--q-ink` | `#1f2532` | `--rt-ink` |
| `--q-muted` | `#687386` | `--rt-muted` |
| `--q-line` | `#dfe6f0` | `--rt-line` |
| `--q-accent` | `#3978ee` | `--rt-accent` |
| `--q-tint` | `#edf4ff` | `--rt-tint` |
| `--q-cta` | `linear-gradient(135deg,#3978ee,#7767f4)` | `--rt-cta` |
| `--q-cta-ink` | `#fff` | `--rt-cta-ink` |
| `--q-font` | `"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,"SF Pro Display","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif` | `#rtcom-design` font-family |
| `--q-page-bg` | `#f4f7ff` | `html{background:#f4f7ff}` |
| `--q-page-wash` | `radial-gradient(circle at 8% 0,#dceaff 0,transparent 34%),radial-gradient(circle at 92% 4%,#f0e1ff 0,transparent 32%),linear-gradient(135deg,#f7fbff,#fbf8ff)` | `body{background:…}` |
| `--q-glass-fill` | `#ffffffd9` | 패널 공통 규칙 |
| `--q-glass-stroke` | `#ffffffc7` | 패널 공통 규칙 |
| `--q-glass-shadow` | `0 18px 50px #53698a14` | 패널 공통 규칙 |
| `--q-glass-blur` | `blur(18px)` | `backdrop-filter` |
| `--q-r-shell` | `24px` | `.rt-top` border-radius |
| `--q-r-panel` | `22px` | `.rt-nav`,`.rt-footer` |
| `--q-r-main` | `28px` | `.rt-main` |
| `--q-r-card` | `20px` | `.rt-validation`,`.rt-paper` |
| `--q-r-chip` | `14px` | `.rt-step` |
| `--q-r-pill` | `999px` | `.rt-button` |
| `--q-gutter` | `16px` | 패널 좌우 margin |
| `--q-pad-main` | `34px` | `.rt-main` padding |
| `--q-pad-shell` | `18px 22px` | `.rt-top` padding |
| `--q-h-control` | `42px` | `.rt-button{min-height:42px}` |
| `--q-h-input` | `40px` | `input,select{min-height:40px}` |
| `--q-h-touch` | `44px` | `@media(pointer:coarse)` |
| `--q-mark-grad` | `linear-gradient(135deg,#347ff2,#8268f3)` | `.rt-brand-mark` |
| `--q-mark-shadow` | `0 11px 24px #4f6df43d` | `.rt-brand-mark` |
| `--q-btn-face` | `#edf2f8` | `.rt-tools .rt-button` |
| `--q-btn-ink` | `#456181` | `.rt-tools .rt-button` |
| `--q-btn-face-hover` | `#e3ebf7` | `.rt-tools .rt-button:hover` |
| `--q-btn-ink-hover` | `#326bd5` | `.rt-tools .rt-button:hover` |
| `--q-fw-strong` | `750` | `h2` |
| `--q-fw-medium` | `650` | `.rt-button`,`.rt-step` |
| `--q-max-w` | `1440px` | `#rtcom-design` |
| `--q-err` | `#c64545` | `.rt-validation li[data-level=ERROR]` |
| `--q-ok` | `#34835b` | `.rt-validation li[data-level=VALID]` |

### 2.2 LED 구성기에서 계승 — 판정 상태색과 폼 컨트롤

RTCOM에는 2단계(ERROR/VALID) 상태색밖에 없다. 견적 앱의 **필수 부자재 판정은 5단계**(§7.2)라
RTCOM 팔레트로는 표현할 수 없다. LED 구성기는 정확히 5단계 `--vp-*` 판정 팔레트를 갖고 있으므로
이 역할에 한해 LED 패턴을 따른다.

| 토큰 | 값 | LED 출처 | 견적 앱 역할 |
|---|---|---|---|
| `--q-v-ok` / `-ink` / `-tint` / `-border` | `#1E9E52` / `#177A41` / `rgba(30,158,82,.08)` / `rgba(30,158,82,.30)` | `--vp-ok*` | `satisfied` |
| `--q-v-rec` / `-ink` / `-border` | `#007AFF` / `#0057D8` / `rgba(0,122,255,.38)` | `--vp-rec*` | `auto-addable` |
| `--q-v-cond` / `-ink` / `-tint` / `-border` | `#E08A20` / `#C7590A` / `rgba(224,138,32,.10)` / `rgba(199,89,10,.30)` | `--vp-cond*` | `selection-required` |
| `--q-v-edge` / `-ink` / `-tint` / `-border` | `#8944AB` / `#8944AB` / `rgba(137,68,171,.09)` / `rgba(137,68,171,.30)` | `--vp-edge*` | `information-required` |
| `--q-v-no` / `-ink` / `-tint` / `-border` | `#D70015` / `#D70015` / `rgba(215,0,21,.06)` / `rgba(215,0,21,.22)` | `--vp-no*` | `incompatible` |
| `--q-field-fill` | `rgba(118,118,128,.10)` | `--field-fill` | 견적 표 입력 셀 |
| `--q-field-fill-focus` | `rgba(255,255,255,.9)` | `--field-fill-focus` | 입력 셀 포커스 |
| `--q-focus-ring` | `0 0 0 4px rgba(57,120,238,.12)` | `input:focus` 패턴 + RTCOM accent | 포커스 링 |
| `--q-seg-track` | `rgba(118,118,128,.14)` | `--seg-track` | 갑지/시스템/일위대가 탭 트랙 |
| `--q-seg-thumb` | `#FFFFFF` | `--seg-thumb` | 선택 탭 |
| `--q-seg-thumb-shadow` | `0 3px 8px rgba(0,0,0,.14),0 1px 2px rgba(0,0,0,.10)` | `--seg-thumb-shadow` | 선택 탭 |
| `--q-r-seg` | `11px` | `.seg` | 탭 트랙 모서리 |

LED의 `--accent:#007AFF`는 **계승하지 않는다**. 앱 강조색은 RTCOM `#3978ee` 하나로 통일하고,
`#007AFF`는 `auto-addable` 판정 배지에서만 쓴다.

## 3. 컴포넌트 대응

| 견적 앱 | 계승 출처 | 비고 |
|---|---|---|
| 상단 헤더 + 브랜드 마크 + 포털 복귀 링크 | RTCOM `.rt-top` / `.rt-brand-lockup` / `.rt-portal-link` | 링크 텍스트만 `포털로 돌아가기` |
| 툴바(샘플/새 견적/열기/저장/Excel) | RTCOM `.rt-workspace` + `.rt-tools .rt-button` | pill 버튼 |
| 좌: 제품 검색 패널 / 우: 견적 표 | RTCOM `.rt-config-stage` 2단 그리드 | `minmax(0,1fr) 300px` → 견적은 `320px minmax(0,1fr)` (검색이 왼쪽) |
| 갑지/시스템/일위대가/합계 탭 | LED `.seg` segmented control | RTCOM `.rt-step`은 단계 진행용이라 부적합 |
| 견적 표 | **원본 Excel 열 구조** (§4.2) | RTCOM `table`의 border-bottom/패딩만 계승, 열은 Excel 기준 |
| 부자재 검토 카드 | RTCOM `.rt-validation` + LED `--vp-*` 상태색 | |
| 안내/경고 배너 | RTCOM `.rt-notice` / `.rt-power-notice` | |
| 인쇄 | RTCOM `@media print{@page{size:A4}}` 패턴 | 견적은 landscape |

## 4. 계승하지 않는 것 (설계서 §2.2, §8.8)

- RTCOM의 localStorage 자동 저장(`#save-status`, "이 브라우저에 자동 저장됩니다") — 견적 문서는 자동 저장하지 않는다.
- LED의 `prices.example.js` 등 가격표 JS 실행 경로.
- 구성 공유/사례 저장 경로.
- RTCOM `src/vendor`, `workers/` 실행 코드.

스타일만 계승하고 데이터 경로는 복제하지 않는다.

## 5. 검수 방법

1440px / 1024px / 390px 각각에서 RTCOM 공개 화면과 나란히 놓고 비교한다.
비교 대상: 헤더 높이·패널 모서리·그림자·버튼 높이·글꼴·여백.
