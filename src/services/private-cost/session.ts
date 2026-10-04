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
  /** 등록된 줄 수. 값이 아니라 개수만 노출한다. */
  readonly size: number;
  readonly cleared: boolean;
  /** SKU 정확 일치. 부분 일치로 엉뚱한 원가를 붙이지 않는다. */
  lookup(sku: string): PriceEntry | undefined;
  /** 사람이 확인해 연결한 줄을 자리표로 꺼낸다. */
  byEntryId(entryId: string): PriceEntry | undefined;
  /**
   * 모델명으로 **후보를 전부** 돌려준다. 하나를 고르지 않는다.
   *
   * 원가 파일에 같은 모델이 두 줄 있을 수 있고, 비슷한 모델명이 여럿일 수도
   * 있다. 여기서 먼저 온 것이나 가장 비슷한 것을 고르면 **조용히 틀린 원가**가
   * 붙는다. 어느 줄인지는 사람이 정한다.
   */
  candidatesByModel(model: string): PriceEntry[];
  /** 등록된 SKU 목록 — 매칭 현황 표시용. 원가 값은 주지 않는다. */
  knownSkus(): string[];
  /** 등록된 모델명 목록 — 연결 화면이 고를 거리. 원가 값은 주지 않는다. */
  knownModels(): string[];
}

/** 비교용 모델명 — 공백·대소문자만 맞춘다. **유사 추측은 하지 않는다.** */
function normalizeModel(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

class Session implements PrivateCostSession {
  /** `#` private 필드라 `JSON.stringify`와 `Object.keys`에 나오지 않는다. */
  #entries: Map<string, PriceEntry>;
  #cleared = false;

  /** 모델명(정규화) → 그 모델인 줄들. 여러 줄일 수 있다. */
  #byModel: Map<string, PriceEntry[]>;

  constructor(entries: readonly PriceEntry[]) {
    this.#entries = new Map(entries.map((e) => [e.entryId, e]));
    this.#byModel = new Map();
    for (const entry of entries) {
      if (entry.model === undefined) continue;
      const key = normalizeModel(entry.model);
      const list = this.#byModel.get(key) ?? [];
      list.push(entry);
      this.#byModel.set(key, list);
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  get cleared(): boolean {
    return this.#cleared;
  }

  lookup(sku: string): PriceEntry | undefined {
    for (const entry of this.#entries.values()) {
      if (entry.sku === sku) return entry;
    }
    return undefined;
  }

  byEntryId(entryId: string): PriceEntry | undefined {
    return this.#entries.get(entryId);
  }

  candidatesByModel(model: string): PriceEntry[] {
    return [...(this.#byModel.get(normalizeModel(model)) ?? [])];
  }

  knownSkus(): string[] {
    const out: string[] = [];
    for (const entry of this.#entries.values()) {
      if (entry.sku !== undefined) out.push(entry.sku);
    }
    return out;
  }

  knownModels(): string[] {
    const out = new Set<string>();
    for (const entry of this.#entries.values()) {
      if (entry.model !== undefined) out.add(entry.model);
    }
    return [...out];
  }

  clear(): void {
    this.#entries.clear();
    this.#entries = new Map();
    this.#byModel.clear();
    this.#byModel = new Map();
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
