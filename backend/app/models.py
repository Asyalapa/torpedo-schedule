from datetime import date
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)


def uid() -> str:
    return str(uuid4())


def _iso(v: str) -> str:
    date.fromisoformat(v)
    return v


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Time = Annotated[str, StringConstraints(pattern=r"^(0[6-9]|1\d|2[01]):[0-5][05]$")]
Duration = Literal[30, 45, 60, 75]
Day = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(_iso)]
Name = Annotated[str, StringConstraints(min_length=1, max_length=80)]
Note = Annotated[str, StringConstraints(max_length=300)]
Hex = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{1,40}$")]
Password = Annotated[str, StringConstraints(min_length=4, max_length=100)]


# ---------- события ----------


class Assignment(Strict):
    group_id: str = Field(min_length=1)
    group_name: Name
    activity: Literal["ofp", "stretch", "dribbling"]


class EventBase(Strict):
    id: str = Field(default_factory=uid)
    date: Day
    note: Note | None = None


class Training(EventBase):
    kind: Literal["training"]
    start: Time
    duration: Duration
    venue_id: str = Field(min_length=1)
    type: Literal["ice", "gym"]
    gym_mode: Literal["common", "groups"] | None = None
    florball_warning: bool | None = None
    assignments: list[Assignment] | None = None

    @model_validator(mode="after")
    def _gym(self):
        if self.type == "ice":
            if self.gym_mode or self.florball_warning is not None or self.assignments is not None:
                raise ValueError("Для льда нельзя указывать параметры зала")
        elif self.gym_mode is None:
            raise ValueError("Для зала укажите режим занятия")
        elif self.gym_mode == "common":
            if self.assignments is not None:
                raise ValueError("В общем занятии не бывает назначений по группам")
        else:
            if self.florball_warning is not None:
                raise ValueError("Предупреждение о флорболе только для общего занятия")
            if not self.assignments:
                raise ValueError("Отметьте хотя бы одну группу")
        return self


class FriendlySlot(Strict):
    group_id: str = ""  # пусто, если у команды нет подгрупп
    group_name: Name | None = None  # снимок имени; пусто, если группы нет
    start: Time


class Friendly(EventBase):
    kind: Literal["friendly"]
    opponent: Name | None = None
    venue_id: str | None = None
    warmup_30: bool = False
    slots: list[FriendlySlot]

    @model_validator(mode="after")
    def _slots(self):
        if not self.slots:
            raise ValueError("Укажите хотя бы одно время начала")
        # если у команды подгруппы, group_id обязателен в каждом слоте
        # (проверка «есть ли подгруппы» — на уровне роутов, здесь только формат)
        for s in self.slots:
            if not s.start:
                raise ValueError("У каждого состава должно быть время начала")
        return self


class Tournament(EventBase):
    kind: Literal["tournament"]
    title: Name
    place: Name | None = None
    start: Time | None = None
    date_end: Day | None = None

    @model_validator(mode="after")
    def _dates(self):
        if self.date_end and self.date_end < self.date:
            raise ValueError("Последний день турнира раньше первого")
        return self


Event = Annotated[Training | Friendly | Tournament, Field(discriminator="kind")]


class Announcement(Strict):
    id: str = Field(default_factory=uid)
    text: Annotated[str, StringConstraints(min_length=1, max_length=300)]


class ScheduleIn(Strict):
    events: list[Event] = []
    announcements: list[Announcement] = []


class Player(Strict):
    id: str = Field(min_length=1)
    name: Name


class Group(Strict):
    id: str = Field(min_length=1)
    name: Name
    players: list[Player] = []
    print_on_roster: bool = True


class GroupsIn(Strict):
    groups: list[Group]

    @model_validator(mode="after")
    def _unique(self):
        ids = [g.id for g in self.groups] + [p.id for g in self.groups for p in g.players]
        if len(ids) != len(set(ids)):
            raise ValueError("Идентификаторы групп и игроков должны быть уникальны")
        return self


class VenueIn(Strict):
    id: str = Field(default_factory=uid)
    name: Name
    color: Hex
    tint: Hex


class SettingsIn(Strict):
    team_name: Name
    subgroups_enabled: bool | None = None


# ---------- авторизация и команды ----------


class LoginCoach(Strict):
    team_slug: Slug
    password: Password


class LoginAdmin(Strict):
    admin_login: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    password: Password


class TeamCreate(Strict):
    name: Name
    slug: Slug
    password: Password


class TeamPatch(Strict):
    name: Name | None = None
    password: Password | None = None
    subgroups_enabled: bool | None = None
