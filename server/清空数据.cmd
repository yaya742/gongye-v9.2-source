@echo off
chcp 65001 >nul
title 共页 · 旧版清理命令已停用
cd /d "%~dp0.."
echo [已停用] v10生产数据与私有文件必须成套备份，不可用旧演示清理脚本删除。
echo 请阅读 DEPLOY_PRODUCTION.md，停止服务并由运营方确认备份与保留策略。
pause
exit /b 1
