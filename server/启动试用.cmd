@echo off
chcp 65001 >nul
title 共页 · 旧试用入口已停用
cd /d "%~dp0.."
echo [已停用] 旧试用入口使用固定码，不得用于真实学生登录。
echo 正式启动请按 DEPLOY_PRODUCTION.md 配置后执行 npm start。
echo 本地演示请使用 npm run dev 或 npm run pilot，勿向公网发布。
pause
exit /b 1




