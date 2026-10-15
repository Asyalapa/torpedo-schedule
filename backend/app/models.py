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
    """Возвращает новый уникальный идентификатор (UUID v4 в виде строки)."""
    return str(uuid4())


def _iso(v: str) -> str:
    """
    Проверяет, что строка — валидная ISO-дата (YYYY-MM-DD).
    Используется как AfterValidator для типа Day.

    :raises ValueError: если дата не парсится
    """
    date.fromisoformat(v)
    return v


class Strict(BaseModel):
    """
    Базовая модель для всех схем проекта.

    - `extra="forbid"` — запрещает лишние поля в запросе (защита от опечаток
      и от попыток передать лишние данные);
    - `str_strip_whitespace=True` — автоматически обрезает пробелы по краям строк.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---------- типы-аннотации ----------
# Ниже — переиспользуемые типы для полей Pydantic.
# Они задают и формат (regex), и ограничения длины, и пост-валидацию.

# Время в формате HH:MM, часы 06..21, минуты кратные 05
Time = Annotated[str, StringConstraints(pattern=r"^(0[6-9]|1\d|2[01]):[0-5][05]$")]

# Длительность занятия в минутах (только эти четыре значения)
Duration = Literal[30, 45, 60, 75]

# Дата в формате YYYY-MM-DD; дополнительно проверяется через _iso
Day = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(_iso)]

# Имя (группы, игрока, турнира и т.п.)
Name = Annotated[str, StringConstraints(min_length=1, max_length=80)]

# Произвольная заметка к событию
Note = Annotated[str, StringConstraints(max_length=300)]

# Цвет в HEX-формате (#RRGGBB)
Hex = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]

# Slug команды: строчные латинские буквы, цифры, дефис
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{1,40}$")]

# Пароль (для тренера или админа)
Password = Annotated[str, StringConstraints(min_length=4, max_length=100)]

Activity = Literal["ofp", "stretch", "dribbling"]
# ---------- события ----------


class Assignment(Strict):
    """
    Назначение группы на конкретную активность внутри групповой тренировки.

    Используется в Training, когда `gym_mode == "groups"`.
    """
    group_id: str = Field(min_length=1)
    group_name: Name
    activity: Activity


class EventBase(Strict):
    """Общие поля всех событий расписания: id, дата, заметка."""
    id: str = Field(default_factory=uid)
    date: Day
    note: Note | None = None


class Training(EventBase):
    """
    Тренировка: лёд или зал.

    Для льда `gym_mode`, `florball_warning` и `assignments` запрещены.
    Для зала `gym_mode` обязателен:
      - "common" — общее занятие; допустим `florball_warning`;
      - "groups" — по подгруппам; обязателен непустой `assignments`.
    """
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
        """
        Проверяет, что набор полей соответствует типу занятия:
        льду нельзя указывать зальные параметры; залу нужен gym_mode;
        для «по подгруппам» — хотя бы одно назначение.
        """
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
    """
    Один состав в товарищеской игре.

    `group_id` пустой, если у команды нет подгрупп.
    `group_name` — снимок имени на момент сохранения (чтобы афиша
    не «поплыла», если группу потом переименуют).
    `start` может быть не указан — время уточняется позже.
    """
    group_id: str = ""
    group_name: Name | None = None
    start: Time | None = None


class Friendly(EventBase):
    """
    Товарищеская игра. Может состояться в одно время для всех составов
    или у каждого состава своё время (несколько FriendlySlot).

    `warmup_30` / `warmup_45` — сбор за 30 или 45 минут до начала
    (взаимоисключающие, но оба могут быть False).
    """
    kind: Literal["friendly"]
    opponent: Name | None = None
    venue_id: str | None = None
    warmup_30: bool = False
    warmup_45: bool = False
    slots: list[FriendlySlot]

    @model_validator(mode="after")
    def _slots(self):
        """Проверяет, что в игре есть хотя бы один состав."""
        if not self.slots:
            raise ValueError("Укажите хотя бы один состав")
        return self


class Tournament(EventBase):
    """
    Турнир. Может длиться один день или несколько (`date_end`).
    Поле `start` оставлено для совместимости со старыми записями;
    новые события его не отправляют.
    """
    kind: Literal["tournament"]
    title: Name
    place: Name | None = None
    start: Time | None = None
    date_end: Day | None = None

    @model_validator(mode="after")
    def _dates(self):
        """Проверяет, что последний день турнира не раньше первого."""
        if self.date_end and self.date_end < self.date:
            raise ValueError("Последний день турнира раньше первого")
        return self


# Дискриминированный union событий: kind определяет, какая модель применяется
Event = Annotated[Training | Friendly | Tournament, Field(discriminator="kind")]


class Announcement(Strict):
    """Объявление на неделю: короткий текст с уникальным id."""
    id: str = Field(default_factory=uid)
    text: Annotated[str, StringConstraints(min_length=1, max_length=300)]


class ScheduleIn(Strict):
    """Тело запроса PUT /schedules/{ws}: все события и объявления недели."""
    events: list[Event] = []
    announcements: list[Announcement] = []


class Player(Strict):
    """Игрок: уникальный id и имя."""
    id: str = Field(min_length=1)
    name: Name


class Group(Strict):
    """
    Подгруппа: id, имя, игроки, флаг печати в афише составов.
    Игроки хранятся внутри группы; один и тот же ребёнок может
    состоять в нескольких группах — тогда у него в каждой группе
    свой id.
    """
    id: str = Field(min_length=1)
    name: Name
    players: list[Player] = []
    print_on_roster: bool = True


class GroupsIn(Strict):
    """Тело запроса PUT /groups: список групп с игроками."""
    groups: list[Group]

    @model_validator(mode="after")
    def _unique(self):
        """
        Проверяет, что id групп и id игроков уникальны во всём запросе.
        Без этого SQLite-INSERT с ON CONFLICT(id) может перекинуть
        запись между группами и испортить данные.
        """
        ids = [g.id for g in self.groups] + [
            p.id for g in self.groups for p in g.players
        ]
        if len(ids) != len(set(ids)):
            raise ValueError("Идентификаторы групп и игроков должны быть уникальны")
        return self


class VenueIn(Strict):
    """Площадка: id, название, акцентный цвет и светлый фон (для афиши)."""
    id: str = Field(default_factory=uid)
    name: Name
    color: Hex
    tint: Hex


class SettingsIn(Strict):
    """Настройки команды: имя и признак использования подгрупп."""
    team_name: Name
    subgroups_enabled: bool | None = None


# ---------- авторизация и команды ----------


class LoginCoach(Strict):
    """Логин тренера: slug команды и пароль."""
    team_slug: Slug
    password: Password


class LoginAdmin(Strict):
    """Логин администратора: логин и пароль."""
    admin_login: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    password: Password


class TeamCreate(Strict):
    """Создание команды админом."""
    name: Name
    slug: Slug
    password: Password


class TeamPatch(Strict):
    """
    Частичное обновление команды: любое из полей можно не передавать.
    `password` приходит в открытом виде и хешируется на сервере.
    """
    name: Name | None = None
    password: Password | None = None
    subgroups_enabled: bool | None = None