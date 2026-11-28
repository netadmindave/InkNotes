import json
def is_check(s, others, H):
    xs=[p[0] for p in s]; ys=[p[1] for p in s]
    ox1=max(max(p[0] for p in o) for o in others)
    if min(xs) < ox1 - 0.5*H: return False
    h=max(ys)-min(ys)
    if h < 0.5*H: return False
    k=ys.index(max(ys))            # lowest point on screen
    return 0 < k < len(ys)-1 and (ys[k]-ys[-1]) > 0.4*h and (xs[-1]-xs[0]) > 0
def clean(line):
    idx=line['idx']; st=line['strokes']
    order=sorted(range(len(idx)),key=lambda k: idx[k])
    runs=[[order[0]]]
    for k in order[1:]:
        if idx[k]-idx[runs[-1][-1]]>15: runs.append([k])
        else: runs[-1].append(k)
    drop=set()
    if len(runs)>1:
        main=max(runs,key=len)
        hs=sorted(max(p[1] for p in s)-min(p[1] for p in s) for s in st); H=hs[len(hs)//2] or 1
        for r in runs:
            if r is not main and len(r)==1:
                others=[st[k] for k in range(len(st)) if k!=r[0]]
                if is_check(st[r[0]],others,H): drop.add(r[0])
    return [s for k,s in enumerate(st) if k not in drop], len(drop)
if __name__=='__main__':
    L=json.load(open('lines2.json'))
    labels={int(l.split('\t')[0]) for l in open('labels.tsv')}
    print([i for i in sorted(labels) if clean(L[i])[1]])
