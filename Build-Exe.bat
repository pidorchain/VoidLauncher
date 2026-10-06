@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul
if %errorlevel%==0 goto build
if not exist "runtime\node\node.exe" (
  echo Скачиваю Node.js, подождите...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;New-Item -ItemType Directory -Force runtime|Out-Null;Invoke-WebRequest https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip -OutFile runtime\node.zip;Expand-Archive runtime\node.zip runtime -Force;if(Test-Path runtime\node){Remove-Item -Recurse -Force runtime\node};Rename-Item runtime\node-v20.18.0-win-x64 node;Remove-Item runtime\node.zip"
)
if not exist "runtime\node\node.exe" goto fail
set "PATH=%~dp0runtime\node;%PATH%"
:build
if not exist "build\icon.ico" echo ВНИМАНИЕ: нет файла build\icon.ico - скопируйте папку build из архива
del /q "dist\*.exe" 2>nul
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
call npm run dist
if not exist "dist\VoidLauncher-Setup-*.exe" goto fail
echo.
echo Готово: файлы .exe лежат в папке dist
pause
exit /b 0
:fail
echo.
echo ============================================================
echo  СБОРКА НЕ УДАЛАСЬ. Причина написана КРАСНЫМ текстом выше:
echo  прокрутите окно вверх колесом мыши и сфотографируйте её.
echo ============================================================
pause
exit /b 1
