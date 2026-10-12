import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    sqlite_path: str
    jwt_secret: str
    jwt_ttl_hours: int
    admin_login: str
    admin_password: str
    cors_origins: list[str]


def load() -> Settings:
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        raise RuntimeError("JWT_SECRET не задан: без него токены можно подделать")
    admin_login = os.environ.get("ADMIN_LOGIN", "").strip()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_login or not admin_password:
        raise RuntimeError("ADMIN_LOGIN и ADMIN_PASSWORD обязательны для первого запуска")
    return Settings(
        sqlite_path=os.environ.get("SQLITE_PATH", "./torpedo.db"),
        jwt_secret=secret,
        jwt_ttl_hours=int(os.environ.get("JWT_TTL_HOURS", "720")),
        admin_login=admin_login,
        admin_password=admin_password,
        cors_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()],
    )


settings = load()
