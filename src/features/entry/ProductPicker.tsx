/**
 * 품목 직접 선택 — 보조 입구 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 실제 변환 경로(pickedItemsToQuote)를 그대로 부른다.
 */
import { useState } from 'react';
import type { Catalog } from '../../data/catalog/load';
import { defaultHeader } from '../../app/defaultHeader';
import type { LoadedDocument } from '../../app/workspace';
import { pickedItemsToQuote } from '../../import/picker/toQuote';
import { validateQuantityInput } from '../../domain/quote/validateInput';

interface PickedLine {
  sku: string;
  name: string;
  quantity: string;
}

export function ProductPicker({
  catalog,
  onLoaded,
}: {
  catalog: Catalog;
  onLoaded(input: LoadedDocument): void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PickedLine[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);

  const matches =
    query.trim() === ''
      ? []
      : catalog.products
          .filter(
            (p) =>
              p.quoteName.toLowerCase().includes(query.trim().toLowerCase()) ||
              p.sku.toLowerCase().includes(query.trim().toLowerCase()),
          )
          .slice(0, 20);

  function addItem(sku: string, name: string): void {
    setPicked((prev) => (prev.some((line) => line.sku === sku) ? prev : [...prev, { sku, name, quantity: '1' }]));
  }

  function removeItem(sku: string): void {
    setPicked((prev) => prev.filter((line) => line.sku !== sku));
  }

  function setQuantity(sku: string, quantity: string): void {
    setPicked((prev) => prev.map((line) => (line.sku === sku ? { ...line, quantity } : line)));
  }

  function build(): void {
    const invalid = picked.find((line) => !validateQuantityInput(line.quantity).ok);
    if (invalid !== undefined) {
      setError(`${invalid.name}의 수량이 올바르지 않습니다.`);
      return;
    }
    setError(undefined);
    const result = pickedItemsToQuote(
      {
        header: defaultHeader(`PICK-${Date.now()}`),
        systems: [
          {
            name: '시스템1',
            items: picked.map((line) => ({ sku: line.sku, quantity: line.quantity })),
          },
        ],
      },
      catalog,
    );
    onLoaded({ document: result.document, importWarnings: result.warnings });
  }

  return (
    <div className="q-card">
      <h3>품목 직접 선택</h3>
      <p className="q-muted">승인된 카탈로그 {catalog.products.length}개 품목에서 고릅니다.</p>
      <input
        aria-label="품목 검색"
        placeholder="품명 또는 SKU로 검색"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length > 0 && (
        <ul className="q-picker-matches">
          {matches.map((product) => (
            <li key={product.sku}>
              <span>
                {product.quoteName} ({product.sku})
              </span>
              <button type="button" className="q-button" onClick={() => addItem(product.sku, product.quoteName)}>
                추가
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked.length > 0 && (
        <>
          <h4>담은 품목</h4>
          <ul className="q-picker-picked">
            {picked.map((line) => (
              <li key={line.sku}>
                <span>{line.name}</span>
                <input
                  aria-label={`${line.name} 담은 수량`}
                  value={line.quantity}
                  onChange={(event) => setQuantity(line.sku, event.target.value)}
                />
                <button type="button" className="q-button" onClick={() => removeItem(line.sku)}>
                  빼기
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="q-button q-primary" onClick={build}>
            견적 만들기
          </button>
        </>
      )}
      {error !== undefined && (
        <p role="alert" className="q-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
