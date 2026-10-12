from fastapi import Depends, Header, HTTPException

from .security import decode_token


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def current_user(authorization: str | None = Header(None)) -> dict:
    """Возвращает payload токена: {role, team_id?, admin_login?}."""
    token = _bearer(authorization)
    if not token:
        raise HTTPException(401, "Нужен токен авторизации")
    try:
        return decode_token(token)
    except Exception:
        raise HTTPException(401, "Токен недействителен или истёк")


def require_admin(user: dict = Depends(current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Требуется роль администратора")
    return user


def require_coach_or_admin(user: dict = Depends(current_user)) -> dict:
    if user.get("role") not in ("coach", "admin"):
        raise HTTPException(403, "Недостаточно прав")
    return user


def require_team_access(team_id: str, user: dict, db) -> None:
    """Тренер может работать только со своей командой; админ — с любой."""
    if user.get("role") == "admin":
        return
    if user.get("role") == "coach" and user.get("team_id") == team_id:
        return
    raise HTTPException(403, "Нет доступа к этой команде")
