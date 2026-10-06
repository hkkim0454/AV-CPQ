/**
 * 케이블 후보 화면의 큰 분류. 사용자 확정표:
 * docs/cable-candidate-category-draft.md
 *
 * SKU는 원본 행 번호를 포함해 카탈로그 교체 때 밀린다. 이 모듈은
 * 품명과 현행 묶음 이름만 읽고, 모르는 경우 반드시 미분류로 돌린다.
 */
import type { CatalogProduct } from '../../data/catalog/load';

export const CABLE_CATEGORY_ORDER = [
  'HDMI AOC·광케이블',
  'HDMI 일반·변환',
  '일반 광케이블·광 연결 부품',
  'UTP 케이블',
  'SF/UTP',
  'S/FTP',
  'F/UTP',
  'SDI·동축·RF·안테나',
  '스피커 케이블',
  '오디오·마이크 케이블',
  'USB·제어 케이블',
  '전원 케이블',
  '커넥터',
  '배관·설치 자재',
  '기기 전용 케이블',
  '미분류',
] as const;

export type CableCategory = (typeof CABLE_CATEGORY_ORDER)[number];

const LAN_GROUPS = new Set([
  'LS전선_SFTP CABLE',
  'LS전선_UTP CABLE',
  '벨덴_SFTP CABLE',
  '벨덴_UTP CABLE',
]);

const INTEL_GROUP = '- Intel Core i7 / 16GB DDR4 / 256GB SSD / Win11 Pro  64Bit 포함';

/** 한 묶음이 한 큰 분류로 가는 경우만 담는다. 분리 묶음 6개는 아래에서 판정한다. */
const BY_GROUP = new Map<string, CableCategory>([
  ['CS_HDMI 케이블_AOC', 'HDMI AOC·광케이블'],
  ['RTCOM_HDMI Armored 광케이블', 'HDMI AOC·광케이블'],
  ['미디어리드_HDMI Armored 광케이블', 'HDMI AOC·광케이블'],
  ['미디어리드_HDMI 광케이블 (분리형)', 'HDMI AOC·광케이블'],
  ['미디어리드_HDMI 광케이블 (일체형)', 'HDMI AOC·광케이블'],
  ['CS_HDMI 케이블', 'HDMI 일반·변환'],
  ['DP to HDMI 케이블&젠더', 'HDMI 일반·변환'],
  ['DVI to HDMI 케이블&젠더', 'HDMI 일반·변환'],
  ['Mini DP to HDMI 케이블', 'HDMI 일반·변환'],
  ['RTCOM_HDMI Locking 케이블', 'HDMI 일반·변환'],
  ['F.D.F', '일반 광케이블·광 연결 부품'],
  ['Jumper Cord', '일반 광케이블·광 연결 부품'],
  ['OM3광케이블', '일반 광케이블·광 연결 부품'],
  ['OM3광케이블 (참고)', '일반 광케이블·광 연결 부품'],
  ['PIGTAIL', '일반 광케이블·광 연결 부품'],
  ['SM광케이블_LS(저연)', '일반 광케이블·광 연결 부품'],
  ['SM광케이블_LSZH(저연/무할로겐)', '일반 광케이블·광 연결 부품'],
  ['광케이블 견적 (참고)', '일반 광케이블·광 연결 부품'],
  ['우레탄 광케이블', '일반 광케이블·광 연결 부품'],
  ['접속시험 (참고)', '일반 광케이블·광 연결 부품'],
  ['특수광케이블', '일반 광케이블·광 연결 부품'],
  ['광 4K 송수신기_OPHIT', '일반 광케이블·광 연결 부품'],
  ['RF 케이블', 'SDI·동축·RF·안테나'],
  ['SDI 케이블_12G', 'SDI·동축·RF·안테나'],
  ['SDI 케이블_3G', 'SDI·동축·RF·안테나'],
  ['안테나 케이블', 'SDI·동축·RF·안테나'],
  ['스피커 케이블', '스피커 케이블'],
  ['1CH MIC CABLE', '오디오·마이크 케이블'],
  ['Multi MIC CABLE', '오디오·마이크 케이블'],
  ['RS232 케이블', 'USB·제어 케이블'],
  ['USB 케이블', 'USB·제어 케이블'],
  ['타블렛', 'USB·제어 케이블'],
  ['전원 케이블', '전원 케이블'],
  ['뉴트릭 커넥터', '커넥터'],
  ['리안 커넥터', '커넥터'],
  ['카펫랩 / 덮개', '배관·설치 자재'],
  ['케이블 트레이', '배관·설치 자재'],
  ['후렉시블', '배관·설치 자재'],
  ['DESK BOX_EXRON', '배관·설치 자재'],
  ['Jabra_Panacast50', '기기 전용 케이블'],
  ['Logitech Group', '기기 전용 케이블'],
  ['Logitech Meetup', '기기 전용 케이블'],
  ['Logitech Rally Plus', '기기 전용 케이블'],
  ['Logitech Rallybar', '기기 전용 케이블'],
  ['Logitech Rallybar Mini', '기기 전용 케이블'],
  ['Poly_액세서리 (G700,500,310)', '기기 전용 케이블'],
  ['Yealink_SMARTVISION40', '기기 전용 케이블'],
  ['Yealink_UVC84', '기기 전용 케이블'],
  ['Yealink_UVC86', '기기 전용 케이블'],
  ['Televic', '기기 전용 케이블'],
]);

export function classifyCableCandidate(product: Pick<CatalogProduct, 'quoteName' | 'options'>): CableCategory {
  const group = product.options['group'];
  if (group === undefined) return '미분류';
  const name = product.quoteName.trim().toUpperCase();

  if (LAN_GROUPS.has(group)) {
    if (name.startsWith('- ')) return '커넥터';
    if (name.includes('SF/UTP')) return 'SF/UTP';
    if (name.includes('S/FTP')) return 'S/FTP';
    if (name.includes('F/UTP')) return 'F/UTP';
    if (name.includes('SFTP')) return 'S/FTP';
    if (name.includes('UTP')) return 'UTP 케이블';
    return '미분류';
  }
  if (group === 'CISCO') {
    if (name.includes('MICROPHONE')) return '오디오·마이크 케이블';
    if (name.includes('BNC')) return 'SDI·동축·RF·안테나';
    return '미분류';
  }
  if (group === INTEL_GROUP) {
    if (name.includes('CONTROL CABLE')) return 'USB·제어 케이블';
    if (name.includes('COAXIAL')) return 'SDI·동축·RF·안테나';
    return '미분류';
  }
  return BY_GROUP.get(group) ?? '미분류';
}

export function groupCableCandidates(
  candidates: readonly string[],
  bySku: ReadonlyMap<string, Pick<CatalogProduct, 'quoteName' | 'options'>>,
): { category: CableCategory; skus: string[] }[] {
  const grouped = new Map<CableCategory, string[]>();
  for (const sku of candidates) {
    const product = bySku.get(sku);
    const category = product === undefined ? '미분류' : classifyCableCandidate(product);
    const skus = grouped.get(category);
    if (skus === undefined) grouped.set(category, [sku]);
    else skus.push(sku);
  }
  return CABLE_CATEGORY_ORDER.flatMap((category) => {
    const skus = grouped.get(category);
    return skus === undefined ? [] : [{ category, skus }];
  });
}
