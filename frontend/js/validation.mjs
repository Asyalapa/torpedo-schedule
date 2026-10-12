const T = /^([01]\d|2[0-3]):[0-5][05]$/; // минуты только кратные 5
export function build(fd, groups) {
	const g = (k) => (fd.get(k) ?? "").toString().trim();
	const time = (n) => {
		const h = g(`${n}_h`),
			m = g(`${n}_m`);
		return !h && !m ? "" : `${h}:${m}`;
	};
	const kind = g("kind");
	const e = { id: g("id"), kind, date: g("date") };
	if (g("note")) e.note = g("note");
	const start = time("start"),
		end = time("end");
	if (kind === "training") {
		Object.assign(e, { start, end, venue_id: g("venue_id"), type: g("type") });
		if (e.type === "gym") {
			e.gym_mode = g("gym_mode");
			if (e.gym_mode === "common") e.florball_warning = fd.has("florball");
			else
				e.assignments = fd
					.getAll("grp")
					.map((id) => groups.find((x) => x.id === id))
					.filter(Boolean)
					.map((x) => ({
						group_id: x.id,
						group_name: x.name,
						activity: g(`act_${x.id}`),
					}));
		}
	} else {
		if (start) e.start = start;
		if (end) e.end = end;
		if (kind === "friendly") {
			if (g("venue_id")) e.venue_id = g("venue_id");
			if (g("opponent")) e.opponent = g("opponent");
		} else {
			e.title = g("title");
			if (g("place")) e.place = g("place");
			if (g("date_end")) e.date_end = g("date_end");
		}
	}
	return e;
}
export function validate(e) {
	const err = [];
	if (!e.date) err.push("Выберите день.");
	const bad = (t) => t && !T.test(t);
	if (bad(e.start) || bad(e.end))
		err.push("Время нужно указать полностью: часы и минуты.");
	else if (e.kind === "training" && (!e.start || !e.end))
		err.push("Укажите время начала и окончания.");
	else if (e.end && !e.start) err.push("Укажите время начала.");
	else if (e.start && e.end && e.end <= e.start)
		err.push("Время окончания должно быть позже начала.");
	if (e.kind === "training") {
		if (!e.venue_id) err.push("Выберите площадку.");
		if (e.type === "gym" && e.gym_mode === "groups" && !e.assignments?.length)
			err.push("Отметьте хотя бы одну группу.");
	}
	if (e.kind === "tournament") {
		if (!e.title) err.push("Введите название турнира.");
		if (e.date_end && e.date_end < e.date)
			err.push("Последний день турнира раньше первого.");
	}
	return err;
}
