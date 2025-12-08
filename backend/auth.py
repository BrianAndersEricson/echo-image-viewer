"""
Simple local authentication for Echo Image Viewer.
Stores credentials in a JSON file with hashed passwords.
"""

import os
import json
import secrets
import hashlib
from pathlib import Path
from typing import Optional
from datetime import datetime, timedelta

# Auth configuration
AUTH_ENABLED = os.environ.get("AUTH_ENABLED", "false").lower() == "true"
AUTH_FILE = Path(os.environ.get("AUTH_FILE", "/app/data/auth.json"))
SESSION_EXPIRY_HOURS = int(os.environ.get("SESSION_EXPIRY_HOURS", "168"))  # 1 week default

# In-memory session store (simple for single-instance use)
sessions: dict[str, dict] = {}


def hash_password(password: str, salt: str = None) -> tuple[str, str]:
    """Hash a password with a salt using SHA-256."""
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode()).hexdigest()
    return hashed, salt


def verify_password(password: str, hashed: str, salt: str) -> bool:
    """Verify a password against its hash."""
    check_hash, _ = hash_password(password, salt)
    return secrets.compare_digest(check_hash, hashed)


def load_auth_data() -> Optional[dict]:
    """Load auth data from file."""
    if not AUTH_FILE.exists():
        return None
    try:
        with open(AUTH_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def save_auth_data(data: dict) -> bool:
    """Save auth data to file."""
    try:
        AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(AUTH_FILE, 'w') as f:
            json.dump(data, f)
        return True
    except IOError:
        return False


def is_setup_complete() -> bool:
    """Check if initial setup has been completed."""
    data = load_auth_data()
    return data is not None and "username" in data


def setup_credentials(username: str, password: str) -> bool:
    """Set up initial credentials (first run only)."""
    if is_setup_complete():
        return False

    hashed, salt = hash_password(password)
    data = {
        "username": username,
        "password_hash": hashed,
        "salt": salt,
        "created": datetime.now().isoformat()
    }
    return save_auth_data(data)


def verify_credentials(username: str, password: str) -> bool:
    """Verify login credentials."""
    data = load_auth_data()
    if not data:
        return False

    if data.get("username") != username:
        return False

    return verify_password(password, data["password_hash"], data["salt"])


def create_session(username: str) -> str:
    """Create a new session and return the token."""
    token = secrets.token_urlsafe(32)
    sessions[token] = {
        "username": username,
        "created": datetime.now(),
        "expires": datetime.now() + timedelta(hours=SESSION_EXPIRY_HOURS)
    }
    return token


def validate_session(token: str) -> bool:
    """Check if a session token is valid."""
    if not token or token not in sessions:
        return False

    session = sessions[token]
    if datetime.now() > session["expires"]:
        del sessions[token]
        return False

    return True


def destroy_session(token: str) -> bool:
    """Destroy a session (logout)."""
    if token in sessions:
        del sessions[token]
        return True
    return False


def get_auth_status() -> dict:
    """Get current auth status for frontend."""
    return {
        "enabled": AUTH_ENABLED,
        "setup_complete": is_setup_complete() if AUTH_ENABLED else True
    }
