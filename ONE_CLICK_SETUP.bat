@echo off
setlocal EnableExtensions

REM ============================================================
REM DispatchOPS - ONE-CLICK WINDOWS BUILD (Supabase architecture)
REM
REM THIS SCRIPT WILL NEVER CLOSE ON ITS OWN. Every exit path goes
REM through :SUCCESS or :FAILED, and both end in "pause". If you ever
REM see this window disappear without a message, that is a bug in this
REM file, not a build failure - please report exactly what you did.
REM
REM DESIGN NOTE, READ BEFORE EDITING: this file intentionally never
REM uses "(" ... ")" command-grouping blocks (multi-line IF, FOR /
REM DO, etc.) ANYWHERE. Project paths on this machine can contain
REM literal parentheses (e.g. "New folder (25)"), and when a path
REM variable is expanded INSIDE a grouped ( ... ) block, a stray ")"
REM from the folder name can prematurely close that block and abort
REM parsing of the ENTIRE script before a single line runs - which is
REM exactly "the window opens and instantly disappears with no
REM output" bug. Every check below is a single-line
REM "if ... goto :label" instead, which has no block for a stray
REM parenthesis to break. Do not "clean this up" into if/() blocks -
REM that is what caused the original bug.
REM
REM DESIGN NOTE 2: npm and npx are .cmd files on Windows, not real .exe
REM binaries. Invoking a .cmd/.bat from inside this script WITHOUT
REM "call" does not return control afterward - it silently terminates
REM THIS ENTIRE SCRIPT the instant the child .cmd finishes, skipping
REM every remaining line including :FAILED/:SUCCESS and their "pause".
REM This exact bug previously made the window close right after
REM printing the npm version and nothing else - one bare "npm -v" with
REM no "call" in front of it. node.exe and cargo.exe are real
REM executables and are safe to invoke bare; npm (and npx, if it is
REM ever added back) is NEVER safe to invoke without "call" - including
REM inside a "for /f ... in ('...') do" capture.
REM ============================================================

set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

set "FRONTEND_DIR=%PROJECT_ROOT%\frontend"
set "TAURI_DIR=%FRONTEND_DIR%\src-tauri"
set "RELEASE_TARGET_DIR=%TAURI_DIR%\target\release"
set "RELEASE_DIR=%PROJECT_ROOT%\release\DispatchOPS"
set "LOG=%PROJECT_ROOT%\ONE_CLICK_BUILD.log"

:START
echo ============================================================> "%LOG%"
echo              DISPATCHOPS ONE-CLICK BUILD>> "%LOG%"
echo ============================================================>> "%LOG%"
echo Started: %DATE% %TIME%>> "%LOG%"
echo Project root: %PROJECT_ROOT%>> "%LOG%"
echo.>> "%LOG%"

echo ============================================================
echo              DISPATCHOPS ONE-CLICK BUILD
echo ============================================================
echo.
echo Project root:
echo %PROJECT_ROOT%
echo.
echo Log file:
echo %LOG%
echo.

goto :CHECK_PROJECT

REM ============================================================
:CHECK_PROJECT
REM ============================================================
echo Checking project structure...
echo Checking project structure...>> "%LOG%"

if not exist "%FRONTEND_DIR%" goto :ERR_NO_FRONTEND
echo [OK] frontend found
echo [OK] frontend found>> "%LOG%"

if not exist "%TAURI_DIR%" goto :ERR_NO_TAURI_DIR
echo [OK] frontend\src-tauri found
echo [OK] frontend\src-tauri found>> "%LOG%"

if not exist "%TAURI_DIR%\tauri.conf.json" goto :ERR_NO_TAURI_CONF
echo [OK] tauri.conf.json found
echo [OK] tauri.conf.json found>> "%LOG%"

if not exist "%FRONTEND_DIR%\package.json" goto :ERR_NO_PACKAGE_JSON
echo [OK] package.json found
echo [OK] package.json found>> "%LOG%"
echo.

goto :CHECK_ENV

REM ============================================================
:CHECK_ENV
REM ============================================================
REM Supabase URL/key are baked into the frontend at build time (Vite
REM env vars) - there is no runtime "Live Connection" screen, so these
REM must exist before building. Either frontend\.env.local exists
REM already, or VITE_SUPABASE_URL must be set as a real environment
REM variable before this script runs.
echo Checking Supabase configuration...
echo Checking Supabase configuration...>> "%LOG%"

if exist "%FRONTEND_DIR%\.env.local" goto :ENV_OK
if not "%VITE_SUPABASE_URL%"=="" goto :ENV_OK
goto :ERR_NO_ENV

:ENV_OK
echo [OK] Supabase configuration present.
echo [OK] Supabase configuration present.>> "%LOG%"
echo.

goto :CHECK_TOOLS

REM ============================================================
:CHECK_TOOLS
REM ============================================================
REM Node/Rust are needed on THIS build machine only. The finished
REM release\DispatchOPS\DispatchOPS.exe needs neither.
echo Checking build tools (this machine only - not required to RUN DispatchOPS)...
echo Checking build tools...>> "%LOG%"

where node >nul 2>nul
if errorlevel 1 goto :ERR_NO_NODE
where npm >nul 2>nul
if errorlevel 1 goto :ERR_NO_NPM
where cargo >nul 2>nul
if errorlevel 1 goto :ERR_NO_CARGO

echo [OK] Node.js, npm, and Cargo were found.
echo [OK] Node.js, npm, and Cargo were found.>> "%LOG%"

REM CRITICAL: npm (and npx) are .cmd files on Windows, not real .exe
REM binaries. Invoking a .cmd/.bat from inside another batch script
REM WITHOUT "call" does not return control afterward - it silently
REM terminates THIS ENTIRE SCRIPT the moment the child .cmd finishes,
REM skipping every remaining line including :FAILED/:SUCCESS and
REM their "pause". This was the exact, complete cause of a previous
REM version of this script closing right after printing the npm
REM version and nothing else. node.exe and cargo.exe are real
REM executables and are safe to call bare; npm never is - always use
REM "call npm ..." (already done for npm install / npm run below;
REM the version check here must follow the same rule).
for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
echo [OK] node detected: %NODE_VER%
echo [OK] node detected: %NODE_VER%>> "%LOG%"

for /f "delims=" %%v in ('call npm --version') do set "NPM_VER=%%v"
echo [OK] npm detected: %NPM_VER%
echo [OK] npm detected: %NPM_VER%>> "%LOG%"

for /f "delims=" %%v in ('cargo --version') do set "CARGO_VER=%%v"
echo [OK] cargo detected: %CARGO_VER%
echo [OK] cargo detected: %CARGO_VER%>> "%LOG%"

echo [OK] build tools check complete
echo [OK] build tools check complete>> "%LOG%"
echo.

goto :BUILD_FRONTEND

REM ============================================================
:BUILD_FRONTEND
REM ============================================================
echo Installing frontend dependencies (npm install)...
echo This can take a few minutes on the first run.
echo.
echo --- npm install ---------------------------------------------->> "%LOG%"

cd /d "%FRONTEND_DIR%"
if errorlevel 1 goto :ERR_CD_FRONTEND

call npm install
if errorlevel 1 goto :ERR_NPM_INSTALL

echo [OK] Frontend dependencies installed.
echo [OK] Frontend dependencies installed.>> "%LOG%"
echo.

goto :BUILD_TAURI

REM ============================================================
:BUILD_TAURI
REM ============================================================
REM `npm run tauri:build` (see frontend\package.json) runs the Vite
REM frontend build first, then the Rust/Cargo build for the desktop
REM shell - one command covers both. This step can take several
REM minutes, especially on a first (cold) build.
echo Building DispatchOPS.exe (this can take several minutes)...
echo.
echo --- npm run tauri:build ---------------------------------------->> "%LOG%"

call npm run tauri:build
if errorlevel 1 goto :ERR_TAURI_BUILD

echo [OK] Tauri build command finished.
echo [OK] Tauri build command finished.>> "%LOG%"
echo.

goto :VERIFY_EXE

REM ============================================================
:VERIFY_EXE
REM ============================================================
REM Do not trust a successful-looking build message - explicitly
REM confirm the EXE exists before calling anything a success.
echo Verifying DispatchOPS.exe was actually produced...
echo Checking: %RELEASE_TARGET_DIR%\DispatchOPS.exe>> "%LOG%"

if exist "%RELEASE_TARGET_DIR%\DispatchOPS.exe" goto :EXE_FOUND
goto :ERR_EXE_NOT_FOUND

:EXE_FOUND
echo [OK] Found: %RELEASE_TARGET_DIR%\DispatchOPS.exe
echo [OK] Found: %RELEASE_TARGET_DIR%\DispatchOPS.exe>> "%LOG%"
echo.

goto :PACKAGE_RELEASE

REM ============================================================
:PACKAGE_RELEASE
REM ============================================================
echo Staging the release folder...
echo Staging release folder: %RELEASE_DIR%>> "%LOG%"

if not exist "%PROJECT_ROOT%\release" mkdir "%PROJECT_ROOT%\release"
if exist "%RELEASE_DIR%" rd /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"
if errorlevel 1 goto :ERR_MKDIR_RELEASE

copy /y "%RELEASE_TARGET_DIR%\DispatchOPS.exe" "%RELEASE_DIR%\DispatchOPS.exe" >nul
if errorlevel 1 goto :ERR_COPY_EXE

if not exist "%RELEASE_DIR%\DispatchOPS.exe" goto :ERR_FINAL_EXE_MISSING

echo [OK] Staged to %RELEASE_DIR%\DispatchOPS.exe
echo [OK] Staged to %RELEASE_DIR%\DispatchOPS.exe>> "%LOG%"
echo.

goto :SUCCESS

REM ============================================================
REM ERROR LABELS - each prints a specific message, logs it, then
REM falls through to :FAILED, which pauses. None of these exit or
REM close the window.
REM ============================================================

:ERR_NO_FRONTEND
echo.
echo ERROR: Required folder is missing.
echo Checked: %FRONTEND_DIR%
echo This script must be run from the DispatchOPS project root - the
echo folder that directly contains the "frontend" folder.
echo ERROR: missing folder %FRONTEND_DIR%>> "%LOG%"
goto :FAILED

:ERR_NO_TAURI_DIR
echo.
echo ERROR: Required folder is missing.
echo Checked: %TAURI_DIR%
echo ERROR: missing folder %TAURI_DIR%>> "%LOG%"
goto :FAILED

:ERR_NO_TAURI_CONF
echo.
echo ERROR: Required file is missing.
echo Checked: %TAURI_DIR%\tauri.conf.json
echo ERROR: missing file %TAURI_DIR%\tauri.conf.json>> "%LOG%"
goto :FAILED

:ERR_NO_PACKAGE_JSON
echo.
echo ERROR: Required file is missing.
echo Checked: %FRONTEND_DIR%\package.json
echo ERROR: missing file %FRONTEND_DIR%\package.json>> "%LOG%"
goto :FAILED

:ERR_NO_ENV
echo.
echo ERROR: No frontend\.env.local found and VITE_SUPABASE_URL is not set.
echo Copy frontend\.env.example to frontend\.env.local and fill in the
echo real Supabase URL/publishable key before building - see that file
echo for details.
echo ERROR: no Supabase configuration found>> "%LOG%"
goto :FAILED

:ERR_NO_NODE
echo.
echo ERROR: Node.js was not found on PATH.
echo Install Node.js (this build machine only) and re-run this script.
echo ERROR: node.js not found on PATH>> "%LOG%"
goto :FAILED

:ERR_NO_NPM
echo.
echo ERROR: npm was not found on PATH.
echo npm ships with Node.js - reinstall Node.js and re-run this script.
echo ERROR: npm not found on PATH>> "%LOG%"
goto :FAILED

:ERR_NO_CARGO
echo.
echo ERROR: Rust/Cargo was not found on PATH.
echo Install Rust via https://rustup.rs (this build machine only) and re-run.
echo ERROR: cargo not found on PATH>> "%LOG%"
goto :FAILED

:ERR_CD_FRONTEND
echo.
echo ERROR: Could not change directory to %FRONTEND_DIR%
echo ERROR: cd to %FRONTEND_DIR% failed>> "%LOG%"
goto :FAILED

:ERR_NPM_INSTALL
echo.
echo ERROR: npm install failed. See the output above and %LOG%
echo ERROR: npm install failed>> "%LOG%"
goto :FAILED

:ERR_TAURI_BUILD
echo.
echo ERROR: Tauri build failed. See the output above and %LOG%
echo ERROR: npm run tauri:build failed>> "%LOG%"
goto :FAILED

:ERR_EXE_NOT_FOUND
echo.
echo ERROR: Tauri build completed but DispatchOPS.exe could not be located.
echo Candidate location checked:
echo   %RELEASE_TARGET_DIR%\DispatchOPS.exe
echo Contents of %RELEASE_TARGET_DIR%:
dir /b "%RELEASE_TARGET_DIR%" 2>nul
echo ERROR: DispatchOPS.exe not found at %RELEASE_TARGET_DIR%>> "%LOG%"
dir /b "%RELEASE_TARGET_DIR%" >> "%LOG%" 2>&1
goto :FAILED

:ERR_MKDIR_RELEASE
echo.
echo ERROR: Could not create release folder: %RELEASE_DIR%
echo ERROR: mkdir failed for %RELEASE_DIR%>> "%LOG%"
goto :FAILED

:ERR_COPY_EXE
echo.
echo ERROR: Failed to copy DispatchOPS.exe into the release folder.
echo From: %RELEASE_TARGET_DIR%\DispatchOPS.exe
echo To:   %RELEASE_DIR%\DispatchOPS.exe
echo ERROR: copy failed>> "%LOG%"
goto :FAILED

:ERR_FINAL_EXE_MISSING
echo.
echo ERROR: Copy appeared to succeed but the final EXE is missing.
echo Checked: %RELEASE_DIR%\DispatchOPS.exe
echo ERROR: final exe missing after copy>> "%LOG%"
goto :FAILED

REM ============================================================
:SUCCESS
REM ============================================================
echo ============================================================
echo                  BUILD SUCCESSFUL
echo ============================================================
echo.
echo DispatchOPS.exe:
echo.
echo %RELEASE_DIR%\DispatchOPS.exe
echo.
echo Release folder:
echo.
echo %RELEASE_DIR%\
echo.
echo You can now double-click DispatchOPS.exe to run it.
echo (It was not launched automatically.)
echo.
echo No backend required. No Python required. No PostgreSQL required.
echo No OneDrive database required.
echo (Node.js and Rust were only needed on THIS build machine.)
echo ============================================================
echo BUILD SUCCESSFUL - %RELEASE_DIR%\DispatchOPS.exe>> "%LOG%"
pause
exit /b 0

REM ============================================================
:FAILED
REM ============================================================
echo.
echo ============================================================
echo                     BUILD FAILED
echo ============================================================
echo.
echo Check the full log:
echo %LOG%
echo.
echo This window will stay open so you can read the error above.
echo ============================================================
pause
exit /b 1
