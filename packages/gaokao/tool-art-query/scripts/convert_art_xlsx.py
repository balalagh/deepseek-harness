"""把艺术类招生工作簿转换成 `@deepseek-ai/dsh-tool-art-query` 查询用的数据集 JSON。

用法：
    python scripts/convert_art_xlsx.py --xlsx <工作簿路径> --out <数据集路径> [--years 2026]

输出结构（顶层数组名即五个工具的数据来源）：
    policy_matrix / admission_detail / school_exam / major_catalog / admission_mode_overview

归一化说明：
- 空单元格一律写成 null；投档明细的 9 个数值列转成 number（解析不出记 null）。
- 投档明细 sheet 里同时存在多个年份的行，默认只导出 --years 指定的年份（传 all 保留全部）。
- 科类保留原值，另加内部字段 category=统考类别归一结果，供 category 参数按类别粗筛。
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import openpyxl

DEFAULT_YEARS = (2026,)

SHEET_POLICY = "政策矩阵-艺术类"
SHEET_DETAIL = "招生数据-投档明细2026"
SHEET_EXAM = "校考院校名单"
SHEET_CATALOG = "可报考专业目录"
SHEET_MODE = "招生模式总览"

DETAIL_NUMERIC_COLUMNS = (
    "投档最低综合分",
    "文化总分",
    "专业统考分",
    "语文",
    "数学",
    "外语",
    "三科选考合计",
    "投档/录取数",
    "计划数",
)

# 源表里仅用于排序或人工阅览、不进模型可见输出的列。
DETAIL_DROP_COLUMNS = ("序号",)
EXAM_DROP_COLUMNS = ("序号",)

# 统考类别归一规则：先折半角括号，再按关键词命中第一个类别。
CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("美术与设计类", ("美术与设计",)),
    ("书法类", ("书法",)),
    ("舞蹈类", ("舞蹈",)),
    ("播音与主持类", ("播音与主持", "播音主持")),
    ("表(导)演类", ("表(导)演", "表演类", "戏剧影视表演", "戏剧影视导演", "服装表演")),
    ("音乐类", ("音乐",)),
    ("戏曲类", ("戏曲",)),
)
CATEGORY_FALLBACK = "其他"


def canonical_category(raw: str | None) -> str | None:
    """把同一类别下的多种科类写法归一到 7 个统考类别，无法归类记 `其他`。"""
    if raw is None:
        return None
    folded = raw.replace("（", "(").replace("）", ")")
    for category, keywords in CATEGORY_RULES:
        if any(keyword in folded for keyword in keywords):
            return category
    return CATEGORY_FALLBACK


def as_text(cell: Any) -> str | None:
    """单元格转文本：空串与空白记 null，其余去首尾空白。"""
    if cell is None:
        return None
    text = str(cell).strip()
    return text if text != "" else None


def as_number(cell: Any) -> float | int | None:
    """单元格转数值：解析不出数字记 null（原始值本身是数字时原样保留）。"""
    if cell is None or isinstance(cell, bool):
        return None
    if isinstance(cell, (int, float)):
        return cell
    text = str(cell).strip().replace(",", "")
    if text == "":
        return None
    if re.fullmatch(r"-?\d+(?:\.\d+)?", text) is None:
        return None
    number = float(text)
    return int(number) if number.is_integer() else number


def read_sheet(workbook: openpyxl.Workbook, title: str) -> list[dict[str, Any]]:
    """读一个 sheet，返回按表头命名的行列表（整行空白的行丢弃）。"""
    worksheet = workbook[title]
    rows = worksheet.iter_rows(values_only=True)
    header = [str(cell).strip() if cell is not None else "" for cell in next(rows)]
    records: list[dict[str, Any]] = []
    for row in rows:
        if all(cell is None or str(cell).strip() == "" for cell in row):
            continue
        records.append(dict(zip(header, row, strict=False)))
    return records


def strings(record: dict[str, Any], drop: tuple[str, ...] = ()) -> dict[str, Any]:
    """一行全部转文本，并按需丢弃表头列。"""
    return {
        key: as_text(value)
        for key, value in record.items()
        if key not in drop and key != ""
    }


def build_detail(record: dict[str, Any]) -> dict[str, Any]:
    """投档明细一行：数值列转数值，其余转文本，另加内部 category。"""
    row: dict[str, Any] = {}
    for key, value in record.items():
        if key in DETAIL_DROP_COLUMNS or key == "":
            continue
        if key in DETAIL_NUMERIC_COLUMNS:
            row[key] = as_number(value)
        elif key == "年份":
            year = as_number(value)
            row[key] = int(year) if year is not None else None
        else:
            row[key] = as_text(value)
    row["category"] = canonical_category(as_text(record.get("科类")))
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description="艺术类招生工作簿 → art-query 数据集")
    parser.add_argument("--xlsx", required=True, help="源工作簿路径")
    parser.add_argument("--out", required=True, help="输出数据集 JSON 路径")
    parser.add_argument(
        "--years",
        default=",".join(str(year) for year in DEFAULT_YEARS),
        help="投档明细保留哪些年份，逗号分隔；传 all 保留全部",
    )
    options = parser.parse_args()

    if options.years.strip().lower() == "all":
        keep_years: set[int] | None = None
    else:
        keep_years = {int(part) for part in options.years.split(",") if part.strip() != ""}

    workbook = openpyxl.load_workbook(options.xlsx, read_only=True, data_only=True)

    policy = [strings(record) for record in read_sheet(workbook, SHEET_POLICY)]
    exam = [strings(record, EXAM_DROP_COLUMNS) for record in read_sheet(workbook, SHEET_EXAM)]
    catalog = [strings(record) for record in read_sheet(workbook, SHEET_CATALOG)]
    mode = [strings(record) for record in read_sheet(workbook, SHEET_MODE)]

    detail_all = [build_detail(record) for record in read_sheet(workbook, SHEET_DETAIL)]
    by_year = Counter(str(row["年份"]) for row in detail_all)
    detail = [
        row for row in detail_all
        if keep_years is None or (row["年份"] is not None and row["年份"] in keep_years)
    ]
    unmapped = Counter(row["科类"] for row in detail_all if row["category"] == CATEGORY_FALLBACK)

    payload = {
        "meta": {
            "source": str(Path(options.xlsx).resolve()),
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "yearsInSource": dict(sorted(by_year.items())),
            "yearsExported": "all" if keep_years is None else sorted(keep_years),
            "counts": {
                "policy_matrix": len(policy),
                "admission_detail": len(detail),
                "school_exam": len(exam),
                "major_catalog": len(catalog),
                "admission_mode_overview": len(mode),
            },
            "categoriesUnmapped": dict(sorted(unmapped.items(), key=lambda item: str(item[0]))),
        },
        "policy_matrix": policy,
        "admission_detail": detail,
        "school_exam": exam,
        "major_catalog": catalog,
        "admission_mode_overview": mode,
    }

    out = Path(options.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"counts: {payload['meta']['counts']}")
    print(f"source years: {dict(by_year)}; exported: {payload['meta']['yearsExported']}")
    print(f"科类未归类: {dict(unmapped)}")


if __name__ == "__main__":
    main()
