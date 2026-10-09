import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

// 저장 대상 견적 입력칸의 미반영 여부만 추적한다. 입력값·원가·파일은 보관하지 않는다.
const DraftContext = createContext<{ pending: boolean; report(id: string, pending: boolean): void }>({
  pending: false,
  report: () => undefined,
});

export function QuoteDrafts({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const report = useCallback((id: string, pending: boolean) => {
    setIds((previous) => {
      if (previous.has(id) === pending) return previous;
      const next = new Set(previous);
      if (pending) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ pending: ids.size > 0, report }), [ids, report]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function usePendingQuoteDraft(pending: boolean): void {
  const id = useId();
  const { report } = useContext(DraftContext);
  useEffect(() => {
    report(id, pending);
    return () => report(id, false);
  }, [id, pending, report]);
}

export function useHasPendingQuoteDrafts(): boolean {
  return useContext(DraftContext).pending;
}
