import type { Catalog, CatalogProduct } from '../../data/catalog/load';

/** 승인 판매단가만 표시한다. 원가 세션을 읽지 않는다. */
export function CandidateDetail({ product, catalog }: { product: CatalogProduct; catalog: Catalog }) {
  const description = product.options['description'];
  const price = catalog.prices.get(product.sku);
  const [whole, fraction] = price?.split('.') ?? [];
  // 숫자 변환 없이 자릿수 구분만 한다. 미등록과 명시적 0원을 구분한다.
  const priceLabel = whole === undefined ? '미등록' : `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction === undefined ? '' : `.${fraction}`}원`;
  return (
    <div className="q-candidate-detail">
      <div className="q-candidate-name">
        {product.quoteName}
        {product.model !== '' && ` · 모델 ${product.model}`}
        {product.quoteSpec !== '' && product.quoteSpec !== product.model && ` · 규격 ${product.quoteSpec}`}
      </div>
      {description !== undefined && description !== '' && <div className="q-candidate-desc">{description}</div>}
      <div className="q-candidate-meta">
        <span>SKU {product.sku}</span>
        <span>단위 {product.unit}</span>
        <span>판매단가 {priceLabel}</span>
      </div>
    </div>
  );
}
