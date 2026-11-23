"""审计工作台接入层：把「处理 Excel」的能力包装成可调用的函数 / CLI。

工作台调用方式（两种）：
  1. Python:  from auditfill.workbench import process_company
  2. CLI:     python -m auditfill.workbench --company 中天 --tb <xlsx> --fs <xlsx> --out <dir>

返回 JSON 结构（同时打印到 stdout）：
  {"ok": true, "company": "...", "workbooks": [...], "lines": [...], "outputs": {...}}
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _rc():
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import run_company  # noqa: E402

    return run_company


def process_company(company: str, tb: str, fs: str, voucher: str | None = None,
                    client: str | None = None, base_dir: str | None = None,
                    out_dir: str | None = None, template_dir: str | None = None) -> dict:
    """处理一家公司的 Excel 资料，生成底稿包，返回结构化结果。"""
    rc = _rc()
    if base_dir:
        rc.B = base_dir
    if template_dir:
        rc.T = template_dir
    rc.CASES[company] = (tb, fs, voucher, client or company)
    report = rc.run(company, out_dir=out_dir)
    return {
        "ok": True,
        "company": company,
        "workbooks": report.get("workbooks", []),
        "lines": report.get("lines", []),
        "cashflow": report.get("cashflow"),
        "outputs": {
            "package_dir": out_dir or f"out/{company}/底稿包",
            "master": os.path.join(os.path.dirname(out_dir or f"out/{company}/底稿包"), "01主底稿.xlsx"),
        },
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="审计工作台：Excel → 底稿")
    ap.add_argument("--company", required=True)
    ap.add_argument("--tb", required=True)
    ap.add_argument("--fs", required=True)
    ap.add_argument("--voucher", default=None)
    ap.add_argument("--client", default=None)
    ap.add_argument("--base-dir", default=None, help="资料根目录（相对路径按它解析）")
    ap.add_argument("--out", default=None, help="输出目录（默认 out/<company>/底稿包）")
    ap.add_argument("--template-dir", default=None)
    a = ap.parse_args(argv)
    try:
        res = process_company(a.company, a.tb, a.fs, a.voucher, a.client,
                              a.base_dir, a.out, a.template_dir)
    except Exception as e:  # 返回结构化错误，工作台可判断
        print(json.dumps({"ok": False, "company": a.company, "error": f"{type(e).__name__}: {e}"},
                         ensure_ascii=False))
        return 1
    print(json.dumps(res, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
