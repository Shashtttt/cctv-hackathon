import os
import sys
from pathlib import Path
import uvicorn

# Ensure root directory is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

if __name__ == "__main__":
    print("=" * 65)
    print("  IBVAP — AI Border Surveillance Video Analytics Platform")
    print("  Backend API Server: http://0.0.0.0:8000 (Local: http://127.0.0.1:8000)")
    print("  Interactive Docs:   http://0.0.0.0:8000/api/docs")
    print("=" * 65)
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
