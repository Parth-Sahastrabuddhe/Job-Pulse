param(
    [string]$TaskName = "JobAlertBot"
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $projectRoot "run-job-alert.bat"

schtasks /Create /SC ONLOGON /TN $TaskName /TR "`"$runner`"" /F
