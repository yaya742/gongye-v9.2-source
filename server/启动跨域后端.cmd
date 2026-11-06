@echo off
chcp 65001 >nul
title 共页 · 旧版跨域入口已停用
cd /d "%~dp0.."
echo [已停用] v10必须通过同一HTTPS来源使用Cookie会话，不再支持旧跨域Bearer配置。
echo 请阅读 DEPLOY_PRODUCTION.md，配置真实SMTP、PUBLIC_ORIGIN及安全扫描后运行 npm start。
pause
exit /b 1
