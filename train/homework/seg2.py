import sys,json,glob,os,re,numpy as np
sys.path.insert(0,'/home/claude/inknotes/train');sys.path.insert(0,'/home/claude/sd')
import inkmath as im,onnxruntime as ort
from seglines import render
v=im.Vocab.load('/home/claude/model1/x/vocab.json');s=ort.InferenceSession('/home/claude/model1/x/inkmath.onnx')
res=[]
for f in sorted(glob.glob('in2/*.json')):
    base=os.path.basename(f)[9:-5]
    name=re.sub(r'_\d{6}_\d{6}$','',base).replace('David_Smith','').replace('DavidSmith','').strip('_- ') or 'Notes'
    name=(name+'_'+base[-13:-7]).replace(' ','')
    d=json.load(open(f)); L=json.load(open(f[:-5]+'.lines'))
    for pi,(p,groups) in enumerate(zip(d['pages'],L)):
        st=p['strokes']
        hs=sorted(max(q[1] for q in x['p'])-min(q[1] for q in x['p']) for x in st if x['p']) or [20]
        H=hs[len(hs)//2]
        for li,g in enumerate(groups):
            bb={i:(min(q[0] for q in st[i]['p']),max(q[0] for q in st[i]['p'])) for i in g}
            ids=sorted(g,key=lambda i:bb[i][0]); parts=[];cur=[];right=-1e9
            for i in ids:
                if cur and bb[i][0]-right>4*H: parts.append(cur);cur=[]
                cur.append(i);right=max(right,bb[i][1])
            parts.append(cur)
            for k,part in enumerate(parts):
                key=f'{name}-p{pi}-l{li:02d}{"abcdefghij"[k]}'
                part=sorted(part,key=lambda i:st[i]['t'] or 0)
                pass
                arr=[np.array(st[i]['p'],dtype=np.float64).reshape(-1,2) for i in part]
                lp=s.run(None,{'x':im.features(im.coarse(arr))[None]})[0][0]
                t,c=im.ctc_greedy(lp,v)
                res.append({'key':key,'idx':part,'strokes':[st[i]['p'] for i in part],'tex':im.join(t),'conf':round(c,3)})
json.dump(res,open('lines2.json','w'))
print(len(res),'lines')
from collections import Counter
for k,n in Counter(r['key'].rsplit('-p',1)[0] for r in res).items(): print(n,k)
