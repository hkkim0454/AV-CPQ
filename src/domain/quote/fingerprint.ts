/**
 * FNV-1a 64비트 — 드리프트 탐지용 동기 해시다. 위변조 방지용이 아니다.
 *
 * 브라우저의 SHA-256(`crypto.subtle`)은 비동기라 React 렌더 중(동기 경로)
 * 에서는 못 쓴다. 이 함수는 결정적이고 플랫폼에 의존하지 않는다 — 내용이
 * 한 글자라도 바뀌면 지문이 바뀐다. `guideBasis.ts`의 `wageContentFingerprint`
 * 와 같은 용도·같은 알고리즘이다(중복 구현 대신 여기서 공유한다).
 */
export function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash ^ BigInt(text.charCodeAt(i))) * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
