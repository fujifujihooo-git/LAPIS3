@echo off
echo ===================================================
echo Starting LAPIS2 Emulator with Data Persistence
echo ---------------------------------------------------
echo Data will be loaded from and saved to ./emulator_data
echo ===================================================
firebase emulators:start --import=./emulator_data --export-on-exit=./emulator_data
pause
