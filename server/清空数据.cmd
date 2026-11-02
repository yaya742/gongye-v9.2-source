@echo off
chcp 65001 >nul
title 共页 · 清空试用数据
cd /d "%~dp0.."

echo 即将删除试用数据：
echo   server\data\
echo.
choice /c YN /m "确定清空吗（同事账号、帖子、页签都会删除）"
if errorlevel 2 goto :cancel

if exist "server\data" (
  rmdir /s /q "server\data"
  echo 已清空。下次启动会重新生成演示数据。
) else (
  echo 没有找到数据目录，无需清理。
)
pause
exit /b 0

:cancel
echo 已取消。
pause
