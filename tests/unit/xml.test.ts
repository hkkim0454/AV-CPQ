import { describe, it, expect } from 'vitest';
import {
  parseXml,
  serializeXml,
  escapeXmlText,
  escapeXmlAttr,
  findChild,
  findChildren,
  type XmlElement,
} from '@/export/ooxml/xml';

/**
 * 설계서 §9.1: "문자열 정규식 치환만으로 수식과 XML을 수정하지 않는다."
 * OOXML을 다루는 모든 코드는 이 파서를 거친다.
 */
describe('parseXml', () => {
  it('선언과 루트 요소를 읽는다', () => {
    const doc = parseXml('<?xml version="1.0" encoding="UTF-8"?><root/>');
    expect(doc.declaration).toContain('version="1.0"');
    expect(doc.root.tag).toBe('root');
    expect(doc.root.children).toEqual([]);
  });

  it('속성을 읽는다 — 큰따옴표와 작은따옴표 모두', () => {
    const doc = parseXml(`<c r="A1" s='12' t="inlineStr"/>`);
    expect(doc.root.attrs).toEqual({ r: 'A1', s: '12', t: 'inlineStr' });
  });

  it('중첩 요소와 텍스트를 읽는다', () => {
    const doc = parseXml('<a><b>hello</b><c/></a>');
    expect(doc.root.children).toHaveLength(2);
    const b = doc.root.children[0] as XmlElement;
    expect(b.tag).toBe('b');
    expect(b.text).toBe('hello');
  });

  it('XML 엔티티를 디코드한다', () => {
    const doc = parseXml('<v>&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;</v>');
    expect(doc.root.text).toBe(`<a> & "b" 'c'`);
  });

  it('숫자 참조를 디코드한다', () => {
    const doc = parseXml('<v>&#54620;&#x AC00;</v>'.replace('&#x AC00;', '&#xAC00;'));
    expect(doc.root.text).toBe('한가');
  });

  it('주석을 건너뛴다', () => {
    const doc = parseXml('<a><!-- 주석 --><b/></a>');
    expect(doc.root.children).toHaveLength(1);
  });

  it('공백만 있는 텍스트 노드로 요소를 오염시키지 않는다', () => {
    const doc = parseXml('<a>\n  <b/>\n</a>');
    expect(doc.root.children).toHaveLength(1);
  });

  it('xml:space="preserve" 요소의 공백은 보존한다', () => {
    const doc = parseXml('<t xml:space="preserve">  규   격  </t>');
    expect(doc.root.text).toBe('  규   격  ');
  });

  it('닫는 태그가 맞지 않으면 던진다', () => {
    expect(() => parseXml('<a><b></a></b>')).toThrow();
  });

  it('한글 요소 내용을 그대로 읽는다', () => {
    const doc = parseXml('<t>월컨트롤 시스템</t>');
    expect(doc.root.text).toBe('월컨트롤 시스템');
  });
});

describe('serializeXml', () => {
  it('왕복해도 구조가 보존된다', () => {
    const src = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a x="1"><b>t</b><c/></a>';
    const out = serializeXml(parseXml(src));
    expect(out).toBe(src);
  });

  it('텍스트의 특수문자를 이스케이프한다', () => {
    const doc = parseXml('<v/>');
    doc.root.text = 'a < b & c > d';
    expect(serializeXml(doc)).toContain('a &lt; b &amp; c &gt; d');
  });

  it('속성의 큰따옴표를 이스케이프한다', () => {
    const doc = parseXml('<c/>');
    doc.root.attrs['r'] = 'say "hi" & <bye>';
    expect(serializeXml(doc)).toContain('r="say &quot;hi&quot; &amp; &lt;bye&gt;"');
  });

  it('수식에 들어가는 꺾쇠와 앰퍼샌드를 안전하게 내보낸다', () => {
    // 한글 금액 수식에 & 가 들어간다: ="일금"&NUMBERSTRING(H18,1)&"원정…"
    expect(escapeXmlText('="일금"&NUMBERSTRING(H18,1)')).toBe(
      '=&quot;일금&quot;&amp;NUMBERSTRING(H18,1)'.replace(/&quot;/g, '"'),
    );
  });
});

describe('escapeXmlAttr / escapeXmlText', () => {
  it('텍스트는 < > & 만 이스케이프한다', () => {
    expect(escapeXmlText('a<b>c&d"e')).toBe('a&lt;b&gt;c&amp;d"e');
  });

  it('속성은 큰따옴표까지 이스케이프한다', () => {
    expect(escapeXmlAttr('a<b>c&d"e')).toBe('a&lt;b&gt;c&amp;d&quot;e');
  });
});

describe('findChild / findChildren', () => {
  it('태그 이름으로 자식을 찾는다', () => {
    const doc = parseXml('<ws><cols><col min="1"/><col min="2"/></cols><sheetData/></ws>');
    const cols = findChild(doc.root, 'cols');
    expect(cols).toBeDefined();
    expect(findChildren(cols!, 'col')).toHaveLength(2);
    expect(findChild(doc.root, 'nope')).toBeUndefined();
  });
});
