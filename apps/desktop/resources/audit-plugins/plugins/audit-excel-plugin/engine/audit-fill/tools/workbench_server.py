"""审计工作台 HTTP 接入层（标准库，无额外依赖）。

启动：
    python3 tools/workbench_server.py --port 8801
接口：
    GET  /health              → {"ok": true, "version": "..."}
    GET  /companies           → 已登记公司列表
    POST /process             → {"company","tb","fs","voucher","base_dir","out"}，返回结果 JSON
    POST /batch               → {"base_dir": "...", "companies": ["中天", ...]}（可选）
"""
import argparse, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from auditfill.workbench import process_company  # noqa: E402

DEFAULT_BASE = "/Users/macbook/Documents/审计底稿"


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            return self._send(200, {"ok": True, "version": "audit-fill/0.1"})
        if self.path.rstrip("/") == "/companies":
            try:
                sys.path.insert(0, os.path.join(ROOT, "tools"))
                import run_company
                return self._send(200, {"ok": True, "companies": sorted(run_company.CASES)})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
        return self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            return self._send(400, {"ok": False, "error": f"bad json: {e}"})
        if self.path.rstrip("/") == "/process":
            try:
                res = process_company(
                    company=data["company"], tb=data["tb"], fs=data["fs"],
                    voucher=data.get("voucher"), base_dir=data.get("base_dir", DEFAULT_BASE),
                    out_dir=data.get("out"), template_dir=data.get("template_dir"))
                return self._send(200, res)
            except KeyError as e:
                return self._send(400, {"ok": False, "error": f"missing field {e}"})
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})
        return self._send(404, {"ok": False, "error": "not found"})

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8801)
    a = ap.parse_args()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"audit-fill workbench service on http://{a.host}:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
