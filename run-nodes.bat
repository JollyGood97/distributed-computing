@echo off
set /a instances=%1
set /a PORT=3001
for /l %%i in (1,1,%instances%) do (
  echo Starting instance %%i on port %PORT%
  set /a PORT+=1
  start cmd /c "node index.js %PORT%"
)
