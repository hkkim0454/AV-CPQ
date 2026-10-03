/**
 * 배포 데이터 감사 게이트 (계획 Task 5, 설계서 §8.1, 결정 문서 D1).
 *
 * `tools/audit_xlsx.py`가 XLSX ZIP 전수 감사를 하듯, 이쪽은 JSON 산출물을 검사한다.
 * 같은 종류의 누출이 JSON에도 샐 수 있기 때문이다 — 그 스크립트가 원본에서
 * 실제로 잡아낸 것이 로컬 PC 경로, 과거 고객사 통합문서 파일명, 매입처 이름이었다.
 *
 * 검사는 **빌드 전에** 돈다. 하나라도 걸리면 파일을 쓰지 않는다.
 */

export interface AuditPattern {
  label: string;
  pattern: RegExp;
}

export const AUDIT_PATTERNS: AuditPattern[] = [
  // 설계서 §8.1 — 매입 원가·매입처는 어떤 산출물에도 들어가지 않는다.
  //
  // `매입`만으로 거르면 안 된다. 건축에서 `매입`은 **매립형 설치**를 뜻하고,
  // 품셈 코드에 `7-11-5_Speaker-고정_30W 이하_해설②매입⑩천장설치`처럼 정상적으로 나온다.
  // 구매를 뜻하는 복합어만 잡는다.
  { label: '매입처·매입단가', pattern: /매입\s*(처|단가|가격|원가)|구매처|구입처|원가표/ },
  { label: '마진·이익 표현', pattern: /마진율?|이익률|가산율/ },
  // 로컬 경로와 다른 통합문서 파일명 — 원본이 실제로 끌고 다니던 것들.
  { label: '윈도우 로컬 경로', pattern: /[A-Za-z]:[\\/](?:Users|work|temp|windows)/i },
  { label: '다른 통합문서 파일명', pattern: /[\w가-힣()\[\]. _-]+\.xls[xmb]?(?![a-z])/i },
  { label: 'UNC 경로', pattern: /\\\\[\w.-]+\\/ },
  // 설계서 §8.4 — 외부 전송 경로의 흔적.
  { label: 'URL', pattern: /https?:\/\// },
  { label: '이메일 주소', pattern: /[\w.+-]+@[\w-]+\.[\w.]+/ },
];

/**
 * 가격 맵 키(SKU)에는 `-`와 숫자만 있어야 한다.
 * 품명이 SKU로 새어 들어가면 `prices.json`만 빼도 제품명이 남지 않는다는 전제가 깨진다.
 */
const SKU_PATTERN = /^[A-Z0-9]{3}-\d{4}$/;

export function auditApprovedPayload(files: Record<string, unknown>): string[] {
  const findings: string[] = [];

  for (const [name, payload] of Object.entries(files)) {
    const text = JSON.stringify(payload);
    for (const { label, pattern } of AUDIT_PATTERNS) {
      const match = pattern.exec(text);
      if (match === null) continue;
      const start = Math.max(0, match.index - 50);
      findings.push(`${name}: ${label} — …${text.slice(start, match.index + 60)}…`);
    }
  }

  // prices.json은 SKU와 숫자만 담는다 (결정 D3 — 분리가 의미를 가지려면).
  const prices = files['prices.json'] as { prices?: Record<string, unknown> } | undefined;
  if (prices?.prices !== undefined) {
    for (const sku of Object.keys(prices.prices)) {
      if (!SKU_PATTERN.test(sku)) {
        findings.push(`prices.json: SKU 형식이 아닌 키 '${sku}' — 제품명이 새고 있다`);
      }
    }
  }

  // products.json에 가격이 섞이지 않았는지 (스키마가 이미 막지만, 이중으로 본다).
  const products = files['products.json'] as
    | { products?: Array<Record<string, unknown>> }
    | undefined;
  for (const product of products?.products ?? []) {
    if ('sellingUnitPrice' in product || 'price' in product) {
      findings.push(
        `products.json: '${String(product['sku'])}'에 가격 필드가 있다 — 결정 D3 위반`,
      );
    }
  }

  return findings;
}
