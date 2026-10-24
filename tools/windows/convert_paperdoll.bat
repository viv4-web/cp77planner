@echo off
REM ============================================================================
REM convert_paperdoll.bat  -  ripperdoc paperdoll .bk2 -> PNG frames (alpha kept) -> copy to the server
REM
REM Usage:   convert_paperdoll.bat [source folder] [/clean] [/probe]
REM   source folder  default: C:\Work\cyber-extract\cp77-data\source\archive\base\movies\misc\paperdoll
REM   /probe         only print RAD Video Tools' own command-line help (run this first, see the UNVERIFIED note below)
REM   /clean         delete the old frames of man\ and woman\ on the server before copying (use after a game patch
REM                  that changed a clip's length, otherwise stale extra frames stay in the sequence)
REM
REM Output: C:\Work\cyber-extract\cp77-data\source\raw\paperdoll\{man,woman}\<clip>NNN.png   (NNN = 000, 001, ...)
REM         then: scp -r ...\raw\paperdoll  w3dev@hetzner-w3:~/work/cyber-art/raw/
REM A clip goes to woman\ when its file name starts with woman_ or female_, otherwise to man\ (man_, male_).
REM
REM ---------------------------------------------------------------------------
REM !! UNVERIFIED !!  The exact radvideo64.exe command-line syntax is NOT confirmed. I could not find RAD's command-line
REM documentation, and only the GUI workflow (Convert a file -> PNG) is documented by third parties. The single line
REM that calls RAD Video Tools is marked  <<< CHECK THIS LINE  below. Run  convert_paperdoll.bat /probe  to see what your
REM installed version really accepts, fix that one line, and test on ONE file before running the whole folder.
REM What the export must do (set in the GUI "Convert a file" dialog if the CLI cannot): PNG sequence, 32-bit with alpha,
REM alpha NOT premultiplied/removed, no audio, original size, 30 fps, file names <clip>000.png ...
REM ---------------------------------------------------------------------------
setlocal EnableExtensions EnableDelayedExpansion

set "SRC=C:\Work\cyber-extract\cp77-data\source\archive\base\movies\misc\paperdoll"
set "DEST=C:\Work\cyber-extract\cp77-data\source\raw\paperdoll"
set "REMOTE=w3dev@hetzner-w3:~/work/cyber-art/raw/"
if not defined RADVIDEO set "RADVIDEO=C:\Program Files (x86)\RADVideo\radvideo64.exe"
set "CLEAN=0"
set "PROBE=0"

:args
if "%~1"=="" goto :argsdone
if /i "%~1"=="/clean" (set "CLEAN=1") else if /i "%~1"=="/probe" (set "PROBE=1") else set "SRC=%~1"
shift
goto :args
:argsdone

if not exist "%RADVIDEO%" (
  echo RAD Video Tools not found at "%RADVIDEO%". Install it or set RADVIDEO to the full path of radvideo64.exe.
  exit /b 1
)
if "%PROBE%"=="1" (
  "%RADVIDEO%" /?
  exit /b 0
)
if not exist "%SRC%" (
  echo Source folder not found: "%SRC%"
  exit /b 1
)

mkdir "%DEST%\man" 2>nul
mkdir "%DEST%\woman" 2>nul
set /a DONE=0
set /a BAD=0

for /r "%SRC%" %%F in (*.bk2) do (
  set "NAME=%%~nF"
  set "SIDE=man"
  if /i "!NAME:~0,6!"=="woman_" set "SIDE=woman"
  if /i "!NAME:~0,7!"=="female_" set "SIDE=woman"
  echo Converting !NAME! -^> %DEST%\!SIDE!\
  REM <<< CHECK THIS LINE: UNVERIFIED guess of the RAD Video Tools syntax (input, PNG output with alpha, no audio). Fix after /probe.
  "%RADVIDEO%" "%%F" /PNG /ALPHA /NOAUDIO /O"%DEST%\!SIDE!\!NAME!"
  if exist "%DEST%\!SIDE!\!NAME!000.png" (set /a DONE+=1) else (echo   !! no frames written for !NAME! & set /a BAD+=1)
)

echo.
echo Converted %DONE% clip(s), %BAD% failed.
if not "%BAD%"=="0" (
  echo Not copying to the server because some clips failed. Fix the RAD command above and run again.
  exit /b 1
)
if %DONE%==0 (
  echo No .bk2 files found under "%SRC%".
  exit /b 1
)

if "%CLEAN%"=="1" (
  echo Removing old frames on the server...
  ssh w3dev@hetzner-w3 "rm -f ~/work/cyber-art/raw/paperdoll/man/*.png ~/work/cyber-art/raw/paperdoll/woman/*.png"
  if errorlevel 1 (echo ssh failed & exit /b 1)
)

echo Copying to the server...
scp -r "%DEST%" %REMOTE%
if errorlevel 1 (echo scp failed & exit /b 1)
echo Done. On the server run:  python3 tools/paperdoll_video.py
endlocal
