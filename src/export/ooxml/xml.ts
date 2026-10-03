/**
 * OOXML을 다루기 위한 최소 XML 파서/직렬화기.
 *
 * 설계서 §9.1: "문자열 정규식 치환만으로 수식과 XML을 수정하지 않는다.
 * XML 파서와 OOXML 관계 구조를 사용한다."
 *
 * 브라우저 `DOMParser`를 쓰지 않는 이유: Node 테스트 환경과 브라우저에서 같은 코드로
 * 같은 결과를 내야 하고, 직렬화 결과가 구현체마다 달라지면 Excel 호환성을 테스트로
 * 고정할 수 없다. 여기서 다루는 범위는 스프레드시트 파트가 쓰는 XML 부분집합이다.
 * 범용 XML 처리기를 지향하지 않는다 — DTD·네임스페이스 해석·외부 엔티티를 지원하지 않는다.
 */

export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** 자식 요소가 없을 때의 텍스트 내용. 혼합 내용은 다루지 않는다. */
  text?: string;
}

export interface XmlDocument {
  /** `<?xml … ?>` 전체. 없으면 undefined. */
  declaration?: string;
  root: XmlElement;
}

// ---------------------------------------------------------------------------
// 이스케이프
// ---------------------------------------------------------------------------

/** 요소 텍스트용. `"`는 텍스트에서 유효하므로 건드리지 않는다. */
export function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 속성값용. 큰따옴표로 감싸므로 `"`까지 이스케이프한다. */
export function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    }
    const named = NAMED_ENTITIES[body];
    return named ?? whole;
  });
}

// ---------------------------------------------------------------------------
// 파싱
// ---------------------------------------------------------------------------

class Cursor {
  constructor(
    readonly source: string,
    public index = 0,
  ) {}

  get done(): boolean {
    return this.index >= this.source.length;
  }

  peek(length = 1): string {
    return this.source.slice(this.index, this.index + length);
  }

  startsWith(value: string): boolean {
    return this.source.startsWith(value, this.index);
  }

  skipWhitespace(): void {
    while (!this.done && /\s/.test(this.source[this.index]!)) this.index += 1;
  }

  /** `until`이 나올 때까지의 문자열을 반환하고 커서를 `until` 앞에 둔다. */
  readUntil(until: string): string {
    const at = this.source.indexOf(until, this.index);
    if (at === -1) {
      throw new SyntaxError(`XML: '${until}'를 찾지 못했다 (위치 ${this.index})`);
    }
    const value = this.source.slice(this.index, at);
    this.index = at;
    return value;
  }

  expect(value: string): void {
    if (!this.startsWith(value)) {
      const near = this.source.slice(this.index, this.index + 40);
      throw new SyntaxError(`XML: '${value}'를 기대했으나 '${near}'가 왔다`);
    }
    this.index += value.length;
  }
}

const NAME_CHAR = /[A-Za-z0-9_:.\-À-￿]/;

function readName(cursor: Cursor): string {
  const start = cursor.index;
  while (!cursor.done && NAME_CHAR.test(cursor.source[cursor.index]!)) {
    cursor.index += 1;
  }
  if (cursor.index === start) {
    throw new SyntaxError(`XML: 이름이 와야 할 자리 (위치 ${start})`);
  }
  return cursor.source.slice(start, cursor.index);
}

function readAttributes(cursor: Cursor): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (;;) {
    cursor.skipWhitespace();
    const ch = cursor.peek();
    if (ch === '>' || ch === '/' || ch === '?' || cursor.done) return attrs;
    const name = readName(cursor);
    cursor.skipWhitespace();
    cursor.expect('=');
    cursor.skipWhitespace();
    const quote = cursor.peek();
    if (quote !== '"' && quote !== "'") {
      throw new SyntaxError(`XML: 속성 ${name}의 값에 따옴표가 없다`);
    }
    cursor.index += 1;
    const raw = cursor.readUntil(quote);
    cursor.index += 1;
    attrs[name] = decodeEntities(raw);
  }
}

function parseElement(cursor: Cursor): XmlElement {
  cursor.expect('<');
  const tag = readName(cursor);
  const attrs = readAttributes(cursor);
  cursor.skipWhitespace();

  if (cursor.startsWith('/>')) {
    cursor.index += 2;
    return { tag, attrs, children: [] };
  }
  cursor.expect('>');

  const element: XmlElement = { tag, attrs, children: [] };
  // xml:space="preserve"면 공백만 있는 텍스트도 내용으로 본다.
  const preserveSpace = attrs['xml:space'] === 'preserve';
  let textBuffer = '';

  for (;;) {
    if (cursor.done) {
      throw new SyntaxError(`XML: <${tag}>가 닫히지 않았다`);
    }
    if (cursor.startsWith('</')) {
      cursor.index += 2;
      const closing = readName(cursor);
      if (closing !== tag) {
        throw new SyntaxError(`XML: <${tag}>를 </${closing}>로 닫았다`);
      }
      cursor.skipWhitespace();
      cursor.expect('>');
      break;
    }
    if (cursor.startsWith('<!--')) {
      cursor.index += 4;
      cursor.readUntil('-->');
      cursor.index += 3;
      continue;
    }
    if (cursor.startsWith('<![CDATA[')) {
      cursor.index += 9;
      textBuffer += cursor.readUntil(']]>');
      cursor.index += 3;
      continue;
    }
    if (cursor.peek() === '<') {
      element.children.push(parseElement(cursor));
      continue;
    }
    textBuffer += decodeEntities(cursor.readUntil('<'));
  }

  if (element.children.length === 0) {
    if (preserveSpace || textBuffer.trim() !== '') {
      element.text = textBuffer;
    }
  }
  return element;
}

export function parseXml(source: string): XmlDocument {
  const cursor = new Cursor(source);
  cursor.skipWhitespace();

  let declaration: string | undefined;
  if (cursor.startsWith('<?xml')) {
    const start = cursor.index;
    cursor.readUntil('?>');
    cursor.index += 2;
    declaration = cursor.source.slice(start, cursor.index);
  }

  // DOCTYPE과 처리 명령은 건너뛴다. OOXML 스프레드시트 파트는 이것들을 쓰지 않는다.
  for (;;) {
    cursor.skipWhitespace();
    if (cursor.startsWith('<!--')) {
      cursor.index += 4;
      cursor.readUntil('-->');
      cursor.index += 3;
      continue;
    }
    if (cursor.startsWith('<?') || cursor.startsWith('<!')) {
      cursor.readUntil('>');
      cursor.index += 1;
      continue;
    }
    break;
  }

  const root = parseElement(cursor);
  return declaration === undefined ? { root } : { declaration, root };
}

// ---------------------------------------------------------------------------
// 직렬화
// ---------------------------------------------------------------------------

export function serializeElement(element: XmlElement): string {
  const attrs = Object.entries(element.attrs)
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join('');

  if (element.children.length === 0 && element.text === undefined) {
    return `<${element.tag}${attrs}/>`;
  }

  const body =
    element.children.length > 0
      ? element.children.map(serializeElement).join('')
      : escapeXmlText(element.text ?? '');

  return `<${element.tag}${attrs}>${body}</${element.tag}>`;
}

export function serializeXml(doc: XmlDocument): string {
  return (doc.declaration ?? '') + serializeElement(doc.root);
}

// ---------------------------------------------------------------------------
// 탐색 도우미
// ---------------------------------------------------------------------------

export function findChild(parent: XmlElement, tag: string): XmlElement | undefined {
  return parent.children.find((c) => c.tag === tag);
}

export function findChildren(parent: XmlElement, tag: string): XmlElement[] {
  return parent.children.filter((c) => c.tag === tag);
}

/** `a/b/c` 경로로 첫 번째 자손을 찾는다. */
export function findPath(root: XmlElement, path: string): XmlElement | undefined {
  let current: XmlElement | undefined = root;
  for (const tag of path.split('/')) {
    if (current === undefined) return undefined;
    current = findChild(current, tag);
  }
  return current;
}

export function element(
  tag: string,
  attrs: Record<string, string | undefined> = {},
  children: XmlElement[] = [],
): XmlElement {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) clean[k] = v;
  }
  return { tag, attrs: clean, children };
}

export function textElement(
  tag: string,
  text: string,
  attrs: Record<string, string | undefined> = {},
): XmlElement {
  const el = element(tag, attrs);
  el.text = text;
  return el;
}
