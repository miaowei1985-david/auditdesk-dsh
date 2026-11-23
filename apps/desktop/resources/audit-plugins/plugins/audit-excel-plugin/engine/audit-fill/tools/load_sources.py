"""把每家客户的原始资料清单装进数据库 source 表，便于按公司管理资料齐全度。"""
import os, sys
sys.path.insert(0,".")
from auditfill.store import connect, save_sources

B="/Users/macbook/Documents/审计底稿"
con=connect("data/audit.db")
for r in con.execute("SELECT id,name,tb_file,fs_file,voucher_file FROM company").fetchall():
    cid, name = r["id"], r["name"]
    used={os.path.basename(x) for x in (r["tb_file"], r["fs_file"], r["voucher_file"]) if x}
    d=os.path.join(B,name)
    rows=[]
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            p=os.path.join(d,f)
            if not os.path.isfile(p): continue
            ext=os.path.splitext(f)[1].lower().lstrip(".")
            kind={"xlsx":"Excel","xls":"Excel","xlsm":"Excel","csv":"CSV","pdf":"PDF","docx":"Word","doc":"Word"}.get(ext,"其他")
            status="已用于填表" if f in used else "备用/未使用"
            note=""
            if kind=="其他": status="未识别"; note="格式无法解析，需人工查看"
            rows.append({"kind":kind,"filename":f,"size_kb":os.path.getsize(p)//1024,
                         "status":status,"note":note})
    save_sources(con,cid,rows)
    print(f"{name}: {len(rows)} 个文件")
