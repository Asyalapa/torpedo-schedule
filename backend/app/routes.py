from datetime import date
from typing import Annotated, Literal, Union
from uuid import uuid4
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

uid = lambda: str(uuid4())
def _iso(v: str) -> str:
    date.fromisoformat(v)
    return v

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

Time = Annotated[str, StringConstraints(pattern=r'^([01]\d|2[0-3]):[0-5][05]$')]  # минуты кратны 5
Day = Annotated[str, StringConstraints(pattern=r'^\d{4}-\d{2}-\d{2}$'), AfterValidator(_iso)]
Name = Annotated[str, StringConstraints(min_length=1, max_length=80)]
Note = Annotated[str, StringConstraints(max_length=300)]
Hex = Annotated[str, StringConstraints(pattern=r'^#[0-9A-Fa-f]{6}$')]

class Assignment(Strict):
    group_id: str = Field(min_length=1)
    group_name: Name  # снимок названия на момент составления
    activity: Literal['ofp', 'stretch', 'dribbling']

class EventBase(Strict):
    id: str = Field(default_factory=uid)
    date: Day
    note: Note | None = None

    @model_validator(mode='after')
    def _times(self):
        s, e = getattr(self, 'start', None), getattr(self, 'end', None)
        if e and not s: raise ValueError('Укажите время начала')
        if s and e and e <= s: raise ValueError('Время окончания должно быть позже начала')
        return self

class Training(EventBase):
    kind: Literal['training']
    start: Time
    end: Time
    venue_id: str = Field(min_length=1)
    type: Literal['ice', 'gym']
    gym_mode: Literal['common', 'groups'] | None = None
    florball_warning: bool | None = None
    assignments: list[Assignment] | None = None

    @model_validator(mode='after')
    def _gym(self):
        if self.type == 'ice':
            if self.gym_mode or self.florball_warning is not None or self.assignments is not None:
                raise ValueError('Для льда нельзя указывать параметры зала')
        elif self.gym_mode is None:
            raise ValueError('Для зала укажите режим занятия')
        elif self.gym_mode == 'common':
            if self.assignments is not None: raise ValueError('В общем занятии не бывает назначений по группам')
        else:
            if self.florball_warning is not None: raise ValueError('Предупреждение о флорболе только для общего занятия')
            if not self.assignments: raise ValueError('Отметьте хотя бы одну группу')
        return self

class Friendly(EventBase):
    kind: Literal['friendly']
    start: Time | None = None
    end: Time | None = None
    venue_id: str | None = None
    opponent: Name | None = None

class Tournament(EventBase):
    kind: Literal['tournament']
    title: Name
    place: Name | None = None
    start: Time | None = None
    end: Time | None = None
    date_end: Day | None = None

    @model_validator(mode='after')
    def _dates(self):
        if self.date_end and self.date_end < self.date: raise ValueError('Последний день турнира раньше первого')
        return self

Event = Annotated[Union[Training, Friendly, Tournament], Field(discriminator='kind')]

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
    order: int | None = Field(None, exclude=True)  # приходит из GET, порядок задаёт позиция в списке
    players: list[Player] = []

class GroupsIn(Strict):
    groups: list[Group]

    @model_validator(mode='after')
    def _unique(self):
        ids = [g.id for g in self.groups] + [p.id for g in self.groups for p in g.players]
        if len(ids) != len(set(ids)): raise ValueError('Идентификаторы групп и игроков должны быть уникальны')
        return self

class VenueIn(Strict):
    id: str = Field(default_factory=uid)
    name: Name
    color: Hex
    tint: Hex

class SettingsIn(Strict):
    team_name: Name
    subgroups_enabled: bool | None = None