"""给审计工作台的 Excel 台账：全局索引 + 每家台账（工作台可直接读表）。"""
import os, sys, json
sys.path.insert(0,".")
import openpyxl
from openpyxl.styles import Font
from auditfill.store import connect

OUT="out/工作台导出"; os.makedirs(OUT,exist_ok=True)
con=connect("data/audit.db")
companies=[dict(r) for r in con.execute("SELECT id,name,period,tb_file,fs_file,voucher_file FROM company ORDER BY id")]

def cnt(cid, w):
    return con.execute("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND "+w,(cid,)).fetchone()[0]

# ---------- 全局台账 ----------
wb=openpyxl.Workbook(); ws=wb.active; ws.title="公司汇总"
ws.append(["公司","期间","科目数","填写格","勾稽一致","实质差异","列报差异","报表无此行","待取证","底稿包","公司报告"])
for c in companies:
    cid=c["id"]
    ws.append([c["name"],c["period"],
               con.execute("SELECT COUNT(*) FROM account WHERE company_id=?",(cid,)).fetchone()[0],
               con.execute("SELECT COUNT(*) FROM fill WHERE company_id=?",(cid,)).fetchone()[0],
               cnt(cid,"diff=0"),
               cnt(cid,"diff IS NOT NULL AND ABS(diff)>0.01 AND COALESCE(cause,'') NOT LIKE '%列报%'"),
               cnt(cid,"diff IS NOT NULL AND ABS(diff)>0.01 AND cause LIKE '%列报%'"),
               cnt(cid,"diff IS NULL"),
               con.execute("SELECT COUNT(*) FROM evidence WHERE company_id=?",(cid,)).fetchone()[0],
               f"out/{c['name']}/{c['name']}_底稿包.zip",
               f"out/公司报告/{c['name']}.md"])
for cell in ws[1]: cell.font=Font(bold=True)
ws.freeze_panes="A2"

ws2=wb.create_sheet("勾稽明细")
ws2.append(["公司","项目","底稿值","报表值","差异","原因"])
for c in companies:
    for r in con.execute("SELECT line,calc,fs,diff,cause FROM audit_check WHERE company_id=? ORDER BY ABS(COALESCE(diff,0)) DESC",(c["id"],)):
        ws2.append([c["name"],r["line"],r["calc"],r["fs"],r["diff"],r["cause"]])
for cell in ws2[1]: cell.font=Font(bold=True)
ws2.freeze_panes="A2"

ws3=wb.create_sheet("待取证")
ws3.append(["公司","类型","事项","明细","需要资料"])
for c in companies:
    for r in con.execute("SELECT type,item,detail,doc FROM evidence WHERE company_id=?",(c["id"],)):
        ws3.append([c["name"],r["type"],r["item"],r["detail"],r["doc"]])
for cell in ws3[1]: cell.font=Font(bold=True)

ws4=wb.create_sheet("文件清单")
ws4.append(["公司","类型","文件名","大小KB","状态"])
for c in companies:
    for r in con.execute("SELECT kind,filename,size_kb,status FROM source WHERE company_id=? ORDER BY filename",(c["id"],)):
        ws4.append([c["name"],r["kind"],r["filename"],r["size_kb"],r["status"]])
for cell in ws4[1]: cell.font=Font(bold=True)

wb.save(os.path.join(OUT,"审计底稿台账.xlsx"))

# ---------- 每家台账 ----------
for c in companies:
    cid=c["id"]; d=os.path.join(OUT,c["name"]); os.makedirs(d,exist_ok=True)
    b=openpyxl.Workbook(); s=b.active; s.title="勾稽"
    s.append(["项目","底稿值","报表值","差异","原因"])
    for r in con.execute("SELECT line,calc,fs,diff,cause FROM audit_check WHERE company_id=? ORDER BY ABS(COALESCE(diff,0)) DESC",(cid,)):
        s.append([r["line"],r["calc"],r["fs"],r["diff"],r["cause"]])
    for cell in s[1]: cell.font=Font(bold=True)
    s2=b.create_sheet("填写记录")
    s2.append(["工作簿","工作表","单元格","值","依据"])
    for r in con.execute("SELECT workbook,sheet,cell,value,basis FROM fill WHERE company_id=? ORDER BY workbook,sheet,cell",(cid,)):
        s2.append([r["workbook"],r["sheet"],r["cell"],r["value"],r["basis"]])
    for cell in s2[1]: cell.font=Font(bold=True)
    s3=b.create_sheet("待取证")
    s3.append(["类型","事项","明细","需要资料"])
    for r in con.execute("SELECT type,item,detail,doc FROM evidence WHERE company_id=?",(cid,)):
        s3.append([r["type"],r["item"],r["detail"],r["doc"]])
    b.save(os.path.join(d,"底稿台账.xlsx"))
print("全局台账 +", len(companies), "家台账 已生成")
