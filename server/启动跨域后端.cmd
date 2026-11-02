@echo off
chcp 65001 >nul
title 共页 · 跨域名后端
cd /d "%~dp0.."

echo ==============================================
echo   共页 · 跨域名后端（给已上线的静态站调用）
echo.
echo   1) 先填下面的 ALLOWED_ORIGINS（你的静态站域名）
echo   2) 再启动 HTTPS 隧道，把公网地址给前端
echo   3) 数据在 server\data\db.json，删掉即清空
echo ==============================================
echo.

set PORT=8787
set HOST=127.0.0.1

rem 允许哪些前端来源调用接口（多个用逗号分隔，不要写结尾斜杠）
rem 例如：set ALLOWED_ORIGINS=https://gongye.pages.dev,https://www.example.com
set ALLOWED_ORIGINS=

rem 管理员邮箱（用该邮箱注册后即为管理员；需写进 allowlist.txt）
set ADMIN_EMAIL=

if "%ALLOWED_ORIGINS%"=="" (
  echo [提示] 还没设置 ALLOWED_ORIGINS。现在任何网站都能调用这个接口，
  echo        仅供本机测试；正式给静态站用之前一定要填上。
  echo.
)

node server\index.mjs
echo.
echo 服务已停止。
pause
