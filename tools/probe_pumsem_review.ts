/** 하반기 품셈 대응을 사람이 검토하도록 공개 필드만 정리한다. */
import type { CatalogProduct } from '../src/data/catalog/load';
import { identityOf, type SkuMigrationEntry, type SkuMigrationTable } from '../src/data/catalog/skuMigration';

export interface ReviewCatalog {
  sourceSha256: string;
  products: readonly CatalogProduct[];
  prices: ReadonlyMap<string, string>;
}

type IdentityField = 'quoteName' | 'quoteSpec' | 'unit' | 'description' | 'group';

const FIELD_LABELS: Record<IdentityField, string> = {
  quoteName: '품명', quoteSpec: '규격', unit: '단위', description: '설명', group: '묶음 이름',
};
const FIELDS = Object.keys(FIELD_LABELS) as IdentityField[];

function differentFields(old: CatalogProduct, candidate: CatalogProduct): IdentityField[] {
  const a = identityOf(old);
  const b = identityOf(candidate);
  return FIELDS.filter((field) => a[field] !== b[field]);
}

/** 표시 순서만 정한다. 이 순서를 승인 추천이나 SKU 대응으로 사용하지 않는다. */
export function rankReviewCandidates(old: CatalogProduct, candidates: readonly CatalogProduct[]): CatalogProduct[] {
  return [...candidates].sort((a, b) => {
    const left = differentFields(old, a);
    const right = differentFields(old, b);
    return left.length - right.length ||
      Number(left.includes('quoteSpec')) - Number(right.includes('quoteSpec')) ||
      Number(left.includes('unit')) - Number(right.includes('unit')) ||
      a.sku.localeCompare(b.sku);
  });
}

export function classifyReviewReason(old: CatalogProduct, candidates: readonly CatalogProduct[]): string {
  if (candidates.length === 0) throw new Error('후보 없는 항목은 보류 사유 분류에 넣지 않는다');
  const signatures = candidates.map((candidate) => differentFields(old, candidate).join(','));
  if (candidates.length > 1 && signatures.every((s) => s === '')) return '신원이 같은 후보 여러 개';
  if (new Set(signatures).size > 1) return '후보마다 다른 항목이 다름';
  const fields = differentFields(old, candidates[0]!);
  if (fields.length === 1) return `${FIELD_LABELS[fields[0]!]}만 다름`;
  if (fields.length === 0) return '신원 문구가 같음';
  return `${fields.map((field) => FIELD_LABELS[field]).join('·')}이 다름`;
}

function comparableName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function bigrams(value: string): Set<string> {
  const compact = comparableName(value).replaceAll(' ', '');
  const result = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) result.add(compact.slice(i, i + 2));
  return result;
}

function nameSimilarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const pair of left) if (right.has(pair)) common++;
  return (2 * common) / (left.size + right.size);
}

function distinctiveSameSpec(old: CatalogProduct, candidate: CatalogProduct): boolean {
  const spec = old.quoteSpec.trim();
  return spec.length >= 5 && /\d/.test(spec) && spec === candidate.quoteSpec.trim();
}

/** 같은 품명 후보가 없을 때만 보여 주는 참고 목록이다. SKU 대응을 정하지 않는다. */
export function similarNameCandidates(old: CatalogProduct, candidates: readonly CatalogProduct[]): CatalogProduct[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: nameSimilarity(old.quoteName, candidate.quoteName),
      sameSpec: distinctiveSameSpec(old, candidate),
    }))
    .filter(({ candidate, score, sameSpec }) => candidate.quoteName !== old.quoteName && (sameSpec || score >= 0.55))
    .sort((a, b) => Number(b.sameSpec) - Number(a.sameSpec) || b.score - a.score || a.candidate.sku.localeCompare(b.candidate.sku))
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

function safe(text: string | undefined): string {
  return (text === undefined || text === '' ? '(없음)' : text)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;').replaceAll('`', '&#96;').replace(/\r?\n/g, '<br>');
}

function money(price: string | undefined): string {
  if (price === undefined) return '미등록';
  const [whole, fraction] = price.split('.');
  const formatted = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${formatted}${fraction === undefined ? '' : `.${fraction}`}원`;
}

function productCell(product: CatalogProduct, prices: ReadonlyMap<string, string>): string {
  return `\`${safe(product.sku)}\` · ${safe(product.quoteName)}<br>` +
    `규격: ${safe(product.quoteSpec)} · 단위: ${safe(product.unit)}<br>` +
    `묶음: ${safe(product.options['group'])} · 단가: ${money(prices.get(product.sku))}`;
}

function reasonSentence(old: CatalogProduct, candidates: readonly CatalogProduct[]): string {
  const category = classifyReviewReason(old, candidates);
  if (category === '신원이 같은 후보 여러 개') {
    return `신원 문구가 같은 후보 ${candidates.length}개가 있어 하나를 자동으로 고르지 않았습니다.`;
  }
  if (category === '후보마다 다른 항목이 다름') {
    return `후보 ${candidates.length}개에서 달라진 항목의 조합이 서로 다릅니다.`;
  }
  const fields = differentFields(old, candidates[0]!);
  if (candidates.length > 1) {
    return `후보 ${candidates.length}개가 모두 ${fields.map((field) => FIELD_LABELS[field]).join('·')}에서 옛 제품과 달라 하나를 자동으로 고르지 않았습니다.`;
  }
  if (fields.length === 1 && fields[0] === 'unit' && candidates.length === 1) {
    return `단위가 ${safe(old.unit)}와 ${safe(candidates[0]!.unit)}로 다릅니다.`;
  }
  if (fields.length === 1 && fields[0] === 'group' && candidates.length === 1) {
    return `묶음 이름만 ${safe(old.options['group'])}에서 ${safe(candidates[0]!.options['group'])}로 달라졌습니다.`;
  }
  return `${category}이므로 제품 신원을 자동으로 확정하지 않았습니다.`;
}

function statusAndGroups(
  entry: SkuMigrationEntry,
  nextProducts: ReadonlyMap<string, CatalogProduct>,
): string {
  if (entry.status === 'unmappable') return '같은 품명의 후보가 없어 이동한 묶음을 추적할 수 없습니다.';
  const skus = entry.status === 'mapped' ? [entry.targetSku!] : entry.candidates ?? [];
  const groups = [...new Set(skus.map((sku) => nextProducts.get(sku)?.options['group']).filter((g): g is string => g !== undefined))];
  if (groups.length === 0) return '후보 묶음을 찾지 못했습니다.';
  const label = entry.status === 'mapped' ? '자동 대응' : '미결정 후보';
  return `${label}: ${groups.map(safe).join(', ')}`;
}

function headingRow(product: CatalogProduct): string {
  return `\`${safe(product.sku)}\` · ${safe(product.quoteName)} · ${safe(product.quoteSpec)} · ${safe(product.unit)}`;
}

export function renderPumsemReview(
  old: ReviewCatalog,
  next: ReviewCatalog,
  migration: SkuMigrationTable,
  oldMappedSkus: ReadonlySet<string>,
  newMappedSkus: ReadonlySet<string>,
): string {
  const oldBySku = new Map(old.products.map((p) => [p.sku, p]));
  const nextBySku = new Map(next.products.map((p) => [p.sku, p]));
  if (migration.sourceCatalogFingerprint !== old.sourceSha256 ||
      migration.targetCatalogFingerprint !== next.sourceSha256) {
    throw new Error('SKU 대응표와 비교 자료의 원본 지문이 다르다');
  }
  for (const entry of migration.entries) {
    if (!oldBySku.has(entry.sourceSku)) throw new Error(`옛 SKU ${entry.sourceSku}가 현행 자료에 없다`);
    const targetSkus = entry.status === 'mapped' ? [entry.targetSku] : entry.candidates ?? [];
    for (const sku of targetSkus) {
      if (sku !== undefined && !nextBySku.has(sku)) throw new Error(`후보 SKU ${sku}가 준비 자료에 없다`);
    }
  }
  const entriesBySku = new Map(migration.entries.map((entry) => [entry.sourceSku, entry]));
  const undecided = migration.entries.filter((entry) => entry.status === 'undecided');
  const unmappable = migration.entries.filter((entry) => entry.status === 'unmappable');

  const byReason = new Map<string, SkuMigrationEntry[]>();
  for (const entry of undecided) {
    const product = oldBySku.get(entry.sourceSku)!;
    const candidates = (entry.candidates ?? []).map((sku) => nextBySku.get(sku)!).filter(Boolean);
    const reason = classifyReviewReason(product, candidates);
    const group = byReason.get(reason) ?? [];
    group.push(entry);
    byReason.set(reason, group);
  }
  const reasons = [...byReason].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko'));

  const oldGroups = new Map<string, CatalogProduct[]>();
  for (const product of old.products) {
    const group = product.options['group'] || product.options['category'] || '(무명)';
    const bucket = oldGroups.get(group) ?? [];
    bucket.push(product);
    oldGroups.set(group, bucket);
  }
  const nextGroupMapped = new Map<string, number>();
  for (const product of next.products) {
    const group = product.options['group'] || product.options['category'] || '(무명)';
    if (newMappedSkus.has(product.sku)) nextGroupMapped.set(group, (nextGroupMapped.get(group) ?? 0) + 1);
  }
  const vanishedGroups = [...oldGroups]
    .filter(([group, products]) =>
      products.some((p) => oldMappedSkus.has(p.sku)) && (nextGroupMapped.get(group) ?? 0) === 0,
    )
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko'));

  const targetSources = new Map<string, string[]>();
  for (const entry of migration.entries) {
    if (entry.status !== 'mapped' || !entry.targetSku) continue;
    const sources = targetSources.get(entry.targetSku) ?? [];
    sources.push(entry.sourceSku);
    targetSources.set(entry.targetSku, sources);
  }
  const cableMerges = [...targetSources]
    .filter(([sku, sources]) => sku.startsWith('CBL-') && sources.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const lines: string[] = [
    '# 2026년 하반기 품셈: 사람이 고를 SKU 대응 검토 목록', '',
    '이 문서는 현행 `data/approved/`와 하반기 준비 자료 `.local/staging/approved/`에서 **제품·판매단가만 읽어** 작성했습니다. 후보는 자동 결정이 아닙니다. 동일한 제품인지, 하반기 품목으로 바꿀지, 대응할 제품이 없는지는 검토자가 판단해 주십시오. 이 문서를 작성해도 배포 자료나 SKU 대응표는 바뀌지 않습니다.', '',
    `비교 기준 원본 지문: 현행 \`${old.sourceSha256}\`, 준비 자료 \`${next.sourceSha256}\`. 품목 번호는 원본 행이 밀리면 다른 제품을 가리킬 수 있으므로 번호만으로 고르지 마십시오.`, '',
    '## 먼저 볼 숫자', '',
    '| 검토 대상 | 건수 | 확인할 곳 |', '|---|---:|---|',
    `| 후보가 있어 사람이 고를 옛 제품 | ${undecided.length} | [사유별 목록](#candidate-list) |`,
    `| 같은 품명의 후보가 없는 옛 제품 | ${unmappable.length} | [이름 유사 참고 목록](#no-candidate-list) |`,
    `| 기존 묶음 이름의 연결이 0건이 된 묶음 | ${vanishedGroups.length} | [묶음별 이동 후보](#vanished-groups) |`,
    `| 옛 케이블 여러 개가 한 새 번호로 이어진 경우 | ${cableMerges.length}묶음, 옛 제품 ${cableMerges.reduce((n, [, sources]) => n + sources.length, 0)}개 | [케이블 합침](#cable-merges) |`, '',
    '검토 방법: 후보를 확인한 뒤 각 행의 **선택할 새 SKU** 칸에 해당 번호를 적거나 `대응 없음`이라고 적으십시오. 빈칸은 아직 판단하지 않았다는 뜻입니다. 이름이 비슷하다는 참고 정보만으로 제품을 확정하지 마십시오.', '',
    '### 자동 확정이 보류된 이유별 건수', '',
    '| 보류 이유 | 옛 제품 수 | 상세 |', '|---|---:|---|',
  ];
  reasons.forEach(([reason, entries], index) => {
    lines.push(`| ${safe(reason)} | ${entries.length} | [열기](#reason-${index + 1}) |`);
  });
  lines.push('', '<a id="candidate-list"></a>', '## 1. 후보가 있는 제품', '',
    '각 후보의 마지막 줄에는 옛 제품과 다른 신원 항목을 적었습니다. 읽기 쉽게 신원 차이가 적은 후보를 먼저 표시했지만, 순서는 **추천이나 확정이 아닙니다**. 설명 내용은 이 검토 문서에 옮기지 않고 차이 여부만 표시했습니다.', '');
  reasons.forEach(([reason, entries], index) => {
    lines.push(`<a id="reason-${index + 1}"></a>`, `### ${index + 1}. ${safe(reason)}: ${entries.length}건`, '',
      '| 옛 제품 | 새 후보 각각 | 자동 보류 이유 | 선택할 새 SKU |', '|---|---|---|---|');
    for (const entry of entries) {
      const product = oldBySku.get(entry.sourceSku)!;
      const candidates = rankReviewCandidates(product, (entry.candidates ?? []).map((sku) => nextBySku.get(sku)!).filter(Boolean));
      const candidateCell = candidates.map((candidate) =>
        `${productCell(candidate, next.prices)}<br>차이: ${safe(differentFields(product, candidate).map((f) => FIELD_LABELS[f]).join('·') || '신원 문구 동일')}`,
      ).join('<br><br>');
      lines.push(`| ${productCell(product, old.prices)} | ${candidateCell} | ${reasonSentence(product, candidates)} | ______ |`);
    }
    lines.push('');
  });

  lines.push('<a id="no-candidate-list"></a>', '## 2. 같은 품명의 후보가 없는 제품', '',
    '오른쪽은 **이름이 비슷하거나 특징적인 규격이 정확히 같은 참고 제품**이며 자동 대응 후보가 아닙니다. 참고 제품을 찾지 못했어도 실제 단종이라고 판정한 것은 아닙니다.', '',
    '| 옛 제품 | 새 자료의 이름·규격 참고 제품(최대 3개) | 판단 |', '|---|---|---|');
  for (const entry of unmappable) {
    const product = oldBySku.get(entry.sourceSku)!;
    const similar = similarNameCandidates(product, next.products);
    const references = similar.length === 0
      ? '이름·규격으로 참고할 제품을 찾지 못했습니다.'
      : similar.map((candidate) =>
        `${productCell(candidate, next.prices)}<br>참고 이유: ${distinctiveSameSpec(product, candidate) ? '규격 동일' : '이름 유사'}`,
      ).join('<br><br>');
    lines.push(`| ${productCell(product, old.prices)} | ${references} | ______ |`);
  }
  lines.push('', '<a id="vanished-groups"></a>', '## 3. 기존 이름의 품셈 연결이 0건이 된 묶음', '',
    '아래는 **기존 묶음 이름**으로 센 결과입니다. 새 묶음이 후보로 보인다고 해서 같은 제품으로 확정한 것은 아닙니다. 묶음에 있던 모든 옛 제품을 나열했습니다.', '',
    '| 기존 묶음 | 옛 제품 수 | 옛 품셈 연결 수 | 상세 |', '|---|---:|---:|---|');
  vanishedGroups.forEach(([group, products], index) => {
    lines.push(`| ${safe(group)} | ${products.length} | ${products.filter((p) => oldMappedSkus.has(p.sku)).length} | [열기](#group-${index + 1}) |`);
  });
  lines.push('');
  vanishedGroups.forEach(([group, products], index) => {
    lines.push(`<a id="group-${index + 1}"></a>`, `### ${index + 1}. ${safe(group)}: 옛 제품 ${products.length}개`, '',
      '| 옛 제품 | 새 묶음으로 추적한 결과 |', '|---|---|');
    for (const product of products) {
      const entry = entriesBySku.get(product.sku);
      lines.push(`| ${headingRow(product)} | ${entry ? statusAndGroups(entry, nextBySku) : '대응 기록이 없습니다.'} |`);
    }
    lines.push('');
  });

  lines.push('<a id="cable-merges"></a>', '## 4. 케이블의 여러 대 일 대응', '',
    '아래의 자동 대응은 문구상 신원이 같다는 뜻입니다. 옛 번호별 가격이 달라 하나의 새 제품으로 합쳐도 되는지는 아직 사람이 확인해야 합니다.', '',
    '| 옛 케이블 제품 | 연결된 새 케이블 제품 | 판단 |', '|---|---|---|');
  for (const [targetSku, sources] of cableMerges) {
    const target = nextBySku.get(targetSku)!;
    for (const sourceSku of sources) {
      const source = oldBySku.get(sourceSku)!;
      lines.push(`| ${productCell(source, old.prices)} | ${productCell(target, next.prices)} | ______ |`);
    }
  }
  lines.push('', '이 목록의 빈 판단 칸은 의도적으로 남겼습니다. 이 문서만으로 품셈 교체를 진행하지 않습니다.', '');
  return lines.join('\n');
}
