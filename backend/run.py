import os
import sys
from pathlib import Path
import uvicorn

# Ensure root directory is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    is_dev = os.environ.get("ENV", "development").lower() == "development"
    print("=" * 65)
    print("  IBVAP — AI Border Surveillance Video Analytics Platform")
    print(f"  Backend API Server: http://0.0.0.0:{port} (Local: http://127.0.0.1:{port})")
    print(f"  Interactive Docs:   http://0.0.0.0:{port}/api/docs")
    print(f"  Environment:        {os.environ.get('ENV', 'development')} | Reload: {is_dev}")
    print("=" * 65)
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=is_dev)
