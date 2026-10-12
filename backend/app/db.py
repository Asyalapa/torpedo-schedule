"""from functools import lru_cache
from fastapi import HTTPException
from pymongo import ASCENDING, MongoClient
from .config import settings

@lru_cache
def _client() -> MongoClient:
    return MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000, tz_aware=True)

def get_db():
    if not settings.mongodb_uri:
        raise HTTPException(503, 'На сервере не задан MONGODB_URI')
    return _client()[settings.mongodb_db]

VENUES = [
    {'id': 'nag', 'name': 'КРК «Нагорный»', 'color': '#2D6CDF', 'tint': '#E8F0FD'},
    {'id': 'volga', 'name': '«Волга Арена»', 'color': '#727E8D', 'tint': '#EEF0F3'},
    {'id': 'radiy', 'name': '«Радий»', 'color': '#26845B', 'tint': '#E6F4EC'},
]

def init_db(db) -> None:
    db.schedules.create_index([('week_start', ASCENDING)], unique=True)
    for coll in ('groups', 'venues', 'roster_snapshots'):
        db[coll].create_index([('id', ASCENDING)], unique=True)
    if db.venues.count_documents({}) == 0:
        db.venues.insert_many([dict(v) for v in VENUES])
    db.settings.update_one({'key': 'team'}, {'$setOnInsert': {
        'key': 'team', 'team_name': 'ХК Торпедо · 2019', 'subgroups_enabled': None}}, upsert=True)
"""

import sqlite3

from .config import settings
from .security import hash_password

# ---------- подключение ----------


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(
        settings.sqlite_path,
        detect_types=sqlite3.PARSE_DECLTYPES,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


# ---------- схема ----------

SCHEMA = """
         CREATE TABLE IF NOT EXISTS teams (
                                              id                TEXT PRIMARY KEY,
                                              slug              TEXT NOT NULL UNIQUE,
                                              name              TEXT NOT NULL,
                                              password_hash     TEXT NOT NULL,
                                              subgroups_enabled INTEGER,
                                              created_at        TEXT NOT NULL
         );

         CREATE TABLE IF NOT EXISTS admins (
                                               id            TEXT PRIMARY KEY,
                                               login         TEXT NOT NULL UNIQUE,
                                               password_hash TEXT NOT NULL,
                                               created_at    TEXT NOT NULL
         );

         CREATE TABLE IF NOT EXISTS venues (
                                               id    TEXT PRIMARY KEY,
                                               name  TEXT NOT NULL,
                                               color TEXT NOT NULL,
                                               tint  TEXT NOT NULL,
                                               sort  INTEGER NOT NULL DEFAULT 0
         );

         CREATE TABLE IF NOT EXISTS schedules (
                                                  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
             week_start    TEXT NOT NULL,
             events        TEXT NOT NULL,
             announcements TEXT NOT NULL,
             created_at    TEXT NOT NULL,
             updated_at    TEXT NOT NULL,
             PRIMARY KEY (team_id, week_start)
             );

         CREATE TABLE IF NOT EXISTS groups (
                                               id              TEXT PRIMARY KEY,
                                               team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
             name            TEXT NOT NULL,
             sort            INTEGER NOT NULL DEFAULT 0,
             print_on_roster INTEGER NOT NULL DEFAULT 1
             );

         CREATE INDEX IF NOT EXISTS idx_groups_team ON groups(team_id);

         CREATE TABLE IF NOT EXISTS players (
                                                id       TEXT PRIMARY KEY,
                                                group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
             name     TEXT NOT NULL,
             sort     INTEGER NOT NULL DEFAULT 0
             );

         CREATE INDEX IF NOT EXISTS idx_players_group ON players(group_id);

         CREATE TABLE IF NOT EXISTS roster_snapshots (
                                                         id       TEXT PRIMARY KEY,
                                                         team_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
             taken_at TEXT NOT NULL,
             groups   TEXT NOT NULL
             );
         """

DEFAULT_VENUES = [
    {"id": "nag", "name": "КРК «Нагорный»", "color": "#2D6CDF", "tint": "#E8F0FD"},
    {"id": "volga", "name": "«Волга Арена»", "color": "#727E8D", "tint": "#EEF0F3"},
    {"id": "radiy", "name": "«Радий»", "color": "#26845B", "tint": "#E6F4EC"},
]


def init_db() -> None:
    conn = get_db()
    with conn:
        conn.executescript(SCHEMA)

        # админ: создаём один раз, если таблица пуста
        n = conn.execute("SELECT COUNT(*) AS n FROM admins").fetchone()["n"]
        if n == 0:
            conn.execute(
                "INSERT INTO admins (id, login, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))",
                ("admin-root", settings.admin_login, hash_password(settings.admin_password)),
            )

        # если команд ещё нет — создаём одну дефолтную, чтобы тренер мог войти
        n = conn.execute("SELECT COUNT(*) AS n FROM teams").fetchone()["n"]
        if n == 0:
            team_id = "torpedo-2019"
            slug = "torpedo-2019"
            conn.execute(
                "INSERT INTO teams (id, slug, name, password_hash, subgroups_enabled, created_at) "
                "VALUES (?, ?, ?, ?, NULL, datetime('now'))",
                (team_id, slug, "ХК Торпедо · 2019", hash_password("torpedo19")),
            )
            # дефолтные площадки — если таблица пуста
        n = conn.execute("SELECT COUNT(*) AS n FROM venues").fetchone()["n"]
        if n == 0:
            for i, v in enumerate(DEFAULT_VENUES):
                conn.execute(
                    "INSERT INTO venues (id, name, color, tint, sort) VALUES (?, ?, ?, ?, ?)",
                    (v["id"], v["name"], v["color"], v["tint"], i),
                )
    conn.close()
