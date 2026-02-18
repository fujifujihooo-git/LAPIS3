@echo off
setlocal

:: Get current date and time
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set YYYY=%datetime:~0,4%
set MM=%datetime:~4,2%
set DD=%datetime:~6,2%
set HH=%datetime:~8,2%
set Min=%datetime:~10,2%

set BACKUP_DIR=_BACKUP_%YYYY%%MM%%DD%_%HH%%Min%

echo Creating backup directory: %BACKUP_DIR%
mkdir %BACKUP_DIR%

echo Copying files...
xcopy /Y *.html %BACKUP_DIR%\
xcopy /Y *.js %BACKUP_DIR%\
xcopy /Y *.css %BACKUP_DIR%\
xcopy /Y *.json %BACKUP_DIR%\
copy /Y .firebaserc %BACKUP_DIR%\

echo Backup completed to %BACKUP_DIR%
pause
