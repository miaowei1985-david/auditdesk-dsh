"""Client chart of accounts → standard CAS subject mapping.

Client code systems are inconsistent: 4-digit CAS (1002), 3-digit pre-2007
(102), 6-9 digit sub-accounts, dimension codes, or no codes at all (a Taiwan
style trial balance with only Chinese/English names).  Codes are therefore a
hint; the account *name* decides.
"""
from __future__ import annotations

import re

# (canonical code, fs line, aliases) — longest alias wins
CHART: list[tuple[str, str, tuple[str, ...]]] = [
    ("1001", "货币资金", ("库存现金", "现金")),
    ("1002", "货币资金", ("银行存款",)),
    ("1012", "货币资金", ("其他货币资金", "其他货币資金")),
    ("1101", "交易性金融资产", ("交易性金融资产", "短期投资")),
    ("1121", "应收票据", ("应收票据",)),
    ("1122", "应收账款", ("应收账款", "应收帐款", "accounts receivable", "trade receivable")),
    ("1123", "预付款项", ("预付款项", "预付账款", "预付帐款", "prepayment", "prepaid")),
    ("1131", "应收股利", ("应收股利",)),
    ("1132", "应收利息", ("应收利息",)),
    ("1221", "其他应收款", ("其他应收款", "other receivable", "suspense payment",
                              "long-term loan", "long-term loans", "refundable deposit")),
    ("1231", "应收账款", ("坏账准备", "坏帐准备")),
    ("1401", "存货", ("材料采购",)),
    ("1402", "存货", ("在途物资",)),
    ("1403", "存货", ("原材料", "材料")),
    ("1405", "存货", ("库存商品", "产成品", "商品", "inventory", "stock")),
    ("1406", "存货", ("发出商品",)),
    ("1408", "存货", ("委托加工物资",)),
    ("1411", "存货", ("周转材料", "包装物", "低值易耗品")),
    ("1471", "存货", ("存货跌价准备",)),
    ("1501", "长期股权投资", ("长期股权投资", "长期投资")),
    ("1503", "债权投资", ("持有至到期投资", "债权投资", "可供出售金融资产")),
    ("1601", "固定资产", ("固定资产",)),
    ("1602", "固定资产", ("累计折旧",)),
    ("1603", "固定资产", ("固定资产减值准备",)),
    ("1604", "在建工程", ("在建工程",)),
    ("1606", "固定资产", ("固定资产清理",)),
    ("1701", "无形资产", ("无形资产",)),
    ("1702", "无形资产", ("累计摊销",)),
    ("1801", "长期待摊费用", ("长期待摊费用", "递延资产", "开办费", "待摊费用",
                              "long-term prepaid", "long-term prepaid expenses")),
    ("1605", "使用权资产", ("使用权资产",)),
    ("2601", "租赁负债", ("租赁负债", "租赁负债未确认融资费用")),
    ("1811", "递延所得税资产", ("递延所得税资产", "递延税款借项")),
    ("1901", "其他流动资产", ("待处理财产损溢", "待处理流动资产净损失")),
    ("2001", "短期借款", ("短期借款",)),
    ("2201", "应付票据", ("应付票据",)),
    ("2202", "应付账款", ("应付账款", "应付帐款", "accounts payable", "trade payable")),
    ("2203", "预收款项", ("预收款项", "预收账款", "预收帐款", "advance from customer", "advances from customer", "contract liability")),
    ("2211", "应付职工薪酬", ("应付职工薪酬", "应付工资", "应付福利费")),
    ("2221", "应交税费", ("应交税费", "应交税金", "未交税金", "未交增值税", "应交增值税")),
    ("2231", "应付股利", ("应付股利", "应付利润", "未付利润", "应付利息")),
    ("2241", "其他应付款", ("其他应付款", "其他未交款", "other payable", "non-trade payable")),
    ("2501", "长期借款", ("长期借款",)),
    ("2701", "长期应付款", ("长期应付款",)),
    ("4001", "实收资本", ("实收资本", "股本", "开办资金")),
    ("5401", "合同履约成本", ("工程施工", "合同履约成本")),
    ("5402", "合同结算", ("工程结算",)),
    ("4002", "资本公积", ("资本公积",)),
    ("4101", "盈余公积", ("盈余公积",)),
    ("4103", "未分配利润", ("本年利润",)),
    ("4104", "未分配利润", ("利润分配", "未分配利润", "历年结余", "非限定性净资产", "限定性净资产")),
    ("5001", "营业成本", ("生产成本", "制造费用", "劳务成本")),
    ("6001", "营业收入", ("主营业务收入", "营业收入", "sales", "revenue")),
    ("6051", "营业收入", ("其他业务收入",)),
    ("6401", "营业成本", ("主营业务成本", "营业成本", "cost of sales", "cost of revenue")),
    ("6402", "营业成本", ("其他业务成本", "其他业务支出")),
    ("6403", "税金及附加", ("税金及附加", "主营业务税金及附加", "营业税金及附加")),
    ("6601", "销售费用", ("销售费用", "营业费用")),
    ("6602", "管理费用", ("管理费用",)),
    ("6603", "财务费用", ("财务费用",)),
    ("6111", "投资收益", ("投资收益",)),
    ("6301", "营业外收入", ("营业外收入", "补贴收入")),
    ("6711", "营业外支出", ("营业外支出",)),
    ("6801", "所得税费用", ("所得税费用", "所得税")),
    ("6901", "净利润", ("以前年度损益调整",)),
]

# legacy 3-digit codes (pre-2007 企业会计制度)
LEGACY_CODES = {
    "101": "1001", "102": "1002", "109": "1012", "111": "1101", "112": "1121",
    "113": "1122", "114": "1231", "115": "1123", "119": "1221", "121": "1401",
    "123": "1403", "124": "1405", "128": "1408", "131": "1801", "141": "1501",
    "151": "1601", "155": "1602", "161": "1604", "171": "1701", "181": "1801",
    "201": "2001", "202": "2201", "203": "2202", "204": "2203", "211": "2211",
    "214": "2211", "221": "2221", "223": "2231", "229": "2241", "231": "2241",
    "241": "2501", "301": "4001", "311": "4002", "313": "4101", "321": "4103",
    "322": "4104", "501": "6001", "502": "6401", "503": "6601", "504": "6403",
    "511": "6051", "512": "6402", "521": "6602", "522": "6603", "531": "6111",
    "541": "6301", "542": "6711", "550": "6801",
}


TRAD = str.maketrans({
    "帳": "账", "帐": "账", "貸": "贷", "餘": "余", "額": "额", "變": "变", "動": "动", "帳": "账",
    "結": "结", "現": "现", "銀": "银", "資": "资", "負": "负", "債": "债",
    "幣": "币", "匯": "汇", "費": "费", "務": "务", "營": "营", "業": "业",
    "稅": "税", "應": "应", "預": "预", "項": "项", "單": "单", "總": "总",
    "計": "计", "萬": "万", "開": "开", "關": "关", "聯": "联", "產": "产",
    "權": "权", "益": "益", "潤": "润", "損": "损", "攤": "摊", "銷": "销",
    "購": "购", "貨": "货", "價": "价", "準": "准", "備": "备", "處": "处",
    "淨": "净", "長": "长",
})


def to_simplified(text: str) -> str:
    return str(text or "").translate(TRAD)


def normalize(name: str) -> str:
    t = to_simplified(name)
    t = re.sub(r"[\s\u3000]+", "", t)
    t = re.sub(r"[（(].*?[)）]", "", t)
    t = re.sub(r"^(其中|减)[:：]?", "", t)
    return t.lower()


ALIAS_INDEX = sorted(
    ((normalize(alias), code, line) for code, line, aliases in CHART for alias in aliases),
    key=lambda x: -len(x[0]),
)


def by_name(name: str) -> tuple[str, str] | None:
    n = normalize(name)
    if not n:
        return None
    # "固定资产进项税" is a VAT input account, not a fixed asset
    if "进项税" in n:
        return "2221", "应交税费"
    best, best_score = None, -1
    for alias, code, line in ALIAS_INDEX:
        # alias must appear inside the account name, never the reverse: a
        # account called "其他" must not match "其他货币资金".
        if alias not in n:
            continue
        if n == alias:
            score = 4
        elif n.startswith(alias):
            score = 3          # "坏账准备_应收账款坏账准备" -> 坏账准备, not 应收账款
        elif n.split("_")[0].endswith(alias):
            score = 2
        else:
            score = 1
        if score > best_score:
            best, best_score = (code, line), score
    return best


def by_code(code: str) -> str | None:
    c = str(code or "").strip()
    if not c:
        return None
    head = c.split(".")[0].split("-")[0].split("_")[0]
    if head in LEGACY_CODES:
        return LEGACY_CODES[head]
    m = re.match(r"^(\d{4})", head)
    if m:
        cand = m.group(1)
        if any(code == cand for code, _, _ in CHART):
            return cand
    return None


# 老准则/小企业制度的科目代码前缀 → 标准科目。
# 这些代码名称往往带「材料/供应商」，会被按名称误判（如 1131 预付被当成 1403 存货）。
# 这些代码含义唯一，优先于名称（名称里常含「盈余公积/利润」等干扰词）
STRICT_PREFIX_STD = {
    "3131": "4103",   # 本年利润
    "3141": "4104",   # 利润分配（含「提取法定盈余公积」等子目）
}

CODE_PREFIX_STD = {
    "1131": "1122",   # 应收账款（老准则）
    "2121": "2202",   # 应付账款
    "1133": "1123",   # 预付账款（老准则子目）
    "1243": "1405",   # 库存商品
    "1111": "1101",   # 短期投资
}


def resolve(code: str, name: str) -> str | None:
    """Name first; code only when the name is empty.

    Client charts reuse standard-looking codes for unrelated accounts
    (e.g. 舜壹 uses 4104 工程施工, 41040503 办公费).  A code-only fallback would
    silently pull those into 利润分配/存货等报表行，所以有名称时只信名称；
    子科目没名称命中时由父科目继承标准科目。
    """
    if code and code[:4] in STRICT_PREFIX_STD:
        return STRICT_PREFIX_STD[code[:4]]
    if normalize(name):
        hit = by_name(name)
        return hit[0] if hit else None
    c = by_code(code)
    if c:
        return c
    # NOTE: no "first 4 digits" fallback — client charts reuse 4-digit prefixes
    # for unrelated accounts (e.g. 41040503 办公费 under a project-cost chart),
    # which would mis-map them to 利润分配.  Name mapping handles those cases.
    return None
