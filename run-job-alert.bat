@echo off
setlocal

:: Kill any existing bot instance before starting
for /f "tokens=2" %%p in ('wmic process where "commandline like '%%src/index.js --watch%%' and name='node.exe'" get processid 2^>nul ^| findstr /r "[0-9]"') do (
    taskkill /F /PID %%p >nul 2>&1
)
for /f "tokens=2" %%p in ('wmic process where "commandline like '%%src\\index.js --watch%%' and name='node.exe'" get processid 2^>nul ^| findstr /r "[0-9]"') do (
    taskkill /F /PID %%p >nul 2>&1
)

cd /d "%~dp0"
node src\index.js --watch >> data\last-run.log 2>&1
