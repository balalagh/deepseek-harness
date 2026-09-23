import io
p = r"E:\ghWork\deepseek_harness\deepseek-harness\packages\gaokao\gaokao-api\main.py"
with io.open(p, encoding="utf-8") as f:
    c = f.read()
# Insert before the health check comment line
idx = c.rfind("# ── 健康检查")
if idx < 0:
    idx = c.rfind("# 健康检查")
if idx < 0:
    print("HEALTH CHECK NOT FOUND")
    exit(1)
# Go to start of that line
idx = c.rfind("\n", 0, idx)
ep = """
@app.get("/api/province-fill-rule")
async def province_fill_rule(province: str = Query(...), year: int = Query(...)):
    sql = "SELECT province, year, subject_mode, fill_mode, fill_count, group_major_count FROM col_province_fill_rule WHERE province = %s AND year = %s AND deleted = 0"
    rows = _query(sql, (province, year))
    if not rows:
        raise HTTPException(status_code=404, detail=f"{province} {year} not found")
    r = rows[0]
    result = {"province": r["province"], "year": r["year"], "subject_mode": r["subject_mode"], "fill_mode": r["fill_mode"], "fill_count": r["fill_count"]}
    if r.get("group_major_count") is not None:
        result["group_major_count"] = r["group_major_count"]
    return result
"""
c = c[:idx] + ep + "\n\n" + c[idx:]
with io.open(p, "w", encoding="utf-8", newline="\n") as f:
    f.write(c)
print("OK")
