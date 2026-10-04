/**
 * 품목 직접 선택 — 보조 입구 (계획 2026-10-04-quote-workspace-ui Task 1).
 *
 * 실제 검색/추가(pickedItemsToQuote 연결)는 Task 2 범위다. 여기서는
 * 승인된 카탈로그가 실제로 로딩됐다는 것만 보여준다 — 가짜 품목 수를
 * 적지 않는다.
 */
import type { Catalog } from '../../data/catalog/load';

export function ProductPicker({ catalog }: { catalog: Catalog }) {
  return (
    <div className="q-card">
      <h3>품목 직접 선택</h3>
      <p className="q-muted">
        승인된 카탈로그 {catalog.products.length}개 품목에서 고릅니다. 검색·수량 입력은 이어서
        만듭니다.
      </p>
    </div>
  );
}
