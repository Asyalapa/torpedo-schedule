import json
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from .auth import current_user, require_admin, require_team_access
from .db import get_db
from .models import (
    GroupsIn,
    LoginAdmin,
    LoginCoach,
    ScheduleIn,
    SettingsIn,
    TeamCreate,
    TeamPatch,
    VenueIn,
    uid,
)
from .security import hash_password, new_token, verify_password

router = APIRouter(prefix="/api")

def now() -> str:
    return datetime.now(UTC).isoformat()


def dump(m) -> dict:
    return m.model_dump(exclude_none=True)


# ---------- утилиты ----------


def _week(ws: str) -> date:
    try:
        d = date.fromisoformat(ws)
    except ValueError:
        raise HTTPException(422, "Дата недели указана неверно")
    if d.weekday():
        raise HTTPException(422, "Неделя должна начинаться с понедельника")
    return d


def _in_week(ws, events):
    start = date.fromisoformat(ws)
    end = start + timedelta(days=6)
    for e in events:
        d1 = date.fromisoformat(e.date)
        d2 = date.fromisoformat(e.date_end) if getattr(e, "date_end", None) else d1
        if not (start <= d1 <= end) or not (start <= d2 <= end):
            raise HTTPException(422, "Событие выходит за пределы выбранной недели")


def _to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _normalize_events(events: list[dict]) -> list[dict]:
    """Совместимость со старыми форматами записей."""
    for e in events:
        # training: end -> duration
        if e.get("kind") == "training" and "end" in e:
            if "duration" not in e and e.get("start"):
                d = _to_minutes(e["end"]) - _to_minutes(e["start"])
                e["duration"] = d if d in (30, 45, 60, 75) else 60
            e.pop("end", None)

        # friendly: старый одиночный start -> список slots
        if e.get("kind") == "friendly" and "start" in e and "slots" not in e:
            e["slots"] = [{"group_id": "", "group_name": None, "start": e.pop("start")}]
            e.setdefault("warmup_30", False)
    return events


def _team_or_404(db, team_id: str) -> dict:
    row = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Команда не найдена")
    return dict(row)


def _load_schedule(db, team_id: str, ws: str) -> dict:
    _week(ws)
    row = db.execute(
        "SELECT week_start, events, announcements FROM schedules WHERE team_id=? AND week_start=?",
        (team_id, ws),
    ).fetchone()
    if not row:
        return {"week_start": ws, "events": [], "announcements": []}
    return {
        "week_start": row["week_start"],
        "events": _normalize_events(json.loads(row["events"])),
        "announcements": json.loads(row["announcements"]),
    }


def _save_schedule(db, team_id: str, doc: dict) -> dict:
    ts = now()
    db.execute(
        """INSERT INTO schedules (team_id, week_start, events, announcements, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(team_id, week_start) DO UPDATE SET
            events = excluded.events,
                                                       announcements = excluded.announcements,
                                                       updated_at = excluded.updated_at""",
        (
            team_id,
            doc["week_start"],
            json.dumps(doc["events"], ensure_ascii=False),
            json.dumps(doc["announcements"], ensure_ascii=False),
            ts,
            ts,
        ),
    )
    db.commit()
    return doc


def _load_groups(db, team_id: str) -> list[dict]:
    rows = db.execute(
        "SELECT id, name, print_on_roster FROM groups WHERE team_id = ? ORDER BY sort, name",
        (team_id,),
    ).fetchall()
    out = []
    for g in rows:
        players = db.execute(
            "SELECT id, name FROM players WHERE group_id = ? ORDER BY sort, name",
            (g["id"],),
        ).fetchall()
        out.append(
            {
                "id": g["id"],
                "name": g["name"],
                "players": [dict(p) for p in players],
                "print_on_roster": bool(g["print_on_roster"]),
            }
        )
    return out


# ---------- публичные роуты авторизации ----------


@router.get("/auth/teams")
def public_teams(db=Depends(get_db)):
    rows = db.execute("SELECT id, slug, name FROM teams ORDER BY name").fetchall()
    return [dict(r) for r in rows]


@router.post("/auth/login")
def login(body: dict, db=Depends(get_db)):
    # одна точка входа: пробуем и тренера, и админа — по наличию полей
    if "team_slug" in body:
        try:
            data = LoginCoach(**body)
        except Exception as e:
            raise HTTPException(422, str(e))
        team = db.execute("SELECT * FROM teams WHERE slug = ?", (data.team_slug,)).fetchone()
        if not team or not verify_password(data.password, team["password_hash"]):
            raise HTTPException(401, "Неверная команда или пароль")
        token = new_token({"role": "coach", "team_id": team["id"], "team_name": team["name"]})
        return {
            "token": token,
            "role": "coach",
            "team": {"id": team["id"], "name": team["name"]},
        }
    elif "admin_login" in body:
        try:
            data = LoginAdmin(**body)
        except Exception as e:
            raise HTTPException(422, str(e))
        admin = db.execute("SELECT * FROM admins WHERE login = ?", (data.admin_login,)).fetchone()
        if not admin or not verify_password(data.password, admin["password_hash"]):
            raise HTTPException(401, "Неверный логин или пароль администратора")
        token = new_token({"role": "admin", "admin_login": admin["login"]})
        return {"token": token, "role": "admin", "login": admin["login"]}
    raise HTTPException(422, "Укажите либо team_slug, либо admin_login")


@router.get("/auth/me")
def me(user=Depends(current_user), db=Depends(get_db)):
    if user.get("role") == "admin":
        return {"role": "admin", "login": user.get("admin_login")}
    team = _team_or_404(db, user["team_id"])
    return {"role": "coach", "team": {"id": team["id"], "name": team["name"]}}


# ---------- админ: управление командами ----------

admin_router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])

@admin_router.get("/teams")
def admin_list_teams(db=Depends(get_db)):
    rows = db.execute(
        "SELECT id, slug, name, subgroups_enabled FROM teams ORDER BY name"
    ).fetchall()
    return [dict(r) for r in rows]

@admin_router.post("/teams", status_code=201)
def admin_create_team(body: TeamCreate, db=Depends(get_db)):
    if db.execute("SELECT 1 FROM teams WHERE slug = ?", (body.slug,)).fetchone():
        raise HTTPException(409, "Команда с таким slug уже есть")
    team_id = uid()
    db.execute(
        "INSERT INTO teams (id, slug, name, password_hash, subgroups_enabled, created_at) "
        "VALUES (?, ?, ?, ?, NULL, ?)",
        (team_id, body.slug, body.name, hash_password(body.password), now()),
    )
    db.commit()
    return {"id": team_id, "slug": body.slug, "name": body.name}


@admin_router.put("/teams/{team_id}")
def admin_patch_team(team_id: str, body: TeamPatch, db=Depends(get_db)):
    _team_or_404(db, team_id)
    fields, values = [], []
    if body.name is not None:
        fields.append("name = ?")
        values.append(body.name)
    if body.password is not None:
        fields.append("password_hash = ?")
        values.append(hash_password(body.password))
    if body.subgroups_enabled is not None:
        fields.append("subgroups_enabled = ?")
        values.append(1 if body.subgroups_enabled else 0)
    if not fields:
        return {"ok": True}
    values.append(team_id)
    db.execute(f"UPDATE teams SET {', '.join(fields)} WHERE id = ?", values)
    db.commit()
    return {"ok": True}


@admin_router.delete("/teams/{team_id}")
def admin_delete_team(team_id: str, db=Depends(get_db)):
    _team_or_404(db, team_id)
    db.execute("DELETE FROM teams WHERE id = ?", (team_id,))
    db.commit()
    return {"deleted": team_id}


@admin_router.get("/venues")
def admin_list_venues(db=Depends(get_db)):
    rows = db.execute("SELECT id, name, color, tint FROM venues ORDER BY sort, name").fetchall()
    return [dict(r) for r in rows]


@admin_router.post("/venues", status_code=201)
def admin_create_venue(body: VenueIn, db=Depends(get_db)):
    if db.execute("SELECT 1 FROM venues WHERE id = ?", (body.id,)).fetchone():
        raise HTTPException(409, "Площадка с таким id уже есть")
    sort = db.execute("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM venues").fetchone()["n"]
    db.execute(
        "INSERT INTO venues (id, name, color, tint, sort) VALUES (?, ?, ?, ?, ?)",
        (body.id, body.name, body.color, body.tint, sort),
    )
    db.commit()
    return {"id": body.id, "name": body.name, "color": body.color, "tint": body.tint}


@admin_router.put("/venues/{vid}")
def admin_edit_venue(vid: str, body: VenueIn, db=Depends(get_db)):
    if body.id != vid:
        raise HTTPException(422, "id в теле не совпадает с id в адресе")
    if not db.execute("SELECT 1 FROM venues WHERE id = ?", (vid,)).fetchone():
        raise HTTPException(404, "Площадка не найдена")
    db.execute(
        "UPDATE venues SET name = ?, color = ?, tint = ? WHERE id = ?",
        (body.name, body.color, body.tint, vid),
    )
    db.commit()
    return {"id": vid, "name": body.name, "color": body.color, "tint": body.tint}


@admin_router.delete("/venues/{vid}")
def admin_delete_venue(vid: str, db=Depends(get_db)):
    if not db.execute("SELECT 1 FROM venues WHERE id = ?", (vid,)).fetchone():
        raise HTTPException(404, "Площадка не найдена")
    # защита: не удалять, если используется в расписании хотя бы одной команды
    used = []
    for r in db.execute("SELECT team_id, week_start, events FROM schedules").fetchall():
        for e in json.loads(r["events"]):
            if e.get("venue_id") == vid:
                used.append({"team_id": r["team_id"], "week": r["week_start"]})
                break
    if used:
        raise HTTPException(
            409,
            {
                "message": "Площадка используется в расписаниях",
                "usages": used,
            },
        )
    db.execute("DELETE FROM venues WHERE id = ?", (vid,))
    db.commit()
    return {"deleted": vid}


router.include_router(admin_router)


# ---------- команда: расписания, группы, площадки, настройки ----------

team_router = APIRouter(
    prefix="/teams/{team_id}",
    dependencies=[Depends(current_user)],
)


def _access(team_id: str, user: dict):
    require_team_access(team_id, user, None)


@team_router.get("/venues")
def get_venues(team_id: str, user=Depends(current_user), db=Depends(get_db)):
    _access(team_id, user)
    _team_or_404(db, team_id)
    # теперь площадки глобальные, фильтр по team_id не нужен
    rows = db.execute("SELECT id, name, color, tint FROM venues ORDER BY sort, name").fetchall()
    return [dict(r) for r in rows]


@team_router.get("/schedules/{ws}")
def get_schedule(team_id: str, ws: str, user=Depends(current_user), db=Depends(get_db)):
    _access(team_id, user)
    _team_or_404(db, team_id)
    return _load_schedule(db, team_id, ws)


@team_router.put("/schedules/{ws}")
def put_schedule(team_id: str, ws: str, body: ScheduleIn, user=Depends(current_user), db=Depends(get_db)):
    _access(team_id, user)
    _team_or_404(db, team_id)
    _week(ws)
    _in_week(ws, body.events)
    ids = [e.id for e in body.events]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "Повторяющиеся идентификаторы событий")
    doc = _load_schedule(db, team_id, ws)
    doc["events"] = [dump(e) for e in body.events]
    doc["announcements"] = [dump(a) for a in body.announcements]
    return _save_schedule(db, team_id, doc)


@team_router.post("/schedules/{ws}/copy-from/{src}", status_code=201)
def copy_week(team_id: str, ws: str, src: str, overwrite: bool = False, user=Depends(current_user), db=Depends(get_db)):
    _access(team_id, user)
    _team_or_404(db, team_id)
    delta = (_week(ws) - _week(src)).days
    row = db.execute(
        "SELECT events, announcements FROM schedules WHERE team_id=? AND week_start=?",
        (team_id, src),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Расписание исходной недели не найдено")
    exists = db.execute("SELECT 1 FROM schedules WHERE team_id=? AND week_start=?", (team_id, ws)).fetchone()
    if exists and not overwrite:
        raise HTTPException(409, "Расписание на эту неделю уже есть")
    def sh(v: str) -> str:
        return (date.fromisoformat(v) + timedelta(days=delta)).isoformat()
    events = []
    for e in json.loads(row["events"]):
        e = {**e, "id": uid(), "date": sh(e["date"])}
        if e.get("date_end"):
            e["date_end"] = sh(e["date_end"])
        events.append(e)
    anns = [{**a, "id": uid()} for a in json.loads(row["announcements"])]
    return _save_schedule(db, team_id, {"week_start": ws, "events": events, "announcements": anns})


@team_router.get("/groups")
def get_groups(team_id: str, user=Depends(current_user), db=Depends(get_db)):
    _access(team_id, user)
    _team_or_404(db, team_id)
    return _load_groups(db, team_id)


@team_router.put("/groups")
def put_groups(team_id: str, body: GroupsIn, force: bool = False, user=Depends(current_user), db=Depends(get_db)):
    _access(team_id, user)
    _team_or_404(db, team_id)

    keep = [g.id for g in body.groups]
    old_ids = [r["id"] for r in db.execute("SELECT id FROM groups WHERE team_id=?", (team_id,)).fetchall()]
    removed = [gid for gid in old_ids if gid not in keep]

    if removed and not force:
        weeks = []
        for r in db.execute("SELECT week_start, events FROM schedules WHERE team_id=?", (team_id,)).fetchall():
            ev = json.loads(r["events"])
            if any(a.get("group_id") in removed for e in ev for a in (e.get("assignments") or [])):
                weeks.append(r["week_start"])
        if weeks:
            raise HTTPException(
                409,
                {
                    "message": "Удаляемая группа назначена в расписаниях",
                    "weeks": sorted(weeks),
                },
            )

    with db:
        for i, g in enumerate(body.groups):
            db.execute(
                """INSERT INTO groups (id, team_id, name, sort, print_on_roster)
                   VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                                              sort = excluded.sort,
                                              print_on_roster = excluded.print_on_roster""",
                (g.id, team_id, g.name, i, 1 if g.print_on_roster else 0),
            )
            keep_players = [p.id for p in g.players]
            if keep_players:
                db.execute(
                    f"DELETE FROM players WHERE group_id=? AND id NOT IN ({','.join('?' * len(keep_players))})",
                    (g.id, *keep_players),
                )
            else:
                db.execute("DELETE FROM players WHERE group_id=?", (g.id,))
            for j, p in enumerate(g.players):
                db.execute(
                    """INSERT INTO players (id, group_id, name, sort) VALUES (?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort=excluded.sort""",
                    (p.id, g.id, p.name, j),
                )
        if removed:
            db.execute(
                f"DELETE FROM groups WHERE team_id=? AND id IN ({','.join('?' * len(removed))})",
                (team_id, *removed),
            )
    return _load_groups(db, team_id)


@team_router.get("/settings")
def get_settings(team_id: str, user=Depends(current_user), db=Depends(get_db)):
    _access(team_id, user)
    team = _team_or_404(db, team_id)
    return {
        "team_name": team["name"],
        "subgroups_enabled": (None if team["subgroups_enabled"] is None else bool(team["subgroups_enabled"])),
    }


@team_router.put("/settings")
def put_settings(team_id: str, body: SettingsIn, user=Depends(current_user), db=Depends(get_db)):
    _access(team_id, user)
    _team_or_404(db, team_id)
    val = None if body.subgroups_enabled is None else (1 if body.subgroups_enabled else 0)
    db.execute(
        "UPDATE teams SET name=?, subgroups_enabled=? WHERE id=?",
        (body.team_name, val, team_id),
    )
    if val == 1:
        n = db.execute("SELECT COUNT(*) AS n FROM groups WHERE team_id=?", (team_id,)).fetchone()["n"]
        if n == 0:
            for i, name in enumerate(["Север", "Юг", "Восток", "Вратари"]):
                db.execute(
                    "INSERT INTO groups (id, team_id, name, sort, print_on_roster) VALUES (?, ?, ?, ?, 1)",
                    (uid(), team_id, name, i),
                )
    db.commit()
    return get_settings(team_id, user, db)


router.include_router(team_router)
