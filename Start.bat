@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" if exist "node_modules\msmc" goto run
echo ============================================
echo  VoidLauncher: первый запуск
echo  Загружаю компоненты, это займёт 1-3 минуты.
echo  Окно не закрывайте. Нужен интернет.
echo ============================================
where npm >nul 2>nul
if %errorlevel%==0 goto install
if not exist "runtime\node\node.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;New-Item -ItemType Directory -Force runtime|Out-Null;Invoke-WebRequest https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip -OutFile runtime\node.zip;Expand-Archive runtime\node.zip runtime -Force;if(Test-Path runtime\node){Remove-Item -Recurse -Force runtime\node};Rename-Item runtime\node-v20.18.0-win-x64 node;Remove-Item runtime\node.zip"
)
if not exist "runtime\node\node.exe" goto fail
set "PATH=%~dp0runtime\node;%PATH%"
:install
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\VoidLauncher.lnk');$s.TargetPath='%~dp0Start.bat';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"
:run
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
:fail
echo.
echo Не удалось загрузить компоненты. Проверьте интернет и запустите Start.bat ещё раз.
pause
exit /b 1
