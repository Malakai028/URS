@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul || (echo Install Node.js 24 LTS, then run Start-Game.cmd again. & pause & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a===24 && b>=12?0:1)" || (echo This release requires Node.js 24.12 or newer in the 24.x series. & pause & exit /b 1)
set "NODE_ENV=development"
set "HOST=127.0.0.1"
set "PORT=4183"
set "PUBLIC_ORIGIN=http://127.0.0.1:4183"
set "DATABASE_FILE=%LOCALAPPDATA%\Universal RPG Engine\local-game\worlds.sqlite"
set "TRUSTED_PROXY="
set "ACCOUNT_MAIL_URL="
set "NARRATOR_URL="
echo Open http://127.0.0.1:4183 after URE prints its listening address.
echo Saves: "%DATABASE_FILE%"
echo Press Ctrl+C here to stop the game.
node apps/server/start.ts
if errorlevel 1 pause
