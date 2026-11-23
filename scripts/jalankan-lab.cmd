@echo off
setlocal
cd /d "%~dp0.." || exit /b 1
if exist ".runtime\node-v22.23.4-win-x64\node.exe" (
  set "PATH=%CD%\.runtime\node-v22.23.4-win-x64;%PATH%"
)
where node >nul 2>&1 || (
  echo Node.js tidak ditemukan. Pasang Node terpatch sesuai README.md.
  exit /b 1
)
node scripts\lab.cjs %*
exit /b %ERRORLEVEL%
