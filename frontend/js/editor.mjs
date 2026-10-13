// frontend/js/editor.mjs
import { enhanceAllSelects } from "./dropdown.mjs";
import { addDays, esc, fmt, addMinutes } from "./poster.mjs";
import { emit, on, state, uid } from "./state.mjs";
import { build, validate } from "./validation.mjs";

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");

// Часы: только 06..21. Минуты: кратные 5.
const H = Array.from({ length: 16 }, (_, i) => pad(6 + i));
const M = Array.from({ length: 12 }, (_, i) => pad(i * 5));

const DEFAULT_START_H = "06";
const DEFAULT_START_M = "00";
const DEFAULT_DURATION = "75";

const DURATIONS = [
	["30", "30 минут"],
	["45", "45 минут"],
	["60", "1 час"],
	["75", "1 час 15 минут"],
];

const opts = (a, sel) =>
	a
		.map(
			([v, t] = []) =>
				`<option value="${v ?? ""}" ${v === sel ? "selected" : ""}>${t ?? v ?? "—"}</option>`,
		)
		.join("");

// Часы + минуты. Пустое значение = не задано.
// withDefault=true — только для тренировки, чтобы поле старта сразу было 06:00.
const tsel = (n, v = "", withDefault = false) => {
	const [h, m] = (v || "").split(":");
	const def = withDefault && n === "start";
	const hSel = h || (def ? DEFAULT_START_H : "");
	const mSel = m || (def ? DEFAULT_START_M : "");
	return `<span class="time time-field"><select name="${n}_h" aria-label="Часы">${opts([["", "—"], ...H.map((x) => [x, x])], hSel)}</select><span class="sep time-field__separator">:</span><select name="${n}_m" aria-label="Минуты">${opts([["", "—"], ...M.map((x) => [x, x])], mSel)}</select></span>`;
};

const dsel = (v = "") => {
	const val = v || DEFAULT_DURATION;
	return `<select name="duration" aria-label="Длительность">${opts(DURATIONS, val)}</select>`;
};

const ACT = [
	["ofp", "ОФП"],
	["stretch", "Растяжка"],
	["dribbling", "Дриблинг"],
];
const seg = (name, list, cur, attr = "") =>
	`<div class="seg segmented" ${attr}>${list.map(([v, t]) => `<label><input type="radio" name="${name}" value="${v}" ${v === cur ? "checked" : ""}>${t}</label>`).join("")}</div>`;

const rows = (prev = {}) =>
	state.groups
		.map((g) => {
			const p = prev[g.id] || {};
			return `<div class="grow group-row" data-id="${g.id}"><label><input type="checkbox" name="grp" value="${g.id}" ${p.on ? "checked" : ""}> ${esc(g.name)}</label><button type="button" class="info button--info" data-tip="${g.id}" aria-label="Состав: ${esc(g.name)}">i</button><select name="act_${g.id}" aria-label="Занятие">${ACT.map(([v, t]) => `<option value="${v}" ${p.act === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
		})
		.join("");

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

let lastDate = null;

// Вспомогательное: HTML-опции для выбора группы в слоте friendly.
// Если у команды нет подгрупп — одиночный вариант «— вся команда —».
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

// Слот friendly: селект группы + время начала (без дефолта 06:00).
const friendlySlot = (i, slot = {}) => `
  <div class="friendly-slot friendly__slot" data-slot="${i}">
    <label>Состав<select name="slot_group_${i}" aria-label="Состав">${groupOptions(slot.group_id || "")}</select></label>
    <label>Начало ${tsel(`slot_start_${i}`, slot.start || "")}</label>
  </div>`;

// Список слотов по количеству.
const friendlySlots = (count, existing = []) =>
	Array.from({ length: count }, (_, i) => friendlySlot(i, existing[i] || {})).join("");

export function open(ev = {}) {
	const e = {
		kind: "training",
		type: "ice",
		gym_mode: "common",
		date: lastDate || state.week.week_start,
		duration: Number(DEFAULT_DURATION),
		warmup_30: false,
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

	// --- начальное состояние friendly ---
	const slots = e.slots || [];
	const friendlyMode =
		e.kind === "friendly" && slots.length > 1 ? "per_group" : "same";
	const sameSlot = slots[0] || {};
	const slotCount = Math.max(1, slots.length || 1);

	const friendlyHTML = `
    <div data-k="friendly">
      <label>Соперник<input name="opponent" value="${v(e.opponent)}"></label>
      <label>Площадка<select name="venue_id">
        <option value="" ${!e.venue_id ? "selected" : ""}>— не указана —</option>
        ${state.venues
		.map(
			(x) =>
				`<option value="${x.id}" ${x.id === e.venue_id ? "selected" : ""}>${esc(x.name)}</option>`,
		)
		.join("")}
      </select></label>

      <div class="seg segmented" style="margin-top:10px">
        <label><input type="radio" name="friendly_mode" value="same" ${friendlyMode === "same" ? "checked" : ""}>Все составы в одно время</label>
        <label><input type="radio" name="friendly_mode" value="per_group" ${friendlyMode === "per_group" ? "checked" : ""}>У каждого состава своё время</label>
      </div>

      <div data-fm="same">
        <div class="r2 form-grid">
          <label>Начало ${tsel("start", sameSlot.start || "")}</label>
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

      <label class="chk checkbox-row"><input type="checkbox" name="warmup_30" ${e.warmup_30 ? "checked" : ""}> Сбор за 30 минут до начала</label>
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
<label data-k="training">Площадка<select name="venue_id">
  <option value="" ${!e.venue_id ? "selected" : ""}>— не указана —</option>
  ${state.venues
		.map(
			(x) =>
				`<option value="${x.id}" ${x.id === e.venue_id ? "selected" : ""}>${esc(x.name)}</option>`,
		)
		.join("")}
</select></label>
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

	// перерисовка слотов при смене режима или количества
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

	// ↓↓↓ новый контракт validate(): { errors, warnings }
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

// Перерисовывает блок слотов friendly, сохраняя уже введённые значения.
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

	// собираем уже введённые значения
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
	// режим friendly: same / per_group
	f.querySelectorAll("[data-fm]").forEach((el) => {
		if (v.kind !== "friendly") return;
		el.hidden = el.dataset.fm !== (v.friendly_mode || "same");
	});
}

const label = (e) =>
	e.kind === "training"
		? (e.type === "ice" ? "Лёд" : "Зал") +
		(state.venues.find((x) => x.id === e.venue_id)
			? ` · ${state.venues.find((x) => x.id === e.venue_id).name}`
			: "")
		: e.kind === "friendly"
			? "Товарищеская игра"
			: `Турнир: ${e.title}`;

function renderLists() {
	const ev = [...state.week.events].sort((a, b) =>
		(a.date + (a.start || "")).localeCompare(b.date + (b.start || "")),
	);
	$("#list").innerHTML =
		ev
			.map((e) => {
				// подпись даты: для турнира с диапазоном — «10–11 окт», иначе «пн, 10»
				const hasRange =
					e.kind === "tournament" && e.date_end && e.date_end > e.date;
				const dateLabel = hasRange
					? `${fmt(e.date, { day: "numeric", month: "short" })}–${fmt(e.date_end, { day: "numeric", month: "short" })}`
					: fmt(e.date, { weekday: "short", day: "numeric" });

				let time = "";
				if (e.kind === "training" && e.start && e.duration) {
					time = `${e.start}–${addMinutes(e.start, e.duration)}`;
				} else if (e.kind === "friendly" && e.slots?.length) {
					const times = [...new Set(e.slots.map((s) => s.start).filter(Boolean))].sort();
					time = times.join(", ");
				} else if (e.start) {
					time = e.start;
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