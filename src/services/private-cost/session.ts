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
  /**
   * 이 세션의 표식. **원가 파일을 바꾸면 달라진다.**
   *
   * 사람이 확인한 연결(`costEntryId`)은 이 표식을 품는다. 그래서 원가 파일을
   * 바꾼 뒤 옛 연결을 그대로 쓰면 **붙지 않는다.** 표식이 없으면 새 파일의
   * 3번째 줄이 옛 파일의 3번째 줄 자리에 조용히 들어간다 — 품목도 금액도
   * 전혀 다른 줄인데 숫자만 바뀐다.
   *
   * 값이 아니라 표식이라 저장해도 원가가 새지 않는다.
   */
  readonly sessionId: string;
  /** 등록된 줄 수. 값이 아니라 개수만 노출한다. */
  readonly size: number;
  readonly cleared: boolean;
  /** SKU 정확 일치. 부분 일치로 엉뚱한 원가를 붙이지 않는다. */
  lookup(sku: string): PriceEntry | undefined;
  /**
   * 사람이 확인해 연결한 줄을 자리표로 꺼낸다.
   *
   * **다른 세션의 자리표는 받지 않는다.** 원가 파일을 바꿨는데 옛 연결이
   * 그대로 붙으면 엉뚱한 제품의 원가가 들어간다.
   */
  byEntryId(entryId: string): PriceEntry | undefined;
  /** 이 자리표가 이 세션의 것인가. 화면이 "다시 연결하세요"를 띄울 근거. */
  ownsEntryId(entryId: string): boolean;
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

/**
 * 세션 표식을 만든다.
 *
 * 내용에서 뽑지 않는다 — 같은 파일을 두 번 올리면 같은 표식이 되어, 그 사이
 * 사용자가 파일을 고쳤어도 옛 연결이 되살아난다. **열 때마다 새 표식**이다.
 */
let sessionCounter = 0;
function newSessionId(): string {
  sessionCounter += 1;
  const random = Math.floor(Math.random() * 0xffffffff).toString(16);
  return `cs${sessionCounter}-${random}`;
}

class Session implements PrivateCostSession {
  /** `#` private 필드라 `JSON.stringify`와 `Object.keys`에 나오지 않는다. */
  #entries: Map<string, PriceEntry>;
  #cleared = false;
  readonly sessionId = newSessionId();

  /** 모델명(정규화) → 그 모델인 줄들. 여러 줄일 수 있다. */
  #byModel: Map<string, PriceEntry[]>;

  constructor(entries: readonly PriceEntry[]) {
    // 자리표에 세션 표식을 붙인다. 파일을 바꾸면 자리표가 전부 달라진다.
    const owned = entries.map((entry) => ({
      ...entry,
      entryId: `${this.sessionId}:${entry.entryId}`,
    }));
    this.#entries = new Map(owned.map((e) => [e.entryId, e]));
    this.#byModel = new Map();
    for (const entry of owned) {
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
    if (!this.ownsEntryId(entryId)) return undefined;
    return this.#entries.get(entryId);
  }

  ownsEntryId(entryId: string): boolean {
    return entryId.startsWith(`${this.sessionId}:`);
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
