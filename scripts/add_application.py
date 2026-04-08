"""Add a job application entry to the Google Sheets tracker."""
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import gspread
from google.oauth2.service_account import Credentials

SHEET_ID = "1cBerym6t8Ws_SxWQCX06BbWVOCK3oQnxh9lqc8WTDVw"
TAB_NAME = "Sheet1"
CREDS_PATH = Path(__file__).resolve().parent.parent / "data" / "google-credentials.json"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
]


def get_sheet():
    creds = Credentials.from_service_account_file(str(CREDS_PATH), scopes=SCOPES)
    gc = gspread.authorize(creds)
    return gc.open_by_key(SHEET_ID).worksheet(TAB_NAME)


def add_application(company, role, url, timezone="America/New_York"):
    ws = get_sheet()

    # Find next empty row (check column A)
    col_a = ws.col_values(1)
    next_row = len(col_a) + 1

    d = datetime.now(ZoneInfo(timezone))
    today = f"{d.month}/{d.day}/{d.year}"

    # Update row: A=Company, B=Role, D=Date Applied, E=Status, G=URL
    ws.update(values=[[company]], range_name=f"A{next_row}")
    ws.update(values=[[role]], range_name=f"B{next_row}")
    ws.update(values=[[today]], range_name=f"D{next_row}")
    ws.update(values=[["Applied"]], range_name=f"E{next_row}")
    ws.update(values=[[url]], range_name=f"G{next_row}")

    # Apply yellow background to Status cell (E)
    ws.format(f"E{next_row}", {
        "backgroundColor": {"red": 1, "green": 1, "blue": 0}
    })

    # Center align A-F
    ws.format(f"A{next_row}:F{next_row}", {
        "horizontalAlignment": "CENTER",
        "verticalAlignment": "MIDDLE"
    })

    print(f"OK|{next_row}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: add_application.py <company> <role> <url> [timezone]", file=sys.stderr)
        sys.exit(1)
    tz = sys.argv[4] if len(sys.argv) > 4 else "America/New_York"
    add_application(sys.argv[1], sys.argv[2], sys.argv[3], tz)
