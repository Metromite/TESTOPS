@echo off
setlocal EnableExtensions
cd /d "%~dp0frontend"
echo.
echo ===============================================
echo   DispatchOPS - BUILD WINDOWS EXE
 echo ===============================================
echo.
where node >nul 2>nul
if errorlevel 1 goto NO_NODE
where npm >nul 2>nul
if errorlevel 1 goto NO_NPM
where cargo >nul 2>nul
if errorlevel 1 goto NO_CARGO
if not exist ".env.local" goto NO_ENV

echo [1/3] Installing/verifying npm packages...
call npm ci
if errorlevel 1 goto FAIL

echo [2/3] Building frontend and Tauri Windows installer/executable...
call npm run tauri:build
if errorlevel 1 goto FAIL

echo [3/3] Locating generated EXE...
for /r "src-tauri\target\release" %%F in (*.exe) do set "EXE=%%F"
if not defined EXE goto NO_EXE
mkdir "%~dp0release\DispatchOPS" >nul 2>nul
copy /Y "%EXE%" "%~dp0release\DispatchOPS\DispatchOPS.exe" >nul

echo.
echo ===============================================
echo   BUILD COMPLETE
 echo ===============================================
echo.
echo EXE: %~dp0release\DispatchOPS\DispatchOPS.exe
echo.
pause
exit /b 0

:NO_NODE
echo ERROR: Node.js is not installed.
goto END
:NO_NPM
echo ERROR: npm is not available.
goto END
:NO_CARGO
echo ERROR: Rust/Cargo is not installed.
goto END
:NO_ENV
echo ERROR: frontend\.env.local is missing.
goto END
:NO_EXE
echo ERROR: Tauri build completed but no EXE was found.
goto END
:FAIL
echo ERROR: Build failed. Review the output above.
:END
pause
exit /b 1
