param(
    [string]$TaskName = "JobAlertBot"
)

schtasks /Delete /TN $TaskName /F
