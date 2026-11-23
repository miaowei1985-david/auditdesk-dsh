import subprocess, sys, json, os, glob
names=["中天","中延","丸金","同进","明璞","舜壹","维曼","乐线","安堡罗","赞富","统一能科","机施教育"]
res=[]
for n in names:
    r=subprocess.run([sys.executable,"tools/run_company.py",n],capture_output=True,text=True)
    line=[l for l in r.stdout.splitlines() if l.startswith(n+":")]
    res.append(line[0] if line else f"{n}: 失败 {r.stderr[-200:]}")
    print(res[-1], flush=True)
    subprocess.run([sys.executable,"tools/package.py",n],capture_output=True)
for f in ("tools/evidence_gaps.py","tools/coverage.py"):
    subprocess.run([sys.executable,f],capture_output=True)
json.dump(res,open("out/run_all.json","w"),ensure_ascii=False,indent=1)
