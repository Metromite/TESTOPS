@echo off
setlocal
set "ROOT=%~dp0"
set "SQL=%ROOT%supabase\RUN_ALL_MIGRATIONS.sql"
if not exist "%SQL%" (
  echo ERROR: Migration file not found:
  echo %SQL%
  pause
  exit /b 1
)

echo DispatchOPS Supabase database setup helper
echo.
echo This package contains the complete schema required by the EXE.
echo The SQL will be copied to the Windows clipboard and the DispatchOPS
echo Supabase SQL Editor will be opened.
echo.
for /f "usebackq delims=" %%A in ("%SQL%") do echo %%A| powershell -NoProfile -Command "$input | Set-Clipboard"
start "" "https://supabase.com/dashboard/project/chrokbnrlvrfejckmzuz/sql/new"
echo.
echo The complete migration is now on your clipboard.
echo In the Supabase SQL Editor, paste it and click RUN.
echo.
pause
