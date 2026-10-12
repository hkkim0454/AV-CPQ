/**
 * 확인 항목 요약 — 출력 전에 해결할 것을 한곳에 모아 보여준다
 * (사용성 2차 Task B).
 *
 * 이 컴포넌트는 **목록을 그리고 `onNavigate` 를 부르는 일만** 한다.
 * 항목을 만드는 일은 `reviewItems.ts`, 실제로 고치는 일은 기존 입력
 * 컴포넌트가 한다. 여기서 문서를 바꾸지 않는다.
 *
 * ⛔ **닫아서 없애는 단추를 두지 않는다.** 목록은 지금 문서에서 매번
 * 파생되므로, 사람이 "읽음"으로 지울 수 있으면 실행취소와 어긋난다.
 *
 * ⛔ **이 목록이 비었다고 출력 가능을 알리지 않는다.** 출력 가부는
 * `exportGate` 가 정한다.
 */
import { useState } from 'react';
import {
  CATEGORY_LABEL,
  countByCategory,
  type ReviewItem,
  type ReviewTarget,
} from './reviewItems';

interface ReviewSummaryProps {
  items: readonly ReviewItem[];
  onNavigate(target: ReviewTarget): void;
  /** 이동이 실패했을 때 보여줄 안내. 다른 행을 대신 열지 않는다. */
  navigationError?: string | undefined;
}

/** 고칠 자리가 있는 항목만 누를 수 있다. 없는 기능을 약속하지 않는다. */
function isActionable(target: ReviewTarget): boolean {
  return target.kind !== 'detail';
}

export function ReviewSummary({ items, onNavigate, navigationError }: ReviewSummaryProps) {
  const [open, setOpen] = useState(true);
  const counts = countByCategory(items);
  const blockingCount = items.filter((x) => x.blocking).length;

  if (items.length === 0) {
    return (
      <section className="q-card q-review-summary" aria-label="확인 항목">
        <h3>확인 항목 없음</h3>
        <p className="q-muted">
          지금 문서에서 확인할 항목이 없습니다. 출력 가능 여부는 위의 다운로드 단추가 알려 줍니다.
        </p>
      </section>
    );
  }

  return (
    <section className="q-card q-review-summary" aria-label="확인 항목">
      <div className="q-review-head">
        <h3>
          확인 항목 {items.length}건
          {blockingCount > 0 && <span className="q-review-blocking"> · 출력을 막는 항목 {blockingCount}건</span>}
        </h3>
        <button type="button" className="q-button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '목록 접기' : '목록 펼치기'}
        </button>
      </div>

      {/* 품목 수가 아니라 **확인 항목 수**다. 한 행에서 둘 이상 나올 수 있다. */}
      <p className="q-muted">
        {(Object.keys(counts) as (keyof typeof counts)[])
          .filter((k) => counts[k] > 0)
          .map((k) => `${CATEGORY_LABEL[k]} ${counts[k]}건`)
          .join(' · ')}
      </p>

      {navigationError !== undefined && (
        <p role="alert" className="q-notice q-notice-error">{navigationError}</p>
      )}

      {open && (
        <ul className="q-review-items">
          {items.map((item) => (
            <li key={item.id}>
              {isActionable(item.target) ? (
                <button
                  type="button"
                  className="q-review-item"
                  onClick={() => onNavigate(item.target)}
                >
                  <span className="q-review-category">{CATEGORY_LABEL[item.category]}</span>
                  <span className="q-review-message">{item.message}</span>
                  {/*
                    문구가 같은 두 항목을 **눈으로** 가르는 유일한 단서다.
                    id 만 다르면 화면에서는 똑같아 보여 어느 쪽인지 알 수 없다.
                  */}
                  {item.location !== undefined && (
                    // 넓은 화면에서는 잘려 보이므로 전체 문구를 title 로도 남긴다.
                    <span className="q-review-location" title={item.location}>{item.location}</span>
                  )}
                </button>
              ) : (
                // 고칠 자리가 없다 — 원문만 펼쳐 보여준다.
                <details className="q-review-item-detail">
                  <summary>
                    <span className="q-review-category">{CATEGORY_LABEL[item.category]}</span>
                    <span className="q-review-message">{item.message}</span>
                    {item.location !== undefined && (
                      <span className="q-review-location">{item.location}</span>
                    )}
                  </summary>
                  <p className="q-muted">
                    이 항목은 화면에서 바로 고칠 수 있는 자리가 없습니다. 원본 자료나 계산 기준을 확인해야 합니다.
                    {item.rowId !== undefined && ` (행 ${item.rowId})`}
                    {item.systemId !== undefined && ` (시스템 ${item.systemId})`}
                  </p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
