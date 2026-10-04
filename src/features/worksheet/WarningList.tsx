/**
 * 확인 경고 목록 (계획 2026-10-04-quote-workspace-ui Task 2).
 *
 * 구성도/품셈/계산 경고를 전부 보여준다. 일괄 지우기는 없다 — 실제
 * 값을 해결해야 경고가 해소된다(계획 §3).
 */
import type { ImportWarning } from '../../import/diagram/devices';

export function WarningList({ warnings }: { warnings: readonly ImportWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="q-card q-warning-list" role="alert">
      <h3>확인이 필요합니다 ({warnings.length}건)</h3>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${warning.nodeId ?? warning.edgeId ?? index}`}>
            <strong>{warning.blocking ? '확정 차단' : '확인'}</strong> {warning.message}
            {(warning.nodeId !== undefined || warning.edgeId !== undefined) && (
              <span className="q-muted"> ({warning.nodeId ?? warning.edgeId})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
