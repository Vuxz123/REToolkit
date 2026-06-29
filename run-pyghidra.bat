@echo off
setlocal

set "ROOT=%~dp0"
set "JAVA_HOME=%ROOT%runtime\java\jdk-21"
set "JAVA_HOME_OVERRIDE=%ROOT%runtime\java\jdk-21"
set "GHIDRA_INSTALL_DIR=%ROOT%tools\ghidra"
set "PATH=%JAVA_HOME%\bin;%PATH%"

if not exist "%JAVA_HOME%\bin\java.exe" (
    echo [FAIL] JDK 21 portable not found at: %JAVA_HOME%
    echo        Run: .\install-re-toolkit.ps1 -InstallRuntime
    exit /b 1
)

if not exist "%GHIDRA_INSTALL_DIR%\support\pyghidraRun.bat" (
    echo [FAIL] PyGhidra runner not found at: %GHIDRA_INSTALL_DIR%\support\pyghidraRun.bat
    echo        Install Ghidra with PyGhidra support.
    exit /b 1
)

echo Using toolkit JDK:
"%JAVA_HOME%\bin\java.exe" -version

cd /d "%ROOT%"
call "%GHIDRA_INSTALL_DIR%\support\pyghidraRun.bat"

endlocal
