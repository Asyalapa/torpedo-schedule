import { addDays, esc, fmt } from "./poster.js";
import { emit, on, state, uid } from "./state.js";
import { build, validate } from "./validation.js";

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");
const H = Array.from({ length: 24 }, (_, i) => pad(i)),
	M = Array.from({ length: 12 }, (_, i) => pad(i * 5)); // минуты: 00, 05 … 55
const opts = (a, sel) =>
	`<option value="">—</option>${a.map((v) => `<option ${v === sel ? "selected" : ""}>${v}</option>`).join("")}`;
const tsel = (n, v = "") => {
	const [h, m] = v.split(":");
	return `<span class="time"><select name="${n}_h" aria-label="Часы">${opts(H, h)}</select>:<select name="${n}_m" aria-label="Минуты">${opts(M, m)}</select></span>`;
};
const ACT = [
	["ofp", "ОФП"],
	["stretch", "Растяжка"],
	["dribbling", "Дриблинг"],
];
const seg = (name, list, cur, attr = "") =>
	`<div class="seg" ${attr}>${list.map(([v, t]) => `<label><input type="radio" name="${name}" value="${v}" ${v === cur ? "checked" : ""}>${t}</label>`).join("")}</div>`;
const rows = (prev = {}) =>
	state.groups
		.map((g) => {
			const p = prev[g.id] || {};
			return `<div class="grow" data-id="${g.id}"><label><input type="checkbox" name="grp" value="${g.id}" ${p.on ? "checked" : ""}> ${esc(g.name)}</label><button type="button" class="info" data-tip="${g.id}" aria-label="Состав: ${esc(g.name)}">i</button><select name="act_${g.id}" aria-label="Занятие">${ACT.map(([v, t]) => `<option value="${v}" ${p.act === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
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

export function open(ev = {}) {
	const e = {
		kind: "training",
		type: "ice",
		gym_mode: "common",
		date: state.week.week_start,
		...ev,
	};
	const prev = Object.fromEntries(
		(e.assignments || []).map((a) => [
			a.group_id,
			{ on: true, act: a.activity },
		]),
	);
	const days = Array.from({ length: 7 }, (_, i) =>
		addDays(state.week.week_start, i),
	);
	const v = (x) => esc(x ?? "");
	$("#form-box").innerHTML =
		`<form id="f" novalidate><input type="hidden" name="id" value="${v(e.id)}">
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
<div class="r2"><label>Начало ${tsel("start", e.start)}</label><label>Окончание ${tsel("end", e.end)}</label></div>
<label data-k="training friendly">Площадка<select name="venue_id"><option value="">— не указана —</option>${state.venues.map((x) => `<option value="${x.id}" ${x.id === e.venue_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
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
<label class="chk" data-k="training" data-common><input type="checkbox" name="florball" ${e.florball_warning ? "checked" : ""}> Предупредить родителей принести шлем, краги и клюшку для флорбола</label>
<div data-k="training" data-groups><div id="grows">${rows(prev)}</div></div>
<label data-k="friendly">Соперник<input name="opponent" value="${v(e.opponent)}"></label>
<label data-k="tournament">Название турнира<input name="title" value="${v(e.title)}"></label>
<label data-k="tournament">Место проведения<input name="place" value="${v(e.place)}"></label>
<label data-k="tournament">Последний день, если турнир идёт несколько дней<input type="date" name="date_end" value="${v(e.date_end)}"></label>
<label>Примечание<textarea name="note" rows="2">${v(e.note)}</textarea></label>
<ul class="errs" id="errs"></ul><div class="row"><button>${e.id ? "Сохранить изменения" : "Добавить в расписание"}</button><button type="button" class="alt" id="reset">Сбросить форму</button></div></form>`;
	const f = $("#f");
	sync();
	f.addEventListener("change", sync);
	$("#reset").onclick = () => open();
	f.onsubmit = (x) => {
		x.preventDefault();
		const ne = build(new FormData(f), state.groups),
			err = validate(ne);
		$("#errs").innerHTML = err.map((m) => `<li>${esc(m)}</li>`).join("");
		if (err.length) return;
		if (!ne.id) ne.id = uid();
		const i = state.week.events.findIndex((q) => q.id === ne.id);
		if (i < 0) state.week.events.push(ne);
		else state.week.events[i] = ne;
		emit();
		open();
	};
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
			.map(
				(e) =>
					`<li><span><b>${fmt(e.date, { weekday: "short", day: "numeric" })}</b> ${esc(e.start ? e.start + (e.end ? `–${e.end}` : "") : "")} ${esc(label(e))}</span><button type="button" data-edit="${e.id}">Изменить</button><button type="button" class="alt" data-del="${e.id}">Удалить</button></li>`,
			)
			.join("") || "<li>Пока пусто. Добавьте первую тренировку.</li>";
	$("#ann").innerHTML = state.week.announcements
		.map(
			(a) =>
				`<li><span>${esc(a.text)}</span><button type="button" data-aedit="${a.id}">Изменить</button><button type="button" class="alt" data-adel="${a.id}">Удалить</button></li>`,
		)
		.join("");
}
export function initEditor() {
	open();
	renderLists();
	on((k) => {
		renderLists();
		if (k === "reset" || k === "settings") open();
		if (k === "groups" && $("#grows")) $("#grows").innerHTML = rows(readRows());
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
