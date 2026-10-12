import { icon } from "./icons.js";
export const esc = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
// biome-ignore lint/style/useTemplate: строковая конкатенация ISO-даты читается яснее
const utc = (iso) => new Date(iso + "T00:00:00Z");
export const addDays = (iso, n) => {
	const d = utc(iso);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};
export const fmt = (iso, o) =>
	utc(iso).toLocaleDateString("ru", { ...o, timeZone: "UTC" });
const ACT = {
	ofp: ["ОФП", "dumbbell"],
	stretch: ["Растяжка", "splits"],
	dribbling: ["Дриблинг", "stick"],
};
const SPECIAL = {
	friendly: {
		c: "#E3B341",
		t: "#FFF5D6",
		icon: "star",
		label: "Товарищеская игра",
	},
	tournament: { c: "#E67E22", t: "#FFF0E0", icon: "trophy", label: "Турнир" },
};
const row = (cls, html) => (html ? `<div class="${cls}">${html}</div>` : "");

function card(e, venues) {
	const v = venues.find((x) => x.id === e.venue_id);
	const sp = SPECIAL[e.kind];
	const c = sp ? sp.c : (v?.color ?? "#727E8D"),
		t = sp ? sp.t : (v?.tint ?? "#EEF0F3");
	const time = e.start ? (e.end ? `${e.start}–${e.end}` : e.start) : "";
	const meta = [
		time,
		v?.name ?? (e.place && e.kind === "friendly" ? e.place : ""),
	]
		.filter(Boolean)
		.map(esc)
		.join(" · ");
	let ic,
		title,
		extra = "";
	if (e.kind === "training") {
		const groups = e.type === "gym" && e.gym_mode === "groups";
		ic = e.type === "ice" ? "snow" : "ball";
		title = e.type === "ice" ? "Лёд" : "Зал";
		if (groups)
			extra = (e.assignments || [])
				.map(
					(a) =>
						`<div class="as">${icon(ACT[a.activity][1])}<span>${esc(a.group_name)} — ${ACT[a.activity][0]}</span></div>`,
				)
				.join("");
		if (e.type === "gym" && e.gym_mode === "common" && e.florball_warning)
			extra =
				'<div class="warn">Взять с собой: шлем, краги и клюшку для флорбола</div>';
	} else {
		ic = sp.icon;
		title = e.kind === "tournament" ? "Турнир" : sp.label;
		if (e.kind === "friendly")
			extra = row("l", e.opponent && `Соперник: ${esc(e.opponent)}`);
		else
			extra =
				row("big", e.title && esc(e.title)) +
				row("l", e.place && `Место проведения: ${esc(e.place)}`) +
				row(
					"l",
					e.date_end &&
						`Даты: ${fmt(e.date, { day: "numeric", month: "long" })} – ${fmt(e.date_end, { day: "numeric", month: "long" })}`,
				);
	}
	return `<div class="ev" style="--c:${c};--t:${t}">${icon(ic)}<div><div class="t">${title}</div>${row("m", meta)}${extra}${row("n", e.note && esc(e.note))}</div></div>`;
}

export function posterHTML(week, venues) {
	const days = Array.from({ length: 7 }, (_, i) => addDays(week.week_start, i))
		.map((d) => {
			const evs = week.events
				.filter((e) => e.date === d)
				.sort((a, b) => (a.start || "").localeCompare(b.start || ""));
			const body = evs.length
				? evs.map((e) => card(e, venues)).join("")
				: '<div class="off">Выходной</div>';
			return `<section class="day"><h3>${fmt(d, { weekday: "long" })}<span>${fmt(d, { day: "numeric", month: "long" })}</span></h3>${body}</section>`;
		})
		.join("");
	const range = `${fmt(week.week_start, { day: "numeric", month: "long" })} – ${fmt(addDays(week.week_start, 6), { day: "numeric", month: "long", year: "numeric" })}`;
	const ann = week.announcements.length
		? `<div class="ann">${week.announcements.map((a) => `<p>${esc(a.text)}</p>`).join("")}</div>`
		: "";
	return `<div class="poster"><header class="ph"><b>ХК ТОРПЕДО · 2019</b><h2>РАСПИСАНИЕ ТРЕНИРОВОК</h2><div>${range}</div></header>${days}${ann}</div>`;
}

export function rosterHTML(groups, dateISO) {
	const cards = groups
		.map(
			(g) =>
				`<section class="rc"><h3>${esc(g.name)}<span>${g.players.length} игр.</span></h3>${
					g.players.length
						? `<ol>${g.players.map((p) => `<li>${esc(p.name)}</li>`).join("")}</ol>`
						: '<div class="off">Состав не заполнен</div>'
				}</section>`,
		)
		.join("");
	return `<div class="poster"><header class="ph"><b>ХК ТОРПЕДО · 2019</b><h2>СОСТАВЫ ПОДГРУПП</h2><div>Актуально на ${fmt(dateISO, { day: "numeric", month: "long", year: "numeric" })}</div></header>${cards}</div>`;
}
