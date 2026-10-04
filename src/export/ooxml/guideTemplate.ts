/**
 * 가이드 템플릿 읽기 (계획 2026-10-04 Task 2).
 *
 * ## 구조는 어디서 오는가
 *
 * 구조 **발견**은 `tools/build_guide_templates.py` 가 원본에서 하고, 그 결과가
 * `templates/sanitized/guide-manifest.json` 이다. 여기서 다시 발견하지 않는다 —
 * 같은 일을 두 언어로 적으면 한쪽만 고쳐져 조용히 갈린다.
 *
 * 대신 **manifest 가 말한 자리를 실제 템플릿에서 확인한다.** 머리글 이름,
 * 행 이름표, 직종, 노임, 간접비 항목 이름을 대조해서 하나라도 어긋나면 던진다.
 * 템플릿만 다시 만들고 manifest 를 안 고치면 여기서 걸린다.
 *
 * ## 왜 해시로 대조하지 않는가
 *
 * 브라우저의 SHA-256 은 비동기(`crypto.subtle`)다. 이 함수는 동기라 해시를
 * 계산할 수 없다. 해시 대조는 빌드 시점(`build:guides`)의 일이고, 실행 시점에는
 * **내용을 직접 본다.** 어차피 해시가 맞아도 구조가 맞는지는 별개다.
 */
import { strFromU8, unzipSync } from 'fflate';

import type { IndirectBasis, IndirectCostRule } from '../../domain/quote/types';
import type { Wage, WageTable, WageUnit } from '../../domain/labor/types';
import { findChild, findChildren, parseXml } from './xml';
import { fnv1a64 } from '../../domain/quote/fingerprint';

export type GuideId = 'won' | 'pumsem' | 'ds' | 'ds-won';
export type IndirectProfileId = 'ds' | 'general';

export const GUIDE_IDS: readonly GuideId[] = ['won', 'pumsem', 'ds', 'ds-won'];

export interface GuideRowRoles {
  firstItem: number;
  lastItem: number;
  /** 배관 기타자재·잡자재비. 품목 행이 아니다 (D19). */
  derived: readonly number[];
  directSubtotal: number;
  indirectFirst: number;
  indirectLast: number;
  indirectSubtotal: number;
  grandTotal: number;
}

export interface GuideTemplate {
  id: GuideId;
  profile: IndirectProfileId;
  /** 원가 열(G·H)과 이윤 열(N)이 있는가. 0단계 전용이다. */
  hasCost: boolean;
  /** 정리된 원본 ZIP. **출력마다 복사한다. 변이 금지.** */
  bytes: Uint8Array;
  sheets: { cover: string; detail: string };
  printArea: { cover: string; detail: string };
  detailScale: number;
  /**
   * 갑지 절사 자릿수. 가이드는 `-3`(천원미만절사), 평택 원본은 `-4`(만원)였다.
   *
   * **양식마다 다르므로 읽는다.** 코드에 박으면 한 양식에서 조용히 틀린다.
   */
  coverRoundingDigits: number;
  coverRoundingLabel: string;
  freezePane: string;
  printTitles: string;
  /** 역할 이름 → 열 번호(1부터). `quantity`, `material.unit`, `supplier` 등. */
  columns: ReadonlyMap<string, number>;
  rows: GuideRowRoles;
  /** 인쇄 영역의 마지막 열 번호. 품셈·메모는 이 밖에 있어야 한다. */
  printLastColumn: number;
  trades: readonly string[];
  wages: WageTable;
  /** 기간+직종+단위+금액으로 만든 내용 해시. 파일이 달라도 내용이 같으면 같다. */
  wageFingerprint: string;
  indirectRules: readonly IndirectCostRule[];
}

export type GuideTemplateSet = Readonly<Record<GuideId, GuideTemplate>>;

/**
 * 가이드 네 종의 **내용** 지문(계획 Task 4, 독립 검토 지적).
 *
 * 저장된 작업 파일의 `versions.template`과 대조하는 값이다. 날짜 문자열
 * 상수(예전 `sanitized-2026-10-03`)는 실제 가이드 xlsx 4종이나 절사
 * 자릿수가 바뀌어도 사람이 상수를 직접 올리지 않으면 감지하지 못했다 —
 * 그래서 `wageContentFingerprint`와 같은 방식으로 **내용에서** 지문을
 * 만든다. 시트 이름·인쇄 영역·절사 자릿수·열 배치·행 역할이 하나라도
 * 바뀌면 지문이 바뀐다. `bytes`(원본 ZIP 전체)는 넣지 않는다 — 공백 한
 * 칸만 바뀌어도 계산과 무관하게 지문이 흔들린다.
 */
export function guideTemplateFingerprint(guides: GuideTemplateSet): string {
  const canonical = GUIDE_IDS.map((id) => {
    const g = guides[id];
    const columns = [...g.columns.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([role, index]) => `${role}=${index}`)
      .join(',');
    return [
      g.id,
      g.profile,
      g.hasCost,
      g.sheets.cover,
      g.sheets.detail,
      g.printArea.cover,
      g.printArea.detail,
      g.detailScale,
      g.coverRoundingDigits,
      g.coverRoundingLabel,
      g.freezePane,
      g.printTitles,
      g.printLastColumn,
      columns,
      JSON.stringify(g.rows),
    ].join('|');
  }).join(String.fromCharCode(10));
  return fnv1a64(canonical);
}

export class GuideTemplateError extends Error {
  constructor(
    message: string,
    readonly guideId: string,
  ) {
    super(`가이드 '${guideId}': ${message}`);
    this.name = 'GuideTemplateError';
  }
}

// ---------------------------------------------------------------------------
// manifest 모양 — 이 파일만 읽는다
// ---------------------------------------------------------------------------

interface ManifestWage {
  periodLabel: string;
  unit: string;
  wages: Record<string, { amount: string; unit: string }>;
  contentHash: string;
}

interface ManifestIndirect {
  name: string;
  basisLabel: string;
  rate: string;
  applied: boolean;
  conditionText?: string;
}

interface ManifestGuide {
  profile: IndirectProfileId;
  hasCost: boolean;
  sheets: { cover: string; detail: string };
  printArea: { cover: string; detail: string };
  detailScale: number;
  coverRoundingDigits: number;
  coverRoundingLabel: string;
  freezePane: string;
  printTitles: string;
  columns: Record<string, string>;
  rows: GuideRowRoles;
  trades: string[];
  wage: ManifestWage;
  indirect: ManifestIndirect[];
}

export interface GuideManifest {
  schemaVersion: number;
  guides: Record<string, ManifestGuide>;
}

// ---------------------------------------------------------------------------

export function columnIndex(name: string): number {
  let out = 0;
  for (const ch of name) out = out * 26 + (ch.charCodeAt(0) - 64);
  return out;
}

export function columnName(index: number): string {
  let out = '';
  let rest = index;
  while (rest > 0) {
    const rem = (rest - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

/** 셀 주소 하나를 찾기 쉽게 만든 시트. */
interface SheetCells {
  text: Map<string, string>;
  number: Map<string, string>;
}

function readSheet(xml: string, shared: string[]): SheetCells {
  const text = new Map<string, string>();
  const number = new Map<string, string>();
  const root = parseXml(xml).root;
  const data = findChild(root, 'sheetData');
  if (data === undefined) return { text, number };

  for (const row of findChildren(data, 'row')) {
    for (const cell of findChildren(row, 'c')) {
      const ref = cell.attrs['r'];
      if (ref === undefined) continue;
      const type = cell.attrs['t'];
      if (type === 's') {
        const at = Number.parseInt(findChild(cell, 'v')?.text ?? '', 10);
        if (!Number.isNaN(at)) text.set(ref, shared[at] ?? '');
      } else if (type === 'inlineStr') {
        const is = findChild(cell, 'is');
        if (is !== undefined) text.set(ref, findChild(is, 't')?.text ?? '');
      } else {
        const value = findChild(cell, 'v')?.text;
        if (value !== undefined) number.set(ref, value);
      }
    }
  }
  return { text, number };
}

function readSharedStrings(raw: Uint8Array | undefined): string[] {
  if (raw === undefined) return [];
  const root = parseXml(strFromU8(raw)).root;
  const out: string[] = [];
  for (const si of findChildren(root, 'si')) {
    const direct = findChild(si, 't');
    if (direct?.text !== undefined) {
      out.push(direct.text);
      continue;
    }
    let joined = '';
    for (const run of findChildren(si, 'r')) joined += findChild(run, 't')?.text ?? '';
    out.push(joined);
  }
  return out;
}

/** 공백을 지운 비교용 이름. `품   명` 과 `품명` 을 같게 본다. */
const squeeze = (value: string): string => value.replace(/\s+/g, '');

/**
 * 기준 문구가 가리키는 **앞선 항목**을 찾는다.
 *
 * 원본이 이름을 줄여 적는다. 기준 문구는 `산업안전관리비` 인데 항목 이름은
 * `산업안전보건관리비` 다. `건강보험료 대비` 의 상대는 `국민건강보험료` 다.
 * 그래서 글자가 **순서대로 들어 있는지**로 찾는다.
 *
 * 다만 **하나로 좁혀질 때만** 받아들인다. 둘 이상 걸리면 어느 쪽인지 모르는
 * 것이고, 모르는 채로 하나를 고르면 기준이 틀린 줄도 모르고 금액이 달라진다.
 */
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const ch of haystack) {
    if (ch === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return at === needle.length;
}

interface PriorRule {
  itemId: string;
  squeezedName: string;
}

function resolvePrior(
  piece: string,
  prior: readonly PriorRule[],
  label: string,
  index: number,
  guideId: string,
): string {
  const exact = prior.filter((r) => r.squeezedName === piece);
  const candidates =
    exact.length > 0 ? exact : prior.filter((r) => isSubsequence(piece, r.squeezedName));
  if (candidates.length === 1) return candidates[0]!.itemId;
  if (candidates.length === 0) {
    throw new GuideTemplateError(
      `${index + 1}번째 간접비의 기준 '${label}' 중 '${piece}' 를 앞선 항목에서 찾지 못했다.`,
      guideId,
    );
  }
  throw new GuideTemplateError(
    `${index + 1}번째 간접비의 기준 '${label}' 중 '${piece}' 가 ` +
      `${candidates.map((c) => c.squeezedName).join(', ')} 중 어느 것인지 모르겠다.`,
    guideId,
  );
}

/**
 * 간접비 기준 문구 → 계산 축.
 *
 * 문구를 그대로 두고 축만 따로 들고 다닌다. 원본이 적어 둔 말이 사라지면
 * 왜 그 기준인지 알 수 없게 된다.
 */
function basisOf(
  label: string,
  index: number,
  prior: readonly PriorRule[],
  guideId: string,
): IndirectBasis {
  const squeezed = squeeze(label);
  if (squeezed === '노무비대비') return { kind: 'labor' };
  if (squeezed === '직접비대비') return { kind: 'direct' };

  if (squeezed.endsWith('대비') && !squeezed.startsWith('직접비+')) {
    // `건강보험료 대비` — **지정 항목의 금액만.** 직접비를 더하지 않는다.
    const piece = squeezed.slice(0, -'대비'.length);
    return { kind: 'item', itemId: resolvePrior(piece, prior, label, index, guideId) };
  }

  if (squeezed.startsWith('직접비+')) {
    // `직접비+간접노무비+산업안전관리비`
    const plus = squeezed
      .slice('직접비+'.length)
      .split('+')
      .map((piece) => resolvePrior(piece, prior, label, index, guideId));
    return { kind: 'composite', plusItemIds: plus };
  }

  // 모르는 기준을 'labor' 같은 기본값으로 떨어뜨리지 않는다.
  // 요율만 맞고 기준이 틀리면 금액이 조용히 달라진다.
  throw new GuideTemplateError(
    `${index + 1}번째 간접비의 기준 문구 '${label}' 를 해석할 수 없다.`,
    guideId,
  );
}

export function readGuideTemplate(
  id: GuideId,
  bytes: Uint8Array,
  manifest: GuideManifest,
): GuideTemplate {
  const spec = manifest.guides[id];
  if (spec === undefined) {
    throw new GuideTemplateError('manifest 에 이 가이드가 없다.', id);
  }

  const files = unzipSync(bytes);
  const shared = readSharedStrings(files['xl/sharedStrings.xml']);

  // 갑지의 절사 수식을 **실제로 보고** manifest 와 대조한다.
  // 절사 단위가 틀리면 최종 금액이 틀리는데, 자릿수 하나 차이라 눈에 안 띈다.
  const coverPart = files['xl/worksheets/sheet1.xml'];
  if (coverPart === undefined) {
    throw new GuideTemplateError('갑지 시트를 찾을 수 없다.', id);
  }
  const coverXml = strFromU8(coverPart);
  const rounding = /ROUNDDOWN\([\s\S]*?,\s*(-?\d+)\s*\)/.exec(coverXml);
  if (rounding === null) {
    throw new GuideTemplateError('갑지에서 절사 수식을 찾지 못했다.', id);
  }
  if (Number(rounding[1]) !== spec.coverRoundingDigits) {
    throw new GuideTemplateError(
      `갑지 절사 자릿수가 manifest(${spec.coverRoundingDigits})와 다르다 (${rounding[1]}).`,
      id,
    );
  }

  const detailPart = files['xl/worksheets/sheet2.xml'];
  if (detailPart === undefined) {
    throw new GuideTemplateError('세부내역 시트를 찾을 수 없다.', id);
  }
  const detail = readSheet(strFromU8(detailPart), shared);

  // --- 열 역할 확인 ---
  const columns = new Map<string, number>();
  for (const [role, column] of Object.entries(spec.columns)) {
    columns.set(role, columnIndex(column));
  }

  const expectHeader = (role: string, expected: string): void => {
    const column = spec.columns[role];
    if (column === undefined) return;
    const actual = squeeze(detail.text.get(`${column}2`) ?? '');
    if (actual !== squeeze(expected)) {
      throw new GuideTemplateError(
        `${column}2 머리글이 '${expected}' 가 아니라 '${actual}' 다. manifest 가 템플릿과 어긋났다.`,
        id,
      );
    }
  };
  expectHeader('name', '품명');
  expectHeader('quantity', '수량');
  expectHeader('supplier', '제조사/구매처');
  expectHeader('salesRemark', '영업비고');
  expectHeader('itemRate', '품목별요율%');

  // --- 행 역할 확인 ---
  const label = (row: number): string => squeeze(detail.text.get(`A${row}`) ?? '');
  if (label(spec.rows.directSubtotal) !== '직접비계') {
    throw new GuideTemplateError(
      `A${spec.rows.directSubtotal} 가 '직접비계' 가 아니다.`,
      id,
    );
  }
  if (label(spec.rows.indirectSubtotal) !== '간접비계') {
    throw new GuideTemplateError(
      `A${spec.rows.indirectSubtotal} 가 '간접비계' 가 아니다.`,
      id,
    );
  }
  if (label(spec.rows.grandTotal) !== '합계') {
    throw new GuideTemplateError(`A${spec.rows.grandTotal} 가 '합계' 가 아니다.`, id);
  }

  // --- 직종과 노임 확인 ---
  const first = columnIndex(spec.columns['tradeFirst'] ?? '');
  const wages: Record<string, Wage> = {};
  spec.trades.forEach((trade, index) => {
    const nameColumn = columnName(first + index * 2);
    const amountColumn = columnName(first + index * 2 + 1);
    const headerText = detail.text.get(`${nameColumn}2`) ?? '';
    if (squeeze(headerText) !== squeeze(trade)) {
      throw new GuideTemplateError(
        `${nameColumn}2 직종이 '${trade}' 가 아니라 '${headerText}' 다.`,
        id,
      );
    }
    const unit = (detail.text.get(`${nameColumn}3`) ?? '') as WageUnit;
    const amount = detail.number.get(`${amountColumn}3`);
    const recorded = spec.wage.wages[trade];
    if (amount === undefined || recorded === undefined) {
      throw new GuideTemplateError(`${trade} 의 노임을 읽을 수 없다.`, id);
    }
    if (amount !== recorded.amount || unit !== recorded.unit) {
      throw new GuideTemplateError(
        `${trade} 의 노임이 manifest 와 다르다 (${amountColumn}3).`,
        id,
      );
    }
    if (unit !== 'M/D' && unit !== 'M/M') {
      throw new GuideTemplateError(`${trade} 의 노임 단위 '${unit}' 를 모른다.`, id);
    }
    wages[trade] = { amount, unit };
  });

  // --- 간접비 항목 ---
  const prior: PriorRule[] = [];
  const indirectRules: IndirectCostRule[] = spec.indirect.map((entry, index) => {
    const row = spec.rows.indirectFirst + index;
    const actual = squeeze(detail.text.get(`B${row}`) ?? '');
    if (actual !== squeeze(entry.name)) {
      throw new GuideTemplateError(
        `B${row} 간접비 이름이 '${entry.name}' 가 아니라 '${actual}' 다.`,
        id,
      );
    }
    const itemId = `g${index + 1}`;
    // **자기 자신을 등록하기 전에** 기준을 푼다.
    // 그래야 자기참조와 뒤 항목 참조가 여기서 걸린다.
    const basis = basisOf(entry.basisLabel, index, prior, id);
    prior.push({ itemId, squeezedName: squeeze(entry.name) });
    return {
      itemId,
      name: entry.name,
      basisLabel: entry.basisLabel,
      basis,
      rate: entry.rate,
      applied: entry.applied,
      source: `견적서 가이드 ${id} (${spec.wage.periodLabel})`,
      ...(entry.conditionText !== undefined
        ? { conditionText: entry.conditionText }
        : {}),
    };
  });

  const printLastColumn = columnIndex(
    (spec.printArea.detail.split(':')[1] ?? '').replace(/\d+$/, ''),
  );

  return {
    id,
    profile: spec.profile,
    hasCost: spec.hasCost,
    bytes,
    sheets: spec.sheets,
    printArea: spec.printArea,
    detailScale: spec.detailScale,
    coverRoundingDigits: spec.coverRoundingDigits,
    coverRoundingLabel: spec.coverRoundingLabel,
    freezePane: spec.freezePane,
    printTitles: spec.printTitles,
    columns,
    rows: spec.rows,
    printLastColumn,
    trades: spec.trades,
    wages: {
      wageTableId: `WAGE-${spec.wage.periodLabel}`,
      periodLabel: spec.wage.periodLabel,
      source: `견적서 가이드 3행 (${id})`,
      wages,
    },
    wageFingerprint: spec.wage.contentHash,
    indirectRules,
  };
}

/** 가이드 묶음에서 프로파일·원가 유무로 템플릿을 고른다. */
export function selectGuide(
  guides: GuideTemplateSet,
  profile: IndirectProfileId,
  withCost: boolean,
): GuideTemplate {
  for (const id of GUIDE_IDS) {
    const guide = guides[id];
    if (guide.profile === profile && guide.hasCost === withCost) return guide;
  }
  throw new GuideTemplateError(
    `프로파일 ${profile} / 원가 ${withCost ? '포함' : '제외'} 에 맞는 템플릿이 없다.`,
    'select',
  );
}

/** 간접비 항목 목록. 호출마다 **독립 복사본**을 준다 — 사용자가 요율을 바꾼다. */
export function indirectCostsFor(
  profile: IndirectProfileId,
  guides: GuideTemplateSet,
): IndirectCostRule[] {
  const guide = selectGuide(guides, profile, false);
  return guide.indirectRules.map((rule) => ({
    ...rule,
    // basis 안의 배열까지 복사하지 않으면 한 견적의 수정이 다른 견적에 번진다.
    basis:
      rule.basis.kind === 'composite'
        ? { kind: 'composite' as const, plusItemIds: [...rule.basis.plusItemIds] }
        : { ...rule.basis },
  }));
}
