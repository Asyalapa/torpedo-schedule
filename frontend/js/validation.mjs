/**
 * Регулярка для времени HH:MM.
 * Часы — 00..23, минуты — кратные 5.
 * Отличается от серверного `Time` (там часы 06..21) — на фронте мягче,
 * чтобы поле не «залипало», если что-то не влезло; жёсткие границы
 * всё равно проверяет бэкенд.
 */
const T = /^([01]\d|2[0-3]):[0-5][05]$/;

/**
 * Допустимые длительности тренировки в минутах.
 * Должно совпадать с DURATIONS в editor.mjs и Duration в models.py.
 */
const DURATIONS = new Set([30, 45, 60, 75]);

/**
 * Собирает объект события из данных формы.
 * Читает `FormData`, приводит типы, собирает вложенные структуры
 * (assignments, slots). Никакой валидации не делает — только преобразование.
 *
 * @param {FormData} fd — данные формы события
 * @param {Array<{id: string, name: string}>} groups — группы команды
 *   (нужны, чтобы подставить group_name по group_id)
 * @returns {object} событие в формате API
 */
export function build(fd, groups) {
	/**
	 * Читает поле формы и обрезает пробелы.
	 * @param {string} k — имя поля
	 * @returns {string}
	 */
	const g = (k) => (fd.get(k) ?? "").toString().trim();

	/**
	 * Собирает время из пары селектов `<n>_h` и `<n>_m`.
	 * Возвращает "" если хотя бы одно из полей не заполнено.
	 * @param {string} n — префикс (например, "start" или "friendly_start")
	 * @returns {string} "HH:MM" или ""
	 */
	const time = (n) => {
		const h = g(`${n}_h`),
			m = g(`${n}_m`);
		return !h || !m ? "" : `${h}:${m}`;
	};
	const kind = g("kind");
	const e = { id: g("id"), kind, date: g("date") };
	if (g("note")) e.note = g("note");

	if (kind === "training") {
		Object.assign(e, {
			start: time("start"),
			duration: Number(g("duration")),
			venue_id: g("venue_id"),
			type: g("type"),
		});
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
	} else if (kind === "friendly") {
		// ВАЖНО: площадка лежит в friendly_venue_id, а не в venue_id
		// (в форме тренировки и товарищеской игры поля называются по-разному,
		// чтобы FormData не путала их между собой).
		const vId = g("friendly_venue_id");
		if (vId) e.venue_id = vId;
		if (g("opponent")) e.opponent = g("opponent");

		// warmup — radio: "" | "30" | "45"
		const w = g("warmup");
		e.warmup_30 = w === "30";
		e.warmup_45 = w === "45";

		const mode = g("friendly_mode") || "same";

		if (mode === "same") {
			const start = time("friendly_start");
			const groupId = g("friendly_group_same");
			const group = groups.find((x) => x.id === groupId) || null;
			e.slots = [
				{
					group_id: group?.id ?? "",
					group_name: group?.name ?? null,
					start,
				},
			];
		} else {
			const count = Number(g("friendly_count")) || 0;
			e.slots = [];
			for (let i = 0; i < count; i++) {
				const groupId = g(`slot_group_${i}`);
				const group = groups.find((x) => x.id === groupId) || null;
				e.slots.push({
					group_id: group?.id ?? "",
					group_name: group?.name ?? null,
					start: time(`slot_start_${i}`),
				});
			}
		}
	} else {
		// tournament — поле start больше не рендерим
		e.title = g("title");
		if (g("place")) e.place = g("place");
		if (g("date_end")) e.date_end = g("date_end");
	}

	return e;
}

/**
 * Валидирует событие перед сохранением.
 *
 * Возвращает два списка:
 *  - errors — жёсткие ошибки, блокируют сохранение;
 *  - warnings — предупреждения (например, отсутствие времени friendly),
 *    показываются пользователю, но сохранить можно.
 *
 * @param {object} e — событие, уже собранное через build()
 * @param {Array<{id: string, name: string}>} [groups=[]] — группы команды
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validate(e, groups = []) {
	const errors = [];
	const warnings = [];

	if (!e.date) errors.push("Выберите день.");

	/**
	 * Проверяет формат времени: пустое значение пропускает,
	 * непустое — должно совпадать с T.
	 * @param {string} t
	 * @returns {boolean}
	 */
	const bad = (t) => t && !T.test(t);

	if (e.kind === "training") {
		if (bad(e.start)) errors.push("Время нужно указать полностью: часы и минуты.");
		if (!e.start) errors.push("Укажите время начала.");
		if (!DURATIONS.has(Number(e.duration)))
			errors.push("Длительность должна быть 30, 45, 60 или 75 минут.");
		if (!e.venue_id) errors.push("Выберите площадку.");
		if (e.type === "gym" && e.gym_mode === "groups" && !e.assignments?.length)
			errors.push("Отметьте хотя бы одну группу.");
	}

	if (e.kind === "friendly") {
		if (!e.slots?.length) {
			errors.push("Укажите хотя бы один состав.");
		} else {
			e.slots.forEach((s, i) => {
				if (s.start && bad(s.start)) {
					errors.push(
						`Состав ${i + 1}: время нужно указать полностью: часы и минуты.`,
					);
				}
				if (!s.start) {
					warnings.push(
						`Состав ${i + 1}: время начала не указано — в афише будет «время уточняется».`,
					);
				}
				if (groups.length && !s.group_id) {
					errors.push(`Состав ${i + 1}: выберите группу.`);
				}
			});

			// Один и тот же состав не должен играть дважды в одной игре
			const ids = e.slots.map((s) => s.group_id).filter(Boolean);
			if (ids.length !== new Set(ids).size) {
				errors.push("Один и тот же состав не может играть дважды в одной игре.");
			}
		}
	}

	if (e.kind === "tournament") {
		if (!e.title) errors.push("Введите название турнира.");
		if (e.date_end && e.date_end < e.date) {
			errors.push("Последний день турнира раньше первого.");
		}
	}

	return { errors, warnings };
}