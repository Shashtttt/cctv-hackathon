import argparse
import os
import socket
import sys
from pathlib import Path
import uvicorn

# Ensure root directory is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def get_local_ip() -> str:
    """Detect LAN IP address of this machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run IBVAP Surveillance Backend")
    parser.add_argument(
        "--host",
        default=os.getenv("HOST", "0.0.0.0"),
        help="Host interface to bind (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("PORT", os.getenv("BACKEND_PORT", 8000))),
        help="Port number to bind (default: 8000)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        default=True,
        help="Enable uvicorn reload",
    )
    args, _ = parser.parse_known_args()

    lan_ip = get_local_ip()
    print("=" * 68)
    print("  IBVAP — AI Border Surveillance Video Analytics Platform")
    print(f"  Local Access:      http://127.0.0.1:{args.port}")
    print(f"  Network / Phone:   http://{lan_ip}:{args.port}")
    print(f"  Interactive Docs:  http://127.0.0.1:{args.port}/api/docs")
    print("=" * 68)

    uvicorn.run("backend.main:app", host=args.host, port=args.port, reload=args.reload)

