# Cloudflare 이전 절차서

**작성:** 2026-10-05 · 계획 세션
**목적:** GitHub Pages(공개)에서 **Cloudflare Pages + Access**(6명만 접근)로 옮긴다.
**관련 결정:** D6(배포) · D3(판매단가 비공개)

---

## 0. 지금 무엇이 문제인가

```
저장소 hkkim0454/AV-CPQ      PUBLIC
  main 브랜치
    data/approved/prices.json     판매단가 1,444건   ← 누구나 내려받을 수 있다
    data/approved/products.json   제품·규격 1,468건
  gh-pages 브랜치 (웹사이트)
    같은 파일들                                      ← 웹 주소로도 접근 가능
```

2026-10-03 커밋 `71f321b` 부터 공개돼 있다. 사이트도 주소만 알면 누구나 들어온다.

---

## 1. 옮기고 나면 이렇게 된다

| | 지금 | 옮긴 뒤 |
|---|---|---|
| 사이트 호스팅 | GitHub Pages | **Cloudflare Pages** |
| 저장소 공개 여부 | PUBLIC | **PRIVATE 가능** |
| 사이트 접근 | 누구나 | **허용한 이메일만** |
| 로그인 방법 | 없음 | **회사 메일로 인증번호 받기** |
| 비용 | 무료 | **무료** (Access 는 50명까지 무료) |
| 배포 방법 | 수동 | **`main` 에 올리면 자동 배포** |

---

## 2. 준비물

| | 필요한 것 | 비고 |
|---|---|---|
| 1 | **Cloudflare 계정** | 무료. 이메일만 있으면 만든다 |
| 2 | **GitHub 로그인** | 이미 있다 (`hkkim0454`) |
| 3 | **쓸 사람 6명의 이메일** | 회사 메일 주소. 이 목록에 없으면 못 들어온다 |
| 4 | 신용카드 | **필요 없다.** 무료 구간만 쓴다 |

---

## 3. 빌드 설정값 (실측)

Cloudflare 화면에서 이 값들을 그대로 넣는다.

```
Framework preset      None  (또는 Vite)
Build command         npm run build
Build output directory  dist
Root directory        (비워 둔다)
Node version          20 이상
```

근거: `package.json` 의 `"build": "tsc -b && vite build"` · `vite.config.ts` 의 `base: './'`.
`outDir` 설정이 없으므로 Vite 기본값인 `dist` 다.

---

## 4. 사용자가 직접 해야 하는 일

AI 가 대신할 수 없는 것들이다. 계정 만들기·로그인·권한 주기는 사람이 해야 한다.

### 4-1. Cloudflare 계정 만들기

1. `dash.cloudflare.com/sign-up` 에 들어간다.
2. 이메일과 비밀번호를 넣고 가입한다.
3. 메일로 온 확인 링크를 누른다.

> **도메인을 사지 않아도 된다.** Cloudflare 가 `○○○.pages.dev` 주소를 공짜로 준다.

### 4-2. Pages 에 저장소 연결하기

1. 왼쪽 메뉴에서 **Workers & Pages** 를 누른다.
2. **Create** → **Pages** → **Connect to Git** 을 누른다.
3. **GitHub** 를 고르고, GitHub 로그인 창이 뜨면 로그인한다.
4. Cloudflare 가 저장소를 읽을 수 있게 **권한을 준다.**
   - `Only select repositories` 를 고르고 **`AV-CPQ` 만** 선택하는 것을 권한다.
   - 전체 저장소 권한을 줄 필요가 없다.
5. 저장소 목록에서 `AV-CPQ` 를 고르고 **Begin setup** 을 누른다.

### 4-3. 빌드 설정 넣기

위 §3 의 값을 그대로 넣는다.

```
Production branch       main
Build command           npm run build
Build output directory  dist
```

> ⚠ **지금 사이트는 `gh-pages` 브랜치에 있지만, Cloudflare 는 `main` 을 쓴다.**
> Cloudflare 가 직접 빌드하므로 `gh-pages` 는 더 필요 없어진다.

**Save and Deploy** 를 누르면 첫 배포가 돈다. 3~5분 걸린다.

### 4-4. 잘 되는지 확인

배포가 끝나면 `https://av-cpq-○○○.pages.dev` 같은 주소가 나온다.
들어가서 **화면이 뜨고 자료가 불러와지는지** 확인한다.

> 여기까지는 **아직 아무나 들어올 수 있다.** 다음 단계에서 막는다.

### 4-5. Access 로 잠그기 — **이 단계가 핵심이다**

1. 왼쪽 메뉴 맨 아래 **Zero Trust** 를 누른다.
2. 처음이면 팀 이름(team domain)을 정하라고 한다. 아무 이름이나 정한다
   (예: `seoulav`). 나중에 `seoulav.cloudflareaccess.com` 이 된다.
3. 요금제를 고르라고 하면 **Free** 를 고른다. **50명까지 무료다.**
4. **Access** → **Applications** → **Add an application** → **Self-hosted** 를 고른다.
5. 아래처럼 넣는다.

```
Application name     AV-CPQ
Session Duration     24 hours  (하루에 한 번 인증)
Subdomain            av-cpq-○○○        ← 4-4 에서 받은 주소의 앞부분
Domain               pages.dev
```

6. **Add policy** 에서 규칙을 만든다.

```
Policy name   사내 6명
Action        Allow
Include       Emails  →  쓸 사람 6명의 이메일을 한 줄씩 넣는다
```

> `Emails ending in @seoulav.co.kr` 처럼 **도메인 전체**로 줄 수도 있다.
> 다만 **회사 메일을 가진 사람 전부**가 들어오게 되므로, 6명만 쓸 거면
> **이메일을 하나씩 적는 쪽**이 안전하다.

7. 저장한다.

### 4-6. 막혔는지 확인한다 — **반드시 한다**

- [ ] **다른 브라우저**(또는 시크릿 창)에서 사이트 주소를 연다.
- [ ] **인증 화면이 뜨는지** 확인한다. 바로 들어가지면 **설정이 안 먹은 것이다.**
- [ ] 허용 목록에 **없는** 이메일로 시도해 본다. **막혀야 한다.**
- [ ] 허용 목록에 **있는** 이메일로 시도한다. 메일로 온 번호를 넣으면 들어가야 한다.

> ⛔ **이 확인을 건너뛰지 않는다.** "설정했으니 됐겠지"로 넘어가면 안 된다.

### 4-7. 저장소를 비공개로 바꾸기

**사이트가 잘 막히는 것을 확인한 뒤에** 한다.

1. GitHub 에서 `hkkim0454/AV-CPQ` 로 간다.
2. **Settings** → 맨 아래 **Danger Zone** → **Change repository visibility**
3. **Make private** 을 고른다.

> Cloudflare Pages 는 **비공개 저장소도 계속 배포한다.** 4-2 에서 권한을 줬기 때문이다.

### 4-8. GitHub Pages 끄기

옛 주소가 살아 있으면 막은 의미가 없다.

1. **Settings** → **Pages**
2. Source 를 **None** 으로 바꾼다.
3. `gh-pages` 브랜치를 지운다 (선택).

---

## 5. 내가(계획 세션) 하는 일

| | 내용 |
|---|---|
| 1 | 빌드가 Cloudflare 에서도 통과하는지 **미리 확인**한다 (`npm run build` 를 깨끗한 상태로) |
| 2 | 배포 뒤 **자료가 제대로 불러와지는지** 확인한다 |
| 3 | 옛 주소가 **정말 죽었는지** 확인한다 |
| 4 | 결정 기록(D6)과 `docs/stage-status.md` 를 갱신한다 |

---

## 6. ⚠ 주의할 점

### 되돌릴 수 없는 것

**이미 공개된 것은 비공개로 바꿔도 되돌릴 수 없다.** 판매단가가 이틀 넘게 공개돼
있었고, 검색 엔진이 수집했거나 누군가 내려받았을 수 있다.

→ **지금 막는 것과 계속 열어 두는 것은 전혀 다르다.** 그래도 "완전히 안전해졌다"고
  말할 수는 없다.

### 순서를 지킨다

```
①  Cloudflare 배포 성공 확인
②  Access 로 막고, 막혔는지 확인     ← 여기를 건너뛰면 안 된다
③  저장소 비공개 전환
④  GitHub Pages 끄기
```

**②를 확인하기 전에 ③·④를 하면**, 사이트가 안 막힌 채로 옛 주소만 죽는다.
오히려 나빠질 수 있다.

### 무료 구간

| | 한도 | 우리 |
|---|---|---|
| Pages 빌드 | 월 500회 | 충분하다 |
| Access 사용자 | 50명 | 6명 |
| 대역폭 | 무제한 | — |

**신용카드를 넣지 않는다.** 넣으면 한도를 넘었을 때 과금될 수 있다.

### 사내 메일이 Microsoft 365 라면

`@seoulav.co.kr` 메일로 **인증번호를 받는 방식**(One-time PIN)이 가장 간단하다.
Microsoft 계정으로 바로 로그인하는 방식(Azure AD 연동)도 되지만 **설정이 더 복잡**하다.
**처음에는 인증번호 방식으로 시작**하고, 불편하면 나중에 바꾼다.

---

## 7. 되돌리는 법

잘못되면 언제든 돌아올 수 있다.

1. GitHub **Settings → Pages** 에서 Source 를 다시 `gh-pages` 로 돌린다.
2. 저장소를 다시 공개로 바꾼다.
3. Cloudflare Pages 프로젝트를 지운다.

**작업한 코드는 하나도 사라지지 않는다.** 전부 Git 에 있다.
