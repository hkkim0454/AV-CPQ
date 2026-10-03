"""
읽기 전용 OOXML 구조 조사기 (설계서 4.5 / 9.6).

원칙:
- 원본 파일을 절대 수정하지 않는다 (ZIP을 'r' 모드로만 연다).
- 숫자 셀 값은 출력하지 않는다. 금액 유출 방지를 위해 <num> 으로 마스킹한다.
- 구조·수식·서식 메타데이터만 보고한다.
"""
import sys, zipfile, re
from xml.etree import ElementTree as ET

NS = {
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
MAIN = NS['m']


def q(tag):
    return f'{{{MAIN}}}{tag}'


def col_of(ref):
    m = re.match(r'([A-Z]+)', ref or '')
    return m.group(1) if m else ''


def row_of(ref):
    m = re.search(r'(\d+)$', ref or '')
    return int(m.group(1)) if m else 0


class Book:
    def __init__(self, path):
        self.path = path
        self.z = zipfile.ZipFile(path, 'r')   # 읽기 전용
        self.names = self.z.namelist()
        self._wb = ET.fromstring(self.z.read('xl/workbook.xml'))
        self._rels = self._read_rels('xl/_rels/workbook.xml.rels')
        self.shared = self._read_shared()

    def _read_rels(self, part):
        out = {}
        if part not in self.names:
            return out
        root = ET.fromstring(self.z.read(part))
        for rel in root:
            out[rel.get('Id')] = (rel.get('Target'), rel.get('Type', '').rsplit('/', 1)[-1])
        return out

    def _read_shared(self):
        p = 'xl/sharedStrings.xml'
        if p not in self.names:
            return []
        root = ET.fromstring(self.z.read(p))
        vals = []
        for si in root.findall(q('si')):
            vals.append(''.join(t.text or '' for t in si.iter(q('t'))))
        return vals

    def sheets(self):
        out = []
        for sh in self._wb.find(q('sheets')):
            rid = sh.get(f"{{{NS['r']}}}id")
            target, _ = self._rels.get(rid, (None, None))
            if target and not target.startswith('/'):
                target = 'xl/' + target.lstrip('/')
            out.append({
                'name': sh.get('name'),
                'sheetId': sh.get('sheetId'),
                'state': sh.get('state', 'visible'),
                'part': target,
            })
        return out

    def defined_names(self):
        dn = self._wb.find(q('definedNames'))
        if dn is None:
            return []
        return [(d.get('name'), d.get('localSheetId'), (d.text or '')) for d in dn]

    def cell_text(self, c):
        t = c.get('t')
        v = c.find(q('v'))
        if t == 's' and v is not None:
            try:
                return self.shared[int(v.text)]
            except (ValueError, IndexError):
                return '<s?>'
        if t in ('str', 'inlineStr'):
            isn = c.find(q('is'))
            if isn is not None:
                return ''.join(x.text or '' for x in isn.iter(q('t')))
            return v.text if v is not None else ''
        if t == 'e':
            return f'<err:{v.text if v is not None else "?"}>'
        if v is not None:
            return '<num>'          # 금액 마스킹
        return ''


def probe(path, show_sheets=None, max_rows=200):
    b = Book(path)
    print('=' * 78)
    print('FILE :', path.rsplit('/', 1)[-1])
    print('PARTS:', len(b.names))
    print('=' * 78)

    print('\n--- ZIP PART INVENTORY (9.6 감사 대상) ---')
    for n in sorted(b.names):
        print(f'  {n}  [{b.z.getinfo(n).file_size}B]')

    print('\n--- SHEETS ---')
    for s in b.sheets():
        print(f"  {s['sheetId']:>3} state={s['state']:<9} part={s['part']}")
        print(f"      name=[{s['name']}]  (len={len(s['name'])}, trailing_space={s['name'] != s['name'].rstrip()})")

    dns = b.defined_names()
    print(f'\n--- DEFINED NAMES ({len(dns)}) ---')
    broken = [d for d in dns if '#REF' in d[2]]
    print(f'  broken(#REF): {len(broken)}')
    for name, loc, val in dns[:40]:
        flag = ' <<BROKEN' if '#REF' in val else ''
        print(f'  {name}  local={loc}  -> {val[:80]}{flag}')
    if len(dns) > 40:
        print(f'  ... (+{len(dns)-40} more)')

    ext = [n for n in b.names if 'externalLink' in n]
    print(f'\n--- EXTERNAL LINKS ({len(ext)}) ---')
    for n in ext:
        print('  ', n)
        if n.endswith('.rels'):
            root = ET.fromstring(b.z.read(n))
            for rel in root:
                print('       ->', rel.get('Target'), '|', rel.get('TargetMode'))

    for extra in ('docProps/custom.xml', 'docProps/core.xml', 'docProps/app.xml'):
        if extra in b.names:
            txt = b.z.read(extra).decode('utf-8', 'replace')
            print(f'\n--- {extra} ({len(txt)}B) ---')
            print('  ', txt[:600].replace('\n', ' '))

    cmts = [n for n in b.names if 'comment' in n.lower()]
    print(f'\n--- COMMENT PARTS ({len(cmts)}) ---')
    for n in cmts:
        print('  ', n)

    return b


if __name__ == '__main__':
    probe(sys.argv[1])
