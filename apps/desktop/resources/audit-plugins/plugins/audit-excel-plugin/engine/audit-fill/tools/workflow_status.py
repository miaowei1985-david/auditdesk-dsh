"""审计工作流状态：按每家当前数据推导所处阶段与下一步动作。

阶段（对齐审计流程）：
 1 资料接收   仅有原始文件、尚未填表
 2 底稿填制   已有填写记录
 3 勾稽核对   已有勾稽结果
 4 差异处理   存在实质差异
 5 出具备忘录 实质无差异、尚未生成备忘录
 6 复核       备忘录已生成
 7 归档       —（由人工确认）
"""
import json, os, sys
sys.path.insert(0,".")
from auditfill.store import connect

con=connect("data/audit.db")
out=[]
for r in con.execute("SELECT id,name,period FROM company ORDER BY id"):
    cid, name = r["id"], r["name"]
    def one(sql):
        x=con.execute(sql,(cid,)).fetchone(); return None if x is None else x[0]
    fills=one("SELECT COUNT(*) FROM fill WHERE company_id=?") or 0
    checks=one("SELECT COUNT(*) FROM audit_check WHERE company_id=?") or 0
    ok=one("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND diff=0") or 0
    sub=one("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND diff IS NOT NULL AND ABS(diff)>0.01 AND COALESCE(cause,'') NOT LIKE '%列报%'") or 0
    memo=os.path.exists(f"out/备忘录/{name}.md")
    review=con.execute("SELECT reviewer,reviewed_at FROM review WHERE company_id=? ORDER BY reviewed_at DESC LIMIT 1",(cid,)).fetchone()
    if fills==0: stage, action = 1, "解析资料并填制底稿（audit_fill_process）"
    elif checks==0: stage, action = 2, "执行勾稽核对（audit_fill_process 会一并返回）"
    elif sub>0: stage, action = 4, f"处理 {sub} 项实质差异（补资料/确认口径）"
    elif not memo: stage, action = 5, "生成审计备忘录（audit_memo）"
    elif review is None:
        stage, action = 6, "复核备忘录与底稿，确认后签字（audit_review）"
    else:
        stage, action = 7, f"已由 {review['reviewer']} 复核（{review['reviewed_at']}），可归档"
    out.append({"company":name,"stage":stage,"stage_name":["","资料接收","底稿填制","勾稽核对","差异处理","出具备忘录","复核","归档"][stage],
                "fills":fills,"checks":checks,"ok":ok,"substantive":sub,"memo":memo,"next":action})
print(json.dumps({"ok":True,"workflow":out}, ensure_ascii=False))
