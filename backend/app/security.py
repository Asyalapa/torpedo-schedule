import secrets
from datetime import UTC, datetime, timedelta

import jwt
from passlib.context import CryptContext

from .config import settings

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd.verify(plain, hashed)
    except Exception:
        return False


def new_token(payload: dict) -> str:
    now = datetime.now(UTC)
    body = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.jwt_ttl_hours)).timestamp()),
        "jti": secrets.token_urlsafe(8),
    }
    return jwt.encode(body, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
