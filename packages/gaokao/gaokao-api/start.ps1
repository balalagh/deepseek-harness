# 高考数据查询微服务启动脚本
Write-Host "[gaokao-api] Starting on http://127.0.0.1:8901" -ForegroundColor Cyan
Set-Location $PSScriptRoot
python -m uvicorn main:app --host 127.0.0.1 --port 8901 --reload
