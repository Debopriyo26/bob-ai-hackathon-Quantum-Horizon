"""
Clin.IQ - Main Application Entrypoint
Runs the Flask application and serves the frontend.
"""

import sys
from pathlib import Path

# Add backend directory to Python path
backend_dir = Path(__file__).resolve().parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from backend.app import app, _init_db

if __name__ == "__main__":
    _init_db()
    print("Starting Clin.IQ on http://localhost:5000 ...")
    app.run(host="0.0.0.0", port=5000, debug=False)
