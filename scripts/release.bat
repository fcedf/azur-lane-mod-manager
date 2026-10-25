@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem  双击发版包装：调用同目录 release.sh（自动寻找 Git Bash）
rem  直接双击即可；也支持把版本号作为参数拖入/命令行传入
rem ============================================================
cd /d "%~dp0\.."

set "BASH_EXE="
if exist "C:\Program Files\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"
if not defined BASH_EXE if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files (x86)\Git\bin\bash.exe"
if not defined BASH_EXE (
  echo [错误] 未找到 Git Bash，请先安装 Git for Windows：https://git-scm.com/download/win
  pause
  exit /b 1
)

if "%~1"=="" (
  set "ARGS="
) else (
  set "ARGS=%~1"
)

echo 使用 Bash: %BASH_EXE%
echo.
"%BASH_EXE%" -lc "cd \"$(pwd)\" && bash scripts/release.sh %ARGS%"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
