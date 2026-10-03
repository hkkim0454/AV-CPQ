/**
 * 원가 전용 세션 — 메모리에만 존재한다 (설계서 §8.1, §8.4, §6.2).
 *
 * 설계서 §6.2: "PrivateCostSession은 영속 객체에 포함하지 않는다."
 * 그래서 이 객체는:
 *   - 원가를 **private 필드**에 담아 `JSON.stringify`로 새지 않게 한다
 *   - 파일명을 담지 않는다 (§6.3: 원가표 파일명을 저장하지 않는다)
 *   - `localStorage`/`IndexedDB`/`sessionStorage`에 닿는 코드를 두지 않는다
 *   - 네트워크 전송 함수를 두지 않는다
 *
 * 설계서 §8.3: "적용·해제 시 worker와 참조를 정리하고 Object URL을 해제한다.
 * JavaScript 메모리의 완전한 물리적 소거를 보장한다고 표현하지 않는다."
 * `clearSession`은 참조를 끊는다. GC가 언제 실제로 회수하는지는 보장하지 않는다.
 */
import type { PriceEntry } from './parse';

export interface PrivateCostSession {
  /** 등록된 SKU 수. 값이 아니라 개수만 노출한다. */
  readonly size: number;
  readonly cleared: boolean;
  /** 정확 일치로만 찾는다. 부분 일치로 엉뚱한 원가를 붙이지 않는다. */
  lookup(sku: string): PriceEntry | undefined;
  /** 등록된 SKU 목록 — 매칭 현황 표시용. 원가 값은 주지 않는다. */
  knownSkus(): string[];
}

class Session implements PrivateCostSession {
  /** `#` private 필드라 `JSON.stringify`와 `Object.keys`에 나오지 않는다. */
  #entries: Map<string, PriceEntry>;
  #cleared = false;

  constructor(entries: readonly PriceEntry[]) {
    this.#entries = new Map(entries.map((e) => [e.sku, e]));
  }

  get size(): number {
    return this.#entries.size;
  }

  get cleared(): boolean {
    return this.#cleared;
  }

  lookup(sku: string): PriceEntry | undefined {
    return this.#entries.get(sku);
  }

  knownSkus(): string[] {
    return [...this.#entries.keys()];
  }

  clear(): void {
    this.#entries.clear();
    this.#entries = new Map();
    this.#cleared = true;
  }

  /**
   * 직렬화를 막는다. 실수로 작업 파일이나 네트워크 payload에 들어가도
   * 원가가 아니라 표식만 나간다 (설계서 §8.1).
   */
  toJSON(): { privateCostSession: 'redacted' } {
    return { privateCostSession: 'redacted' };
  }
}

export function createSession(entries: readonly PriceEntry[]): PrivateCostSession {
  return new Session(entries);
}

/**
 * 세션을 지운다.
 *
 * 설계서 §8.6: 이 호출이 악성 확장 프로그램이나 감염된 PC로부터 보호한다고
 * 주장하지 않는다. 앱이 들고 있던 참조를 끊을 뿐이다.
 */
export function clearSession(session: PrivateCostSession): void {
  if (session instanceof Session) {
    session.clear();
  }
}
