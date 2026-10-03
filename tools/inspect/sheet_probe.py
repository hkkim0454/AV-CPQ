"""시트별 구조/수식 조사. 숫자 값은 <num> 으로 마스킹. 읽기 전용."""
import sys, io, zipfile
from xml.etree import ElementTree as ET
sys.path.insert(0, 'tools/inspect')
from ooxml_probe import Book, q, MAIN, NS, col_of, row_of

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


def dump_sheet(b, meta, max_row=None):
    xml = b.z.read(meta['part'])
    root = ET.fromstring(xml)
    name = meta['name']
    print('\n' + '=' * 78)
    print(f"SHEET [{name}]  state={meta['state']}  part={meta['part']}")
    print('=' * 78)

    dim = root.find(q('dimension'))
    print('dimension :', dim.get('ref') if dim is not None else '?')

    sfv = root.find(q('sheetViews'))
    if sfv is not None:
        for v in sfv.iter(q('sheetView')):
            print('sheetView : zoom=%s showGrid=%s' % (v.get('zoomScale'), v.get('showGridLines')))
            for p in v.iter(q('pane')):
                print('   pane   : xSplit=%s ySplit=%s topLeft=%s state=%s' % (
                    p.get('xSplit'), p.get('ySplit'), p.get('topLeftCell'), p.get('state')))

    fmt = root.find(q('sheetFormatPr'))
    if fmt is not None:
        print('formatPr  : defaultRowHeight=%s defaultColWidth=%s' % (
            fmt.get('defaultRowHeight'), fmt.get('defaultColWidth')))

    cols = root.find(q('cols'))
    if cols is not None:
        print('--- COLS ---')
        for c in cols.findall(q('col')):
            print('   min=%-3s max=%-3s width=%-10s custom=%s hidden=%s' % (
                c.get('min'), c.get('max'), c.get('width'),
                c.get('customWidth'), c.get('hidden')))

    mc = root.find(q('mergeCells'))
    merges = [m.get('ref') for m in mc] if mc is not None else []
    print(f'--- MERGES ({len(merges)}) ---')
    print('   ' + ', '.join(merges))

    ps = root.find(q('pageSetup'))
    if ps is not None:
        print('pageSetup : orient=%s paperSize=%s scale=%s fitToW=%s fitToH=%s hdpi=%s' % (
            ps.get('orientation'), ps.get('paperSize'), ps.get('scale'),
            ps.get('fitToWidth'), ps.get('fitToHeight'), ps.get('horizontalDpi')))
    pm = root.find(q('pageMargins'))
    if pm is not None:
        print('margins   : ' + ' '.join(f'{k}={pm.get(k)}' for k in
              ('left', 'right', 'top', 'bottom', 'header', 'footer')))
    sp = root.find(q('sheetPr'))
    if sp is not None:
        pgs = sp.find(q('pageSetUpPr'))
        print('sheetPr   : fitToPage=%s' % (pgs.get('fitToPage') if pgs is not None else None))
    hf = root.find(q('headerFooter'))
    if hf is not None:
        for t in hf:
            print('  hf %s: %r' % (t.tag.split('}')[-1], (t.text or '')[:80]))
    for brk in ('rowBreaks', 'colBreaks'):
        bn = root.find(q(brk))
        if bn is not None:
            print(f'{brk}: count={bn.get("count")} ' + ', '.join(
                x.get('id') for x in bn))

    print('--- ROWS (ht / hidden) + CELLS ---')
    sd = root.find(q('sheetData'))
    for row in sd.findall(q('row')):
        rn = int(row.get('r'))
        if max_row and rn > max_row:
            break
        ht = row.get('ht'); hid = row.get('hidden')
        cells = []
        for c in row.findall(q('c')):
            ref = c.get('r')
            f = c.find(q('f'))
            s = c.get('s')
            if f is not None:
                ftxt = f.text or ''
                extra = ''
                if f.get('t'):
                    extra = f"[{f.get('t')}{':' + f.get('ref') if f.get('ref') else ''}]"
                cells.append(f'{ref}{{s{s}}}={extra}={ftxt}')
            else:
                v = b.cell_text(c)
                if v != '':
                    cells.append(f'{ref}{{s{s}}}:{v}')
        hdr = f'  r{rn:<3} ht={ht or "-":<6}{" HIDDEN" if hid else ""}'
        if cells:
            print(hdr)
            for ch in cells:
                print('        ', ch)
        elif ht or hid:
            print(hdr)


if __name__ == '__main__':
    b = Book(sys.argv[1])
    want = sys.argv[2] if len(sys.argv) > 2 else None
    for meta in b.sheets():
        if want and want != meta['name'].strip():
            continue
        dump_sheet(b, meta)
