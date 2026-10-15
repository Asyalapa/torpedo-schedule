import { enhanceAllSelects } from "./dropdown.mjs";
import {addDays, esc, addMinutes, fmt} from './poster.mjs';
import { emit, on, state, uid } from "./state.mjs";
import { build, validate } from "./validation.mjs";

/**
 * Короткий доступ к document.querySelector.
 * @param {string} s — CSS-селектор
 * @returns {Element|null}
 */
const $ = (s) => document.querySelector(s);

/**
 * Дополняет число нулём слева до двух разрядов.
 * @param {number} n
 * @returns {string}
 */
const pad = (n) => String(n).padStart(2, "0");

/**
 * Часы для селектов времени: "06".."21".
 * Меньше 06 и больше 21 не даём — тренировки в это время не проводятся.
 */
const H = Array.from({ length: 16 }, (_, i) => pad(6 + i));

/**
 * Минуты для селектов времени: "00", "05", ..., "55".
 */
const M = Array.from({ length: 12 }, (_, i) => pad(i * 5));

/**
 * Значения по умолчанию для поля «Начало» тренировки.
 * Дефолт подставляется только для тренировок (см. tsel).
 */
const DEFAULT_START_H = "06";
const DEFAULT_START_M = "00";

/**
 * Длительность по умолчанию.
 */
const DEFAULT_DURATION = "75";

/**
 * Варианты длительности для выпадашки в форме.
 * Значения — строки, потому что так удобнее сравнивать с option.value.
 */
const DURATIONS = [
	["30", "30 минут"],
	["45", "45 минут"],
	["60", "1 час"],
	["75", "1 час 15 минут"],
];

/**
 * Собирает HTML <option> из пар [value, label].
 * @param {Array<[string, string]>} a — массив пар
 * @param {string} sel — значение, которое должно быть отмечено selected
 * @returns {string}
 */
const opts = (a, sel) =>
	a
		.map(
			([v, t] = []) =>
				`<option value="${v ?? ""}" ${v === sel ? "selected" : ""}>${t ?? v ?? "—"}</option>`,
		)
		.join("");

/**
 * Рисует пару селектов «часы : минуты» для времени.
 *
 * @param {string} n — префикс имён; итоговые поля будут `<n>_h` и `<n>_m`
 * @param {string} [v=""] — текущее значение "HH:MM"
 * @param {boolean} [withDefault=false] — подставлять ли 06:00, если время пустое
 *   (только для тренировки; для friendly и tournament не надо)
 * @returns {string} HTML
 */
const tsel = (n, v = "", withDefault = false) => {
	const [h, m] = (v || "").split(":");
	const def = withDefault && n === "start";
	const hSel = h || (def ? DEFAULT_START_H : "");
	const mSel = m || (def ? DEFAULT_START_M : "");
	return `<span class="time time-field"><select name="${n}_h" aria-label="Часы">${opts([["", "—"], ...H.map((x) => [x, x])], hSel)}</select><span class="sep time-field__separator">:</span><select name="${n}_m" aria-label="Минуты">${opts([["", "—"], ...M.map((x) => [x, x])], mSel)}</select></span>`;
};

/**
 * Рисует селект длительности.
 * @param {string} [v=""] — текущее значение в минутах (строкой)
 * @returns {string} HTML
 */
const dsel = (v = "") => {
	const val = v || DEFAULT_DURATION;
	return `<select name="duration" aria-label="Длительность">${opts(DURATIONS, val)}</select>`;
};

/**
 * Активности для зала по подгруппам: код → подпись.
 * Коды должны совпадать с ACT в poster.mjs и Activity в models.py.
 */
const ACT = [
	["ofp", "ОФП"],
	["stretch", "Растяжка"],
	["dribbling", "Дриблинг"],
];

/**
 * Рисует блок радио-кнопок «segmented».
 * @param {string} name — общее имя radio-группы
 * @param {Array<[string, string]>} list — пары [value, label]
 * @param {string} cur — текущее выбранное значение
 * @param {string} [attr=""] — дополнительные data-атрибуты на обёртке
 * @returns {string} HTML
 */
const seg = (name, list, cur, attr = "") =>
	`<div class="seg segmented" ${attr}>${list.map(([v, t]) => `<label><input type="radio" name="${name}" value="${v}" ${v === cur ? "checked" : ""}>${t}</label>`).join("")}</div>`;

/**
 * Рисует строки выбора подгрупп для групповой тренировки в зале.
 * @param {Object<string, {on: boolean, act: string}>} [prev={}] — предыдущее
 *   состояние: { group_id: { on, act } } (для редактирования существующего события)
 * @returns {string} HTML
 */
const rows = (prev = {}) =>
	state.groups
		.map((g) => {
			const p = prev[g.id] || {};
			return `<div class="grow group-row" data-id="${g.id}"><label><input type="checkbox" name="grp" value="${g.id}" ${p.on ? "checked" : ""}> ${esc(g.name)}</label><button type="button" class="info button--info" data-tip="${g.id}" aria-label="Состав: ${esc(g.name)}">i</button><select name="act_${g.id}" aria-label="Занятие">${ACT.map(([v, t]) => `<option value="${v}" ${p.act === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
		})
		.join("");

/**
 * Считывает текущее состояние строк подгрупп из DOM.
 * Используется при перерисовке `#grows`, чтобы не потерять выбор пользователя.
 * @returns {Object<string, {on: boolean, act: string}>}
 */
const readRows = () =>
	Object.fromEntries(
		[...document.querySelectorAll("#grows .grow")].map((r) => [
			r.dataset.id,
			{
				on: r.querySelector("[type=checkbox]").checked,
				act: r.querySelector("select").value,
			},
		]),
	);

/**
 * Дата, выбранная в прошлый раз в форме.
 * Нужна, чтобы при добавлении нескольких событий подряд форма
 * открывалась на той же дате, а не сбрасывалась на начало недели.
 */
let lastDate = null;

/**
 * Рисует <option> для выбора состава (группы) в товарищеской игре.
 * Если у команды нет подгрупп — одиночный вариант «— вся команда —».
 * @param {string} [selected=""] — id выбранной группы
 * @returns {string} HTML
 */
const groupOptions = (selected = "") => {
	if (!state.groups.length) {
		return `<option value="" ${selected ? "" : "selected"}>— вся команда —</option>`;
	}
	return (
		`<option value="" ${selected ? "" : "selected"}>— выберите состав —</option>` +
		state.groups
			.map(
				(g) =>
					`<option value="${g.id}" ${g.id === selected ? "selected" : ""}>${esc(g.name)}</option>`,
			)
			.join("")
	);
};

/**
 * Рисует селект площадки.
 * Имя параметра вынесено, потому что в форме тренировки и в форме
 * товарищеской игры это разные поля (`venue_id` и `friendly_venue_id`).
 * @param {string} name — имя селекта
 * @param {string} selectedId — id выбранной площадки или ""
 * @returns {string} HTML
 */
const venueSelect = (name, selectedId) => `
  <select name="${name}">
    <option value="" ${!selectedId ? "selected" : ""}>— не указана —</option>
    ${state.venues
	.map(
		(x) =>
			`<option value="${x.id}" ${x.id === selectedId ? "selected" : ""}>${esc(x.name)}</option>`,
	)
	.join("")}
  </select>`;

/**
 * Рисует один слот товарищеской игры (состав + время начала).
 * @param {number} i — индекс слота (0-based)
 * @param {{group_id?: string, start?: string}} [slot={}]
 * @returns {string} HTML
 */
const friendlySlot = (i, slot = {}) => `
  <div class="friendly-slot friendly__slot" data-slot="${i}">
    <label>Состав<select name="slot_group_${i}" aria-label="Состав">${groupOptions(slot.group_id || "")}</select></label>
    <label>Начало ${tsel(`slot_start_${i}`, slot.start || "")}</label>
  </div>`;

/**
 * Рисует N слотов товарищеской игры.
 * @param {number} count — сколько слотов
 * @param {Array<object>} [existing=[]] — массив существующих слотов
 * @returns {string} HTML
 */
const friendlySlots = (count, existing = []) =>
	Array.from({ length: count }, (_, i) => friendlySlot(i, existing[i] || {})).join("");

/**
 * Открывает редактор события.
 *
 * Если передать существующее событие — форма заполнится его значениями.
 * Если не передать — форма откроется пустой (тренировка, дата = lastDate
 * или начало недели).
 *
 * Рисует HTML формы в `#form-box`, навешивает обработчики, после сабмита
 * кладёт событие в `state.week.events` и вызывает `emit()`.
 *
 * @param {object} [ev={}] — событие (Training | Friendly | Tournament)
 * @returns {void}
 */
export function open(ev = {}) {
	const e = {
		kind: "training",
		type: "ice",
		gym_mode: "common",
		date: lastDate || state.week.week_start,
		duration: Number(DEFAULT_DURATION),
		warmup_30: false,
		warmup_45: false,
		slots: [],
		...ev,
	};
	if (e.date) lastDate = e.date;

	const prev = Object.fromEntries(
		(e.assignments || []).map((a) => [a.group_id, { on: true, act: a.activity }]),
	);
	const days = Array.from({ length: 7 }, (_, i) =>
		addDays(state.week.week_start, i),
	);
	const v = (x) => esc(x ?? "");
	const durVal =
		e.kind === "training" ? String(e.duration || DEFAULT_DURATION) : "";

	const slots = e.slots || [];
	const friendlyMode =
		e.kind === "friendly" && slots.length > 1 ? "per_group" : "same";
	const sameSlot = slots[0] || {};
	const slotCount = Math.max(1, slots.length || 1);

	const friendlyHTML = `
    <div data-k="friendly">
      <label>Соперник<input name="opponent" value="${v(e.opponent)}"></label>
      <label>Площадка${venueSelect("friendly_venue_id", e.venue_id || "")}</label>

      <div class="seg segmented" style="margin-top:10px">
        <label><input type="radio" name="friendly_mode" value="same" ${friendlyMode === "same" ? "checked" : ""}>Все составы в одно время</label>
        <label><input type="radio" name="friendly_mode" value="per_group" ${friendlyMode === "per_group" ? "checked" : ""}>У каждого состава своё время</label>
      </div>

      <div data-fm="same">
        <div class="r2 form-grid">
          <label>Начало ${tsel("friendly_start", sameSlot.start || "")}</label>
          <label>Состав<select name="friendly_group_same" aria-label="Состав">${groupOptions(sameSlot.group_id || "")}</select></label>
        </div>
      </div>

      <div data-fm="per_group">
        <label>Сколько составов играет<select name="friendly_count">${opts(
		[
			["1", "1"],
			["2", "2"],
			["3", "3"],
			["4", "4"],
			["5", "5"],
		],
		String(slotCount),
	)}</select></label>
        <div id="friendly-slots">${friendlySlots(slotCount, slots)}</div>
      </div>

      <label class="chk checkbox-row"><input type="radio" name="warmup" value="" ${!e.warmup_30 && !e.warmup_45 ? "checked" : ""}> Без сбора</label>
      <label class="chk checkbox-row"><input type="radio" name="warmup" value="30" ${e.warmup_30 ? "checked" : ""}> Сбор за 30 минут до начала</label>
      <label class="chk checkbox-row"><input type="radio" name="warmup" value="45" ${e.warmup_45 ? "checked" : ""}> Сбор за 45 минут до начала</label>
    </div>`;

	$("#form-box").innerHTML = `<form id="f" novalidate><input type="hidden" name="id" value="${v(e.id)}">
${seg(
		"kind",
		[
			["training", "Тренировка"],
			["friendly", "Товарищеская игра"],
			["tournament", "Турнир"],
		],
		e.kind,
	)}
<label>День<select name="date">${days.map((d) => `<option value="${d}" ${d === e.date ? "selected" : ""}>${fmt(d, { weekday: "long", day: "numeric", month: "long" })}</option>`).join("")}</select></label>
<div class="r2 form-grid" data-k="training"><label>Начало ${tsel("start", e.start, true)}</label><label>Длительность ${dsel(durVal)}</label></div>
<label data-k="training">Площадка${venueSelect("venue_id", e.venue_id || "")}</label>
${seg(
		"type",
		[
			["ice", "Лёд"],
			["gym", "Зал"],
		],
		e.type,
		'data-k="training"',
	)}
${
		state.subgroups
			? seg(
				"gym_mode",
				[
					["common", "Общее занятие"],
					["groups", "По подгруппам"],
				],
				e.gym_mode,
				'data-k="training" data-gym',
			)
			: '<input type="hidden" name="gym_mode" value="common">'
	}
<label class="chk checkbox-row" data-k="training" data-common><input type="checkbox" name="florball" ${e.florball_warning ? "checked" : ""}> Предупредить родителей принести шлем, краги и клюшку для флорбола</label>
<div data-k="training" data-groups><div id="grows">${rows(prev)}</div></div>
${friendlyHTML}
<label data-k="tournament">Название турнира<input name="title" value="${v(e.title)}"></label>
<label data-k="tournament">Место проведения<input name="place" value="${v(e.place)}"></label>
<label data-k="tournament">Последний день турнира (если он длится несколько дней)<input type="date" name="date_end" value="${v(e.date_end)}"></label>
<label>Примечание<textarea name="note" rows="2">${v(e.note)}</textarea></label>
<ul class="errs form-errors" id="errs"></ul><div class="row layout-row"><button>${e.id ? "Сохранить изменения" : "Добавить в расписание"}</button><button type="button" class="alt button--secondary" id="reset">Сбросить форму</button></div></form>`;

	const f = $("#f");
	sync();
	enhanceAllSelects(f);

	// При смене режима friendly или количества составов — перерисовать слоты
	f.addEventListener("change", (ev) => {
		if (
			ev.target.name === "friendly_mode" ||
			ev.target.name === "friendly_count"
		) {
			renderFriendlySlots(f);
		}
		sync();
	});
	f.addEventListener("input", (ev) => {
		if (ev.target.name === "friendly_count") renderFriendlySlots(f);
	});

	$("#reset").onclick = () => {
		lastDate = null;
		open();
	};

	f.onsubmit = (x) => {
		x.preventDefault();
		const ne = build(new FormData(f), state.groups);
		const { errors, warnings } = validate(ne, state.groups);

		$("#errs").innerHTML =
			errors.map((m) => `<li class="err">${esc(m)}</li>`).join("") +
			warnings.map((m) => `<li class="warn">${esc(m)}</li>`).join("");

		if (errors.length) return;

		if (
			warnings.length &&
			!confirm(
				"Есть предупреждения:\n\n" +
				warnings.map((w) => "• " + w).join("\n") +
				"\n\nСохранить событие как есть?",
			)
		) {
			return;
		}

		if (!ne.id) ne.id = uid();
		const i = state.week.events.findIndex((q) => q.id === ne.id);
		if (i < 0) state.week.events.push(ne);
		else state.week.events[i] = ne;

		lastDate = ne.date;
		emit();
		open();
	};
}

/**
 * Перерисовывает блок слотов friendly, сохраняя уже введённые значения.
 * Вызывается при смене режима («все составы в одно время» ↔ «у каждого
 * состава своё время») и при изменении количества составов.
 * @param {HTMLFormElement} form — форма `#f`
 * @returns {void}
 */
function renderFriendlySlots(form) {
	const box = form.querySelector("#friendly-slots");
	if (!box) return;
	const mode = form.querySelector("[name=friendly_mode]:checked")?.value;
	const count = Number(form.querySelector("[name=friendly_count]")?.value) || 1;
	const sameBox = form.querySelector('[data-fm="same"]');

	if (mode !== "per_group") {
		if (sameBox) sameBox.hidden = false;
		return;
	}
	if (sameBox) sameBox.hidden = true;

	// Собираем уже введённые значения, чтобы не потерять их при перерисовке
	const existing = [];
	for (const el of box.querySelectorAll(".friendly-slot")) {
		const i = Number(el.dataset.slot);
		const gid = el.querySelector(`[name=slot_group_${i}]`)?.value || "";
		const h = el.querySelector(`[name=slot_start_${i}_h]`)?.value || "";
		const m = el.querySelector(`[name=slot_start_${i}_m]`)?.value || "";
		existing[i] = { group_id: gid, start: h && m ? `${h}:${m}` : "" };
	}

	box.innerHTML = friendlySlots(count, existing);
	enhanceAllSelects(box);
}

/**
 * Показывает/скрывает блоки формы в зависимости от вида события и
 * выбранных параметров (лёд/зал, общее/по подгруппам, same/per_group).
 * @returns {void}
 */
function sync() {
	const f = $("#f"),
		v = Object.fromEntries(new FormData(f));
	f.querySelectorAll("[data-k]").forEach((el) => {
		let show = el.dataset.k.split(" ").includes(v.kind);
		if (show && v.kind === "training") {
			const gym = v.type === "gym";
			if ("gym" in el.dataset) show = gym;
			if ("common" in el.dataset) show = gym && v.gym_mode !== "groups";
			if ("groups" in el.dataset) show = gym && v.gym_mode === "groups";
		}
		el.hidden = !show;
	});
	f.querySelectorAll("[data-fm]").forEach((el) => {
		if (v.kind !== "friendly") return;
		el.hidden = el.dataset.fm !== (v.friendly_mode || "same");
	});
}

/**
 * Короткая подпись события для списка событий недели.
 * @param {object} e — событие
 * @returns {string}
 */
const label = (e) =>
	e.kind === "training"
		? (e.type === "ice" ? "Лёд" : "Зал") +
		(state.venues.find((x) => x.id === e.venue_id)
			? ` · ${state.venues.find((x) => x.id === e.venue_id).name}`
			: "")
		: e.kind === "friendly"
			? "Товарищеская игра"
			: `Турнир: ${e.title}`;

/**
 * Перерисовывает список событий недели и список объявлений.
 * @returns {void}
 */
function renderLists() {
	const ev = [...state.week.events].sort((a, b) =>
		(a.date + (a.start || "")).localeCompare(b.date + (b.start || "")),
	);
	$("#list").innerHTML =
		ev
			.map((e) => {
				// Для турнира с диапазоном — «10–11 окт», иначе «пн, 10»
				const hasRange =
					e.kind === "tournament" && e.date_end && e.date_end > e.date;
				const dateLabel = hasRange
					? `${fmt(e.date, { day: "numeric", month: "short" })}–${fmt(e.date_end, { day: "numeric", month: "short" })}`
					: fmt(e.date, { weekday: "short", day: "numeric" });

				let time = "";
				if (e.kind === "training" && e.start && e.duration) {
					time = `${e.start}–${addMinutes(e.start, e.duration)}`;
				} else if (e.kind === "friendly" && e.slots?.length) {
					const times = [
						...new Set(e.slots.map((s) => s.start).filter(Boolean)),
					].sort();
					time = times.join(", ");
				}

				return `<li><span><b>${dateLabel}</b> ${esc(time)} ${esc(label(e))}</span><button type="button" data-edit="${e.id}">Изменить</button><button type="button" class="alt button--secondary" data-del="${e.id}">Удалить</button></li>`;
			})
			.join("") || "<li>Пока пусто. Добавьте первую тренировку.</li>";

	$("#ann").innerHTML = state.week.announcements
		.map(
			(a) =>
				`<li><span>${esc(a.text)}</span><button type="button" data-aedit="${a.id}">Изменить</button><button type="button" class="alt button--secondary" data-adel="${a.id}">Удалить</button></li>`,
		)
		.join("");
}

/**
 * Инициализация редактора: рисует форму и список, подписывается на
 * изменения состояния и вешает обработчики на кнопки «Изменить»/«Удалить».
 * @returns {void}
 */
export function initEditor() {
	open();
	renderLists();
	on((k) => {
		renderLists();
		if (k === "reset" || k === "settings") {
			lastDate = null;
			open();
		}
		if (k === "groups" && $("#grows")) {
			$("#grows").innerHTML = rows(readRows());
			enhanceAllSelects($("#grows"));
		}
	});
	$("#list").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		if (b.dataset.edit) {
			open(state.week.events.find((x) => x.id === b.dataset.edit));
			$("#form-box").scrollIntoView();
		}
		if (b.dataset.del && confirm("Удалить это событие?")) {
			state.week.events = state.week.events.filter(
				(x) => x.id !== b.dataset.del,
			);
			emit();
		}
	});
	$("#ann").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		if (b.dataset.adel) {
			state.week.announcements = state.week.announcements.filter(
				(x) => x.id !== b.dataset.adel,
			);
			emit();
		}
		if (b.dataset.aedit) {
			const a = state.week.announcements.find((x) => x.id === b.dataset.aedit),
				t = prompt("Текст объявления", a.text);
			if (t?.trim()) {
				a.text = t.trim();
				emit();
			}
		}
	});
	$("#ann-add").onclick = () => {
		const i = $("#ann-in"),
			t = i.value.trim();
		if (!t) return;
		state.week.announcements.push({ id: uid(), text: t });
		i.value = "";
		emit();
	};
}