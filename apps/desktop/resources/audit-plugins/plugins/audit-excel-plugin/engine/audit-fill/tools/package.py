"""把一家公司的全部产出打包成 zip，便于交付。"""
import os, sys, zipfile, glob, json

def package(company):
    base=f"out/{company}"
    files=[]
    d=f"{base}/底稿包"
    if os.path.isdir(d):
        files += [p for p in glob.glob(f"{d}/*") if not p.endswith(".json")]
    for name in ("01主底稿.xlsx",):
        p=f"{base}/{name}"
        if os.path.exists(p): files.append(p)
    rep=f"out/公司报告/{company}.md"
    if not files:
        return None
    out=f"{base}/{company}_底稿包.zip"
    with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, arcname=os.path.basename(p))
        rep=f"{base}/底稿包/校验报告.json"
        if os.path.exists(rep): z.write(rep, arcname="校验报告.json")
        cr=f"out/公司报告/{company}.md"
        if os.path.exists(cr): z.write(cr, arcname=f"{company}_报告.md")
    return out, len(files)

if __name__=="__main__":
    names=sys.argv[1:] or ["中天","中延","丸金","同进","明璞","舜壹","维曼","乐线","安堡罗","赞富"]
    for n in names:
        r=package(n)
        print(n, r)
