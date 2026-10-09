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
import type { QuoteSystem } from '../../domain/quote/types';
import { CandidateDetail } from '../catalog/CandidateDetail';

interface PickedLine {
  sku: string;
  name: string;
  quantity: string;
}

export function ProductPicker({
  catalog,
  onLoaded,
  onAddToExisting,
  systems = [],
  onClose,
}: {
  catalog: Catalog;
  /** 새 견적을 만드는 기본 모드. */
  onLoaded?(input: LoadedDocument): void;
  /** 이미 열린 견적에 품목 하나를 바로 더하는 모드 — 있으면 이 모드를 쓴다. */
  onAddToExisting?(systemId: string, sku: string): void;
  systems?: readonly QuoteSystem[];
  onClose?(): void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PickedLine[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [systemId, setSystemId] = useState(systems.length === 1 ? systems[0]!.systemId : '');
  const [addedMessage, setAddedMessage] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const searchKey = query.trim().toLocaleLowerCase();
  const selectedSystem = systems.find((system) => system.systemId === systemId);

  const matches =
    searchKey === ''
      ? []
      : catalog.products
          .filter(
            (p) =>
              [p.model, p.quoteSpec, p.quoteName, p.sku, p.options['description'] ?? '']
                .some((value) => value.toLocaleLowerCase().includes(searchKey)),
          )
          .sort((a, b) => Number(b.model.toLocaleLowerCase() === searchKey) - Number(a.model.toLocaleLowerCase() === searchKey));

  function addItem(sku: string, name: string): void {
    if (onAddToExisting !== undefined) {
      if (selectedSystem === undefined) return;
      onAddToExisting(selectedSystem.systemId, sku);
      setAddedMessage(`${selectedSystem.name}에 ${name} 1개를 추가했습니다.`);
      return;
    }
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
    onLoaded?.({ document: result.document, importWarnings: result.warnings });
  }

  return (
    <div className="q-card q-product-picker">
      <h3>품목 직접 선택</h3>
      <p className="q-muted">승인된 카탈로그 {catalog.products.length}개 품목에서 고릅니다.</p>
      {onAddToExisting !== undefined && (
        <label className="q-picker-target">
          추가할 시스템
          <select aria-label="추가할 시스템" value={systemId} onChange={(event) => setSystemId(event.target.value)}>
            <option value="">시스템을 선택하세요</option>
            {systems.map((system) => <option key={system.systemId} value={system.systemId}>{system.name}</option>)}
          </select>
        </label>
      )}
      <input
        aria-label="품목 검색"
        placeholder="모델명·품명·규격·설명·SKU 검색"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setVisibleCount(20); }}
      />
      {searchKey !== '' && <p className="q-muted" role="status">검색 결과 {matches.length}건{matches.length > visibleCount ? ` 중 ${visibleCount}건 표시` : ''}</p>}
      {matches.length > 0 && (
        <ul className="q-picker-matches">
          {matches.slice(0, visibleCount).map((product) => (
            <li key={product.sku}>
              <CandidateDetail product={product} catalog={catalog} />
              <button type="button" className="q-button" disabled={onAddToExisting !== undefined && selectedSystem === undefined} onClick={() => addItem(product.sku, product.quoteName)}>
                추가
              </button>
            </li>
          ))}
        </ul>
      )}
      {matches.length > visibleCount && <button type="button" className="q-button" onClick={() => setVisibleCount((count) => count + 20)}>검색 결과 더 보기</button>}
      {addedMessage !== '' && <p role="status">{addedMessage}</p>}
      {onClose !== undefined && <button type="button" className="q-button" onClick={onClose}>품목 선택 닫기</button>}

      {onAddToExisting === undefined && picked.length > 0 && (
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
