import os

os.environ.update(ADMIN_TOKEN="secret-token", MONGODB_DB="t")
os.environ.pop("MONGODB_URI", None)
import mongomock
import pytest
from app.db import get_db, init_db
from app.main import app
from fastapi.testclient import TestClient

W, W2 = "2026-10-12", "2026-10-19"


def tr(**k):
    return {
        "kind": "training",
        "date": "2026-10-13",
        "start": "18:00",
        "end": "19:00",
        "venue_id": "nag",
        "type": "ice",
        **k,
    }


@pytest.fixture()
def c():
    db = mongomock.MongoClient()["t"]
    init_db(db)
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app, headers={"X-Admin-Token": "secret-token"})
    app.dependency_overrides.clear()


def put(c, events, ann=(), w=W):
    return c.put(f"/api/schedules/{w}", json={"events": events, "announcements": list(ann)})


def test_auth(c):
    anon = TestClient(app)
    assert anon.get("/api/health").status_code == 200
    assert anon.get("/api/groups").status_code == 401
    assert anon.get("/api/groups", headers={"X-Admin-Token": "bad"}).status_code == 401
    assert c.get("/api/groups").status_code == 200


@pytest.mark.parametrize(
    "bad",
    [
        tr(florball_warning=True),  # у льда нет флорбола
        tr(type="gym"),  # у зала нет режима
        tr(type="gym", gym_mode="groups", assignments=[]),  # группы не выбраны
        tr(
            type="gym",
            gym_mode="groups",
            florball_warning=True,
            assignments=[{"group_id": "g", "group_name": "С", "activity": "ofp"}],
        ),
        tr(type="gym", gym_mode="common", assignments=[{"group_id": "g", "group_name": "С", "activity": "ofp"}]),
        tr(start="19:00", end="18:00"),
        tr(end="19:03"),
        tr(date="2026-10-26"),
        tr(date="2026-13-01"),
        tr(foo=1),
        {"kind": "tournament", "date": "2026-10-18"},  # нет названия
        {"kind": "tournament", "date": "2026-10-18", "title": "К", "venue_id": "nag"},  # чужое поле
    ],
)
def test_invalid_events(c, bad):
    r = put(c, [bad])
    assert r.status_code == 422 and (r.json().get("errors") or r.json()["detail"])


def test_schedule_events_and_announcements(c):
    assert c.put("/api/schedules/2026-10-13", json={}).status_code == 422  # не понедельник
    gym = tr(type="gym", gym_mode="common", florball_warning=True)
    r = put(
        c,
        [
            tr(),
            gym,
            {"kind": "friendly", "date": "2026-10-17"},
            {"kind": "tournament", "date": "2026-10-18", "title": "Кубок", "date_end": "2026-10-19"},
        ],
        [{"text": "Привет"}],
    )
    assert r.status_code == 200 and len(r.json()["events"]) == 4
    got = c.get(f"/api/schedules/{W}").json()
    assert got["events"][1]["florball_warning"] is True and "assignments" not in got["events"][1]
    assert c.get(f"/api/schedules/{W2}").json()["events"] == []
    e = c.post(f"/api/schedules/{W}/events", json=tr(date="2026-10-14")).json()["events"][-1]
    assert c.post(f"/api/schedules/{W}/events", json={**tr(), "id": e["id"]}).status_code == 409
    assert c.put(f"/api/schedules/{W}/events/{e['id']}", json={**e, "end": "20:00"}).status_code == 200
    assert (
        c.delete(f"/api/schedules/{W}/events/{e['id']}").status_code == 200
        and c.delete(f"/api/schedules/{W}/events/{e['id']}").status_code == 404
    )
    a = c.post(f"/api/schedules/{W}/announcements", json={"text": "Второе"}).json()["announcements"][-1]
    assert (
        c.put(f"/api/schedules/{W}/announcements/{a['id']}", json={"text": "Правка"}).json()["announcements"][-1][
            "text"
        ]
        == "Правка"
    )
    assert len(c.delete(f"/api/schedules/{W}/announcements/{a['id']}").json()["announcements"]) == 1


def test_copy_week(c):
    put(
        c,
        [tr(), {"kind": "tournament", "date": "2026-10-18", "title": "Кубок", "date_end": "2026-10-19"}],
        [{"text": "А"}],
    )
    src = c.get(f"/api/schedules/{W}").json()
    r = c.post(f"/api/schedules/{W2}/copy-from/{W}")
    assert r.status_code == 201
    new = r.json()
    assert new["events"][0]["date"] == "2026-10-20" and new["events"][1]["date_end"] == "2026-10-26"
    assert {e["id"] for e in new["events"]}.isdisjoint(e["id"] for e in src["events"])
    assert c.get(f"/api/schedules/{W}").json()["events"] == src["events"]  # оригинал не тронут
    assert c.post(f"/api/schedules/{W2}/copy-from/{W}").status_code == 409
    assert c.post(f"/api/schedules/{W2}/copy-from/{W}?overwrite=true").status_code == 201
    assert c.post(f"/api/schedules/{W}/copy-from/2026-09-28").status_code == 404


def test_groups_settings_snapshots(c):
    assert c.get("/api/settings").json()["subgroups_enabled"] is None
    c.put("/api/settings", json={"team_name": "ХК", "subgroups_enabled": True})
    gs = c.get("/api/groups").json()
    assert [g["name"] for g in gs] == ["Север", "Юг", "Восток", "Вратари"] and all(g["players"] == [] for g in gs)
    c.put("/api/settings", json={"team_name": "ХК", "subgroups_enabled": True})
    assert len(c.get("/api/groups").json()) == 4
    north = gs[0]["id"]
    body = [{**g, "players": []} for g in gs]
    body[0]["players"] = [{"id": "p1", "name": "Игрок 1"}, {"id": "p2", "name": "Игрок 2"}]
    assert [p["name"] for p in c.put("/api/groups", json={"groups": body}).json()[0]["players"]] == [
        "Игрок 1",
        "Игрок 2",
    ]
    assert (
        c.get(f"/api/groups/{north}").json()["players"][1]["id"] == "p2"
        and c.get("/api/groups/nope").status_code == 404
    )
    snap = c.post("/api/roster-snapshots").json()
    body[0]["name"] = "Север-2"
    body[0]["players"].pop()
    c.put("/api/groups", json={"groups": body})
    assert c.get("/api/groups").json()[0]["id"] == north  # id стабилен при переименовании
    assert (
        c.get("/api/roster-snapshots").json()[0]["groups"][0]["players"][1]["name"] == "Игрок 2"
        and snap["groups"][0]["name"] == "Север"
    )
    put(
        c,
        [
            tr(
                type="gym",
                gym_mode="groups",
                assignments=[{"group_id": north, "group_name": "Север", "activity": "stretch"}],
            )
        ],
    )
    r = c.put("/api/groups", json={"groups": body[1:]})
    assert r.status_code == 409 and r.json()["detail"]["weeks"] == [W]
    assert len(c.get("/api/groups").json()) == 4  # при 409 ничего не удалено
    assert c.put("/api/groups?force=true", json={"groups": body[1:]}).status_code == 200
    assert (
        c.get(f"/api/schedules/{W}").json()["events"][0]["assignments"][0]["group_name"] == "Север"
    )  # история читаема
    assert (
        c.put(
            "/api/groups", json={"groups": [{"id": "a", "name": "А", "players": [{"id": "a", "name": "Х"}]}]}
        ).status_code
        == 422
    )


def test_venues(c):
    assert len(c.get("/api/venues").json()) == 3
    put(c, [tr()])
    assert c.delete("/api/venues/nag").status_code == 409
    assert (
        c.post("/api/venues", json={"id": "new", "name": "Новая", "color": "#AA00FF", "tint": "#F3E5FF"}).status_code
        == 201
    )
    assert c.post("/api/venues", json={"name": "X", "color": "red", "tint": "#FFFFFF"}).status_code == 422
    assert c.delete("/api/venues/new").status_code == 200
