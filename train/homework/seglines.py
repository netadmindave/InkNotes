"""Split Samsung Notes pages into formula lines (and side-by-side groups) for labelling."""
import json, glob, sys, os
import numpy as np
from PIL import Image, ImageDraw

def boxes(strokes):
    out = []
    for s in strokes:
        p = np.array(s['p']); out.append((p[:,0].min(), p[:,1].min(), p[:,0].max(), p[:,1].max()))
    return out

def lines(strokes):
    b = boxes(strokes)
    hs = sorted(y1 - y0 for x0, y0, x1, y1 in b if y1 - y0 > 3)
    H = hs[len(hs)//2] if hs else 20            # typical character height
    # tall strokes (fraction bars are flat; integrals tall) anchor by centre; group by vertical overlap of centre bands
    order = sorted(range(len(b)), key=lambda i: (b[i][1] + b[i][3]) / 2)
    groups = []
    for i in order:
        cy = (b[i][1] + b[i][3]) / 2
        for g in groups:
            if g['y0'] - 0.6 * H <= cy <= g['y1'] + 0.6 * H:
                g['ids'].append(i); g['y0'] = min(g['y0'], b[i][1] if b[i][3]-b[i][1] < 3*H else cy); g['y1'] = max(g['y1'], b[i][3] if b[i][3]-b[i][1] < 3*H else cy); break
        else:
            groups.append({'ids': [i], 'y0': b[i][1] if b[i][3]-b[i][1] < 3*H else cy, 'y1': b[i][3] if b[i][3]-b[i][1] < 3*H else cy})
    # merge groups whose centres are very close (sub/superscripts started a separate band)
    groups.sort(key=lambda g: g['y0'])
    # split each band horizontally at big gaps
    out = []
    for g in groups:
        ids = sorted(g['ids'], key=lambda i: b[i][0])
        cur, right = [], -1e9
        for i in ids:
            if cur and b[i][0] - right > 3.0 * H:
                out.append(cur); cur = []
            cur.append(i); right = max(right, b[i][2])
        if cur: out.append(cur)
    return out, H

def render(strokes, ids, path, pad=10, scale=0.5):
    b = boxes([strokes[i] for i in ids])
    x0 = min(q[0] for q in b) - pad; y0 = min(q[1] for q in b) - pad
    x1 = max(q[2] for q in b) + pad; y1 = max(q[3] for q in b) + pad
    im = Image.new('L', (int((x1-x0)*scale)+1, int((y1-y0)*scale)+1), 255); dr = ImageDraw.Draw(im)
    for i in ids:
        pts = [((x-x0)*scale, (y-y0)*scale) for x, y in strokes[i]['p']]
        if len(pts) > 1: dr.line(pts, fill=0, width=2)
        else: dr.point(pts, fill=0)
    im.save(path)

if __name__ == '__main__':
    res = []
    for f in sorted(glob.glob('/home/claude/sd/in/*.json')):
        name = os.path.basename(f)[9:-5]
        d = json.load(open(f))
        for pi, p in enumerate(d['pages']):
            st = [s for s in p['strokes'] if s['p']]
            if not st: continue
            ls, H = lines(st)
            for li, ids in enumerate(ls):
                key = f'{name}-p{pi}-l{li:02d}'
                render(st, ids, f'/home/claude/sd/lines/{key}.png')
                res.append({'key': key, 'strokes': [st[i]['p'] for i in sorted(ids, key=lambda i: st[i]['t'] or 0)]})
    json.dump(res, open('/home/claude/sd/lines.json', 'w'))
    print(len(res), 'line groups')
