@echo off
chcp 65001 >nul
title 共页 · 内部试用
cd /d "%~dp0.."

echo ==============================================
echo   共页 v2.2 · 内部试用版
echo.
echo   1) 先编辑 server\allowlist.txt，加入同事邮箱
echo   2) 本窗口不要关，关闭即停止服务
echo   3) 数据在 server\data\db.json，删掉即清空
echo ==============================================
echo.

set PORT=8787
set HOST=0.0.0.0
rem 管理员测试账号（内部测试用）：admin@gongye.test，验证码固定 123456
rem 正式使用时改成你自己的邮箱，并删除 allowlist.txt 里的测试邮箱
set ADMIN_EMAIL=admin@gongye.test

start "" "http://127.0.0.1:%PORT%/"
node server\index.mjs
echo.
echo 服务已停止。
pause


