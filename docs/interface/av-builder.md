# av-builder ↔ AV-CPQ 연동 규격

작성: 2026-10-03
대상: av-builder 개발 담당 / AV-CPQ 개발 담당
근거: `av-diagram-1791037942542.json`(실물 export) 실측 + DSR·평택 견적서 대조

---

## 0. 역할 경계

```
   PowerPoint 구성도 ─┐
                      ├→ av-builder JSON ─→ AV-CPQ ─→ 견적서 Excel
   av-builder 직접 ───┘
          ▲                    ▲                ▲
    av-builder 담당      ← 이 문서 →        AV-CPQ 담당
```

| 범위 | 담당 |
|---|---|
| PPT → av-builder 변환 | **av-builder** |
| 구성도 작성·장비 DB·포트·옵션 카드 | **av-builder** |
| JSON export | **av-builder** (이 문서가 규격) |
| JSON 읽기 → 견적 행 생성 | AV-CPQ |
| 판매단가·품셈·노무비·간접비·절사·NEGO·갑지 | AV-CPQ |
| Excel 생성 | AV-CPQ |

**av-builder 는 가격을 다루지 않는다.** 현재 export 에 `price`/`sku` 가 0건인 것이 올바른 상태다.

---

## 1. 현재 export 로 이미 되는 것

`version: "1.1"`, 최상위 키 `nodes` / `edges` / `lineTypes` / `equipmentDB`.

### 1.1 장비 — 잘 됨

```json
{"id":"node_1791037770736","type":"equipment","position":{"x":289,"y":397},
 "data":{"id":"eq-xlsx-393","name":"PTZ 카메라","model":"SRG-A40",
         "manufacturer":"Sony","category":"video","description":"천장브라켓 기본",
         "inputs":[],"outputs":[{"id":"xlsx-393-out-1","type":"video","label":"Out 1","direction":"out"}],
         "bidirectional":[]}}
```

**카탈로그 자동 매칭률: `model` 기준 554/674 = 82%** (AV-CPQ 카탈로그 1,468개 대상).

### 1.2 연결 — 잘 됨

```json
{"source":"node_...","sourceHandle":"xlsx-393-out-1",
 "target":"node_...","targetHandle":"opt-eqopt-xlsx-456-0-xlsxopt-456-in-1",
 "data":{"lineTypeId":"video"},"style":{"stroke":"#ef4444"}}
```

### 1.3 선 종류 — 잘 됨

| id | name | color |
|---|---|---|
| `sdi` | SDI | `#374151` |
| `video` | HDMI | `#ef4444` |
| `network` | LAN | `#22c55e` |
| `audio` | A.AUDIO | `#a855f7` |
| `usb` | USB | `#3b82f6` |
| `control` | Control | `#f59e0b` |
| (사용자 추가) | DP | `#ff8585` |

---

## 2. ★ 반드시 고쳐야 하는 것 — 옵션 카드 정의 누락

### 증상

매트릭스 노드에 수량은 있는데 **정체가 없다.**

```json
"selectedOptionQuantities": { "eqopt-xlsx-454": 4, "eqopt-xlsx-456": 4 },
"optionPortIds": ["opt-eqopt-xlsx-456-0-xlsxopt-456-in-1", …]
```

`eqopt-xlsx-454` 가 어떤 제품인지 **export 어디에도 없다.** `equipmentDB` 674건을 뒤져도 없다.
본체 `eq-xlsx-451`(XDM-12)은 `inputs: []`, `outputs: []` 인 빈 깡통이다 — 카드를 꽂아야 포트가 생긴다.

### 왜 치명적인가

DSR 견적서에 실제로 나간 줄:

```
- HDMI 4채널 input card (no-Scale)   XDM-HI100    1EA
- HDMI 4채널 input card              XDM-HIS100   2EA
- HDMI 4채널 output card             XDM-HOS100   3EA
```

카드 1장이 **74만~190만원**이다. DSR 견적서 147개 품목 중 **옵션 카드·슬롯이 15줄**이다.
현 상태로는 "뭔가 8장 꽂혔다"까지만 알고 **값을 매길 수 없다.**

### 필요한 것

최상위에 `options` 배열을 추가한다. 또는 `equipmentDB` 에 옵션 레코드를 포함시킨다.

```json
"options": [
  {"id":"eqopt-xlsx-454","name":"HDMI 4채널 output card","model":"XDM-HOS100",
   "manufacturer":"RTCOM","parentModel":"XDM-12"},
  {"id":"eqopt-xlsx-456","name":"HDMI 4채널 input card","model":"XDM-HIS100",
   "manufacturer":"RTCOM","parentModel":"XDM-12"}
]
```

최소 요구는 **`id` 와 `model`** 둘이다. 나머지는 있으면 좋다.
`selectedOptionQuantities` 의 키가 이 `id` 와 맞으면 AV-CPQ 가 수량까지 그대로 가져간다.

**이 하나로 15줄이 살아난다. 투입 대비 회수가 가장 큰 수정이다.**

---

## 3. 있으면 좋은 것

### 3.1 케이블 BOM (기능은 이미 있음 — 채워서 내보내기만)

실물 export 에서 `edges[].data.bomRows` 가 전부 비어 있었다. 코드에는 구조가 있다.

```json
"data":{"lineTypeId":"video",
        "bomRows":[{"cableType":"ready-made","productName":"Locking HDMI Cable 3m",
                    "length":"3","quantity":"2"}]}
```

`cableType` 두 값의 의미가 AV-CPQ 와 일치한다 — 그대로 유지할 것.

| 값 | 뜻 | AV-CPQ 처리 |
|---|---|---|
| `ready-made` | 완제품 | **개수(EA)** 로 집계. 길이는 제품 규격 |
| `manufactured` | 제작·벌크 | **길이(m) 합산** 후 10M 단위 올림 |

설계서 §7.4 의 *"완제품 HDMI 5m 두 구간을 10EA로 계산하지 않는다"* 가 이 구분이다.

실제 견적서에서 확인한 완제품 길이 계단: **1 · 2 · 3 · 5 · 7 · 10 · 15 · 20m**
벌크는 **예외 없이 10M 단위**.

### 3.2 SKU 칸 (선택)

모델명 매칭이 82%라 급하지 않다. 나머지 120건(Televic 회의시스템, ATEN KVM,
규격만 있는 스크린, PC 등)은 AV-CPQ 쪽에서 수동 대응한다.
장비 등록 폼에 `sku` 한 줄을 넣으면 100%가 되지만, **없어도 연동은 성립한다.**

### 3.3 시스템 구분

견적서는 시스템 시트로 나뉜다(DSR: `대회의실_LED` / `대회의실_AV` / `접견실` / `집무실`).
노드에 `systemName` 같은 것이 있으면 AV-CPQ 가 시트를 자동으로 나눈다.
없으면 AV-CPQ 가 사용자에게 묻는다.

---

## 4. AV-CPQ 가 JSON 밖에서 채우는 것

구성도로 나오지 않는 것들이다. av-builder 가 신경 쓸 필요 없다.

| 항목 | DSR 견적서 기준 | 출처 |
|---|---:|---|
| 브라켓·함체 등 설치 부자재 | 12줄 | 연동 항목 표 (사용자 작성) |
| 공사·용역·잡비 (배관·배선·조정·교육) | 13줄 | 샘플 견적서 / 수동 |
| 랙·전원 | 4줄 | 수동 |
| 커넥터 | — | **규칙**: 구간당 3개(사용 2 + 예비 1), 10EA 묶음 올림 |
| 배관 | — | **규칙**: 총 거리 × 60% (※ "총 거리" 정의 확인 중) |
| 케이블 길이 보정 | — | **규칙**: (직각 경로 + 상하 높이) × 1.3 |

### 커버리지 실측 (DSR 견적서 147개 품목, 간접비 제외)

| 분류 | 줄 | 출처 |
|---|---:|---|
| 주 장비 | 63 | 구성도 |
| 케이블·배선 | 40 | 구성도 (BOM 채우면) |
| 옵션 카드·슬롯 | 15 | 구성도 (**§2 고치면**) |
| 브라켓·함체 | 12 | 연동 항목 표 |
| 공사·용역·잡비 | 13 | 수동 |
| 랙·전원 | 4 | 수동 |
| **구성도에서 나옴** | **118** | **80%** |

---

## 5. 호환성 약속

- AV-CPQ 는 `version` 필드로 분기한다. 현재 `"1.1"` 을 읽는다.
- **모르는 필드는 무시한다.** av-builder 가 필드를 추가해도 AV-CPQ 는 깨지지 않는다.
- **필드를 지우거나 뜻을 바꿀 때는 `version` 을 올린다.**
- `lineTypes` 는 사용자가 추가할 수 있으므로 AV-CPQ 는 **id 목록을 하드코딩하지 않는다.**
  색이 아니라 `id` 로 판단하고, 모르는 `id` 는 "신호 미지정"으로 두고 경고한다.

---

## 6. 우선순위

| | 항목 | 담당 | 효과 |
|---|---|---|---|
| 1 | **옵션 카드 정의 export** (§2) | av-builder | 견적서 15줄 |
| 2 | **JSON 불러오기 구현** | AV-CPQ | 118줄이 들어옴 |
| 3 | 케이블 BOM 채워서 내보내기 (§3.1) | 사용자 | 40줄 정확도 |
| 4 | PPT → av-builder 변환 | av-builder | 기존 구성도 활용 |
| 5 | SKU 칸 (§3.2) | av-builder | 82% → 100% |

1·2 번만으로 동작한다. 3~5 는 정확도와 편의를 올린다.
