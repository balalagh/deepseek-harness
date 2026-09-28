"""
高考数据查询微服务 — FastAPI + PyMySQL

提供三个查询端点：
  GET /api/province-control-line  省份控制线
  GET /api/college-admission      院校录取数据
  GET /api/score-segment          一分一段表

启动: uvicorn main:app --host 127.0.0.1 --port 8901

数据库连接信息全部来自同目录的 .env（变量名见 .env.example），仓库中不保留任何凭据。
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pymysql
from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ── 数据库配置（只从环境变量读取，见同目录 .env / .env.example） ──

ENV_FILE = Path(__file__).with_name(".env")
load_dotenv(ENV_FILE)


def _required_env(name: str) -> str:
    """读取必填的数据库环境变量；缺失时立即失败，不回退到内置凭据。"""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"[gaokao-api] 缺少环境变量 {name}：请在 {ENV_FILE} 中配置（可参考 .env.example）")
    return value


DB_CONFIG: dict[str, Any] = {
    "host": _required_env("GAOKAO_DB_HOST"),
    "port": int(_required_env("GAOKAO_DB_PORT")),
    "user": _required_env("GAOKAO_DB_USER"),
    "password": _required_env("GAOKAO_DB_PASSWORD"),
    "database": _required_env("GAOKAO_DB_NAME"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "connect_timeout": 10,
}


def get_connection() -> pymysql.Connection:
    """每次请求创建短连接（PyMySQL 无内置池，查询轻量够用）。"""
    return pymysql.connect(**DB_CONFIG)


# ── Lifespan ──────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时探测一次连接
    try:
        conn = get_connection()
        conn.close()
        print("[gaokao-api] DB connection OK")
    except Exception as e:
        print(f"[gaokao-api] DB connection FAILED: {e}")
    yield
    print("[gaokao-api] shutting down")


app = FastAPI(
    title="高考数据查询微服务",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _query(sql: str, params: tuple | list) -> list[dict]:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        conn.close()


# ── 端点 1: 省份控制线 ────────────────────────────────────────

@app.get("/api/province-control-line")
def province_control_line(
    province: str = Query(..., description="省份，如：浙江、山东"),
    year: int = Query(2025, description="年份"),
):
    sql = """
        SELECT province, year,
               history_score_line, physics_score_line,
               history_rank, physics_rank,
               history_first_score_line, physics_first_score_line,
               history_first_rank, physics_first_rank
        FROM col_province_control_line
        WHERE province = %s AND year = %s AND deleted = 0
    """
    rows = _query(sql, (province, year))

    results: list[dict] = []
    for row in rows:
        # 未公布位次的省份控制线保留 rank 为 null：0 是一个真实位次，用它表示
        # "未公布"会把缺失读成具体名次。
        # 历史类
        if row.get("history_score_line"):
            results.append({
                "province": row["province"],
                "year": row["year"],
                "subject": "历史类",
                "batch": "本科控制线",
                "score": row["history_score_line"],
                "rank": row.get("history_rank"),
            })
        if row.get("history_first_score_line"):
            results.append({
                "province": row["province"],
                "year": row["year"],
                "subject": "历史类",
                "batch": "一本控制线",
                "score": row["history_first_score_line"],
                "rank": row.get("history_first_rank"),
            })
        # 物理类
        if row.get("physics_score_line"):
            results.append({
                "province": row["province"],
                "year": row["year"],
                "subject": "物理类",
                "batch": "本科控制线",
                "score": row["physics_score_line"],
                "rank": row.get("physics_rank"),
            })
        if row.get("physics_first_score_line"):
            results.append({
                "province": row["province"],
                "year": row["year"],
                "subject": "物理类",
                "batch": "一本控制线",
                "score": row["physics_first_score_line"],
                "rank": row.get("physics_first_rank"),
            })

    return {"province": province, "year": year, "count": len(results), "data": results}


# ── 端点 2: 院校录取数据 ──────────────────────────────────────

@app.get("/api/college-admission")
def college_admission(
    exam_province: str = Query(..., description="高考所在省份，如 浙江、山东、广东"),
    subject: str = Query(..., description="选科，用逗号分隔，如：物理,化学,生物"),
    college_major_group: int = Query(..., description="是否为院校专业组模式，0=专业（类）+院校，1=院校专业组"),
    school_province: str | None = Query(None, description="学校所在省份，多个用逗号分隔"),
    school_city: str | None = Query(None, description="学校所在城市，多个用逗号分隔"),
    school_name: str | None = Query(None, description="学校名字，多个用逗号分隔"),
    year: int | None = Query(None, description="年份，仅支持2024/2025"),
    major_name: str | None = Query(None, description="专业名，多个用逗号分隔"),
    parsed_major_name: str | None = Query(None, description="解析后的专业名，多个用逗号分隔"),
    major_category: str | None = Query(None, description="专业所属书的专业类，多个用逗号分隔"),
    sino_foreign: int | None = Query(None, description="是否为中外合办，0/1"),
    admission_score_min: int | None = Query(None, description="录取分数范围最小值"),
    admission_score_max: int | None = Query(None, description="录取分数范围最大值"),
    admission_rank_min: int | None = Query(None, description="录取位次范围最小值"),
    admission_rank_max: int | None = Query(None, description="录取位次范围最大值"),
    fields: str | None = Query(None, description="需要返回的字段，逗号分隔，不传则返回全部"),
):
    conditions = ["deleted = 0", "exam_province = %s"]
    params: list = [exam_province]

    SUBJECT_CN_TO_DB = {
        "物理": "subject_physics",
        "化学": "subject_chemistry",
        "生物": "subject_biology",
        "政治": "subject_politics",
        "历史": "subject_history",
        "地理": "subject_geography",
        "技术": "subject_technology",
    }

    user_subjects = set(s.strip() for s in subject.split(",") if s.strip())
    for s in user_subjects:
        if s not in SUBJECT_CN_TO_DB:
            raise HTTPException(status_code=400, detail=f"不支持的选科: {s}")

    def build_in_clause(items: list[str], col: str) -> tuple[str, list]:
        if not items:
            return "", []
        placeholders = ", ".join("%s" for _ in items)
        return f"{col} IN ({placeholders})", list(items)

    if school_province:
        school_province_list = [s.strip() for s in school_province.split(',') if s.strip()]
        cond, p = build_in_clause(school_province_list, "school_province")
        conditions.append(cond); params.extend(p)
    if school_city:
        school_city_list = [s.strip() for s in school_city.split(',') if s.strip()]
        cond, p = build_in_clause(school_city_list, "school_city")
        conditions.append(cond); params.extend(p)
    if school_name:
        school_name_list = [s.strip() for s in school_name.split(',') if s.strip()]
        cond, p = build_in_clause(school_name_list, "school_name")
        conditions.append(cond); params.extend(p)
    if major_name:
        major_name_list = [s.strip() for s in major_name.split(',') if s.strip()]
        cond, p = build_in_clause(major_name_list, "major_name")
        conditions.append(cond); params.extend(p)
    if parsed_major_name:
        parsed_major_name_list = [s.strip() for s in parsed_major_name.split(',') if s.strip()]
        cond, p = build_in_clause(parsed_major_name_list, "parsed_major_name")
        conditions.append(cond); params.extend(p)
    if major_category:
        major_category_list = [s.strip() for s in major_category.split(',') if s.strip()]
        cond, p = build_in_clause(major_category_list, "major_category")
        conditions.append(cond); params.extend(p)
    if year is not None:
        conditions.append("year = %s")
        params.append(year)
    if sino_foreign is not None:
        conditions.append("sino_foreign = %s")
        params.append(sino_foreign)
    if admission_score_min is not None:
        conditions.append("admission_score >= %s")
        params.append(admission_score_min)
    if admission_score_max is not None:
        conditions.append("admission_score <= %s")
        params.append(admission_score_max)
    if admission_rank_min is not None:
        conditions.append("admission_rank >= %s")
        params.append(admission_rank_min)
    if admission_rank_max is not None:
        conditions.append("admission_rank <= %s")
        params.append(admission_rank_max)

    # ── 选科过滤 ────────────────────────────────────────────────────────────
    # 条件下推而不是取回后过滤：过滤必须发生在 LIMIT 之前，否则高分段不适用的
    # 条目会占满窗口，把真正可报的条目挤掉（实测差两个数量级）。
    # 这些列是 bit(1)，PyMySQL 返回 b'\x00'/b'\x01'，因此判定留给 SQL 的数值比较。
    #
    # 多科：入参是完整组合，未出现的科目即"没选"，该列一旦被要求（= 1）即不适用。
    # 单科：入参只声明了一科，其余科目是"未知"而不是"没选"，因此只要求
    #       "该科被要求"或"该条不要求任何科目"。
    no_requirement = " AND ".join(
        f"({db_field} IS NULL OR {db_field} = 0)" for db_field in SUBJECT_CN_TO_DB.values()
    )
    if len(user_subjects) == 1:
        only_field = SUBJECT_CN_TO_DB[next(iter(user_subjects))]
        conditions.append(f"({only_field} = 1 OR ({no_requirement}))")
    else:
        for cn, db_field in SUBJECT_CN_TO_DB.items():
            if cn in user_subjects:
                continue
            conditions.append(f"({db_field} IS NULL OR {db_field} = 0)")

    where = " AND ".join(conditions)
    sql = f"""
        SELECT school_province, school_city, school_name, school_code, year,
               batch, undergraduate_type, major_group_code, major_code, major_name,
               parsed_major_name, major_category, campus, subject_requirement,
               study_duration, major_note, sino_foreign, tuition_fee,
               parsed_tuition_fee, enrollment_plan, admission_score, admission_rank
        FROM col_college_admission
        WHERE {where}
        ORDER BY admission_score DESC
        LIMIT 200
    """

    rows = _query(sql, params)

    # ── 构造输出 ──
    base_fields = [
        "school_province", "school_city", "school_name", "school_code",
        "year", "batch", "undergraduate_type",
        "major_code", "major_name", "parsed_major_name", "major_category",
        "campus", "subject_requirement",
        "study_duration", "major_note", "sino_foreign",
        "tuition_fee", "parsed_tuition_fee",
        "enrollment_plan", "admission_score", "admission_rank",
    ]
    extra_field = "major_group_code" if college_major_group == 1 else None

    output_fields = base_fields[:]
    if extra_field:
        output_fields.insert(5, extra_field)

    # 数据库未收录的字段原样返回 None（JSON null）。分数、位次、招生计划等列可空，
    # 而 0 是这些列上的真实取值，用它表示"没有数据"会把缺失读成一个具体数字。
    data = [{f: r.get(f) for f in output_fields} for r in rows]

    if fields:
        field_list = [f.strip() for f in fields.split(",") if f.strip()]
        valid_fields = set(output_fields)
        field_list = [f for f in field_list if f in valid_fields]
        if field_list:
            data = [{f: row[f] for f in field_list if f in row} for row in data]

    return {"count": len(data), "data": data}


# ── 端点 3: 一分一段表 ────────────────────────────────────────

@app.get("/api/score-segment")
def score_segment(
    province: str = Query(..., description="省份"),
    year: int = Query(..., description="年份，仅支持2025/2026"),
    subject_combination: str = Query(..., description="选科：物理/历史/总"),
    score: int = Query(..., description="查询特定分数"),
):
    sql = """
        SELECT province, subject_combination, score,
               segment_count, cumulative_count, year
        FROM member_score_distribution
        WHERE province = %s AND year = %s AND subject_combination = %s AND score = %s AND deleted = 0
        ORDER BY score DESC
        LIMIT 100
    """

    rows = _query(sql, (province, year, subject_combination, score))
    data = [
        {
            "province": r["province"],
            "subject_combination": r["subject_combination"],
            "score": r["score"],
            "segment_count": r["segment_count"],
            "cumulative_count": r["cumulative_count"],
            "year": r["year"],
        }
        for r in rows
    ]
    return {"province": province, "year": year, "count": len(data), "data": data}


@app.get("/api/province-fill-rule")
def province_fill_rule(province: str = Query(...), year: int = Query(...)):
    sql = "SELECT province, year, subject_mode, fill_mode, fill_count, group_major_count FROM col_province_fill_rule WHERE province = %s AND year = %s AND deleted = 0"
    rows = _query(sql, (province, year))
    if not rows:
        raise HTTPException(status_code=404, detail=f"{province} {year} not found")
    r = rows[0]
    result = {"province": r["province"], "year": r["year"], "subject_mode": r["subject_mode"], "fill_mode": r["fill_mode"], "fill_count": r["fill_count"]}
    if r.get("group_major_count") is not None:
        result["group_major_count"] = r["group_major_count"]
    return result



# ── 健康检查 ──────────────────────────────────────────────────

@app.get("/health")
def health():
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.close()
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
