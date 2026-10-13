// frontend/js/poster.mjs
import { icon } from "./icons.mjs";

export const esc = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
				],
	);

const utc = (iso) => new Date(iso + "T00:00:00Z");

export const addDays = (iso, n) => {
	const d = utc(iso);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

export const fmt = (iso, o) =>
	utc(iso).toLocaleDateString("ru", { ...o, timeZone: "UTC" });

export function addMinutes(hhmm, minutes) {
	if (!hhmm || !Number.isFinite(minutes)) return "";
	const [h, m] = hhmm.split(":").map(Number);
	const total = h * 60 + m + minutes;
	const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
	const mm = String(total % 60).padStart(2, "0");
	return `${hh}:${mm}`;
}

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

function eventOnDate(e, iso) {
	if (e.kind === "tournament" && e.date_end && e.date_end > e.date) {
		return e.date <= iso && iso <= e.date_end;
	}
	return e.date === iso;
}

// Строки времени для friendly:
//   - основное время каждого слота (без сдвига!)
//   - если задан сбор (warmup_30 / warmup_45) — отдельная строка
// Возвращает массив { time, group } для основного времени
// и отдельно строку сборов { warmup: "12:30" | "12:15" | "" }.
function friendlyTimes(e) {
	const slots = e.slots || [];
	if (!slots.length) return { rows: [], warmup: "" };

	const byTime = new Map();
	let hasUnknown = false;
	for (const s of slots) {
		if (!s.start) {
			hasUnknown = true;
			continue;
		}
		if (!byTime.has(s.start)) byTime.set(s.start, []);
		if (s.group_name) byTime.get(s.start).push(s.group_name);
	}

	const rows = [...byTime.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([time, groups]) => ({ time, group: groups.join(", ") }));

	if (hasUnknown) rows.push({ time: "время уточняется", group: "" });

	// сбор — по первому (самому раннему) времени игры, без сдвига основного времени
	const firstStart = rows.find((r) => /^\d{2}:\d{2}$/.test(r.time))?.time;
	let warmup = "";
	let warmupMin = 0;
	if (firstStart) {
		if (e.warmup_45) {
			warmup = addMinutes(firstStart, -45);
			warmupMin = 45;
		} else if (e.warmup_30) {
			warmup = addMinutes(firstStart, -30);
			warmupMin = 30;
		}
	}
	return { rows, warmup, warmupMin };
}

function card(e, venues, iso) {
	const v = venues.find((x) => x.id === e.venue_id);
	const sp = SPECIAL[e.kind];
	const c = sp ? sp.c : (v?.color ?? "#727E8D"),
		t = sp ? sp.t : (v?.tint ?? "#EEF0F3");

	let metaTime = "";
	if (e.kind === "training" && e.start) {
		metaTime =
			e.duration > 0 ? `${e.start}–${addMinutes(e.start, e.duration)}` : e.start;
	}

	const meta = [metaTime, v?.name ?? ""].filter(Boolean).map(esc).join(" · ");

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
	} else if (e.kind === "friendly") {
		ic = sp.icon;
		title = sp.label;
		const { rows, warmup, warmupMin } = friendlyTimes(e);
		const timesHtml = rows
			.map(
				({ time, group }) =>
					`<div class="as">${icon("star")}<span>${esc(time)}${group ? ` · ${esc(group)}` : ""}</span></div>`,
			)
			.join("");
		extra =
			timesHtml +
			row("l", e.opponent && `Соперник: ${esc(e.opponent)}`) +
			row("l", v?.name && `Место: ${esc(v.name)}`) +
			row("warn", warmup && `Сбор за ${warmupMin} минут — в ${esc(warmup)}`);
	} else {
		// tournament
		ic = sp.icon;
		title = "Турнир";

		const hasRange = e.date_end && e.date_end > e.date;
		const isFirst = !hasRange || iso === e.date;
		const isLast = !hasRange || iso === e.date_end;

		let dateLabel = "";
		if (hasRange) {
			if (isFirst && isLast) {
				dateLabel = "";
			} else if (isFirst) {
				dateLabel = `с ${fmt(e.date, { day: "numeric", month: "long" })} по ${fmt(e.date_end, { day: "numeric", month: "long" })}`;
			} else if (isLast) {
				dateLabel = `последний день, ${fmt(e.date_end, { day: "numeric", month: "long" })}`;
			} else {
				dateLabel = "продолжается";
			}
		}

		// строку «Начало» у турнира НЕ рисуем вообще
		extra =
			row("big", e.title && esc(e.title)) +
			row("l", e.place && `Место проведения: ${esc(e.place)}`) +
			row("l", dateLabel && esc(dateLabel));
	}

	return `<div class="ev" style="--c:${c};--t:${t}">${icon(ic)}<div><div class="t">${title}</div>${row("m", meta)}${extra}${row("n", e.note && esc(e.note))}</div></div>`;
}

export function posterHTML(week, venues, teamName = "ХК Торпедо") {
	const days = Array.from({ length: 7 }, (_, i) => addDays(week.week_start, i))
		.map((d) => {
			const evs = week.events
				.filter((e) => eventOnDate(e, d))
				.sort((a, b) => {
					const ta = a.start || a.slots?.[0]?.start || "";
					const tb = b.start || b.slots?.[0]?.start || "";
					return ta.localeCompare(tb);
				});
			const body = evs.length
				? evs.map((e) => card(e, venues, d)).join("")
				: '<div class="off">Выходной</div>';
			return `<section class="day"><h3>${fmt(d, { weekday: "long" })}<span>${fmt(d, { day: "numeric", month: "long" })}</span></h3>${body}</section>`;
		})
		.join("");

	const range = `${fmt(week.week_start, { day: "numeric", month: "long" })} – ${fmt(
		addDays(week.week_start, 6),
		{ day: "numeric", month: "long", year: "numeric" },
	)}`;
	const ann = week.announcements.length
		? `<div class="ann">${week.announcements.map((a) => `<p>${esc(a.text)}</p>`).join("")}</div>`
		: "";
	return `<div class="poster"><header class="ph"><b>${esc(teamName)}</b><h2>РАСПИСАНИЕ ТРЕНИРОВОК</h2><div>${range}</div></header>${days}${ann}</div>`;
}

export function rosterHTML(groups, dateISO, teamName = "ХК Торпедо") {
	const visible = groups.filter((g) => g.print_on_roster !== false);
	const cards = visible
		.map(
			(g) =>
				`<section class="rc"><h3>${esc(g.name)}<span>${g.players.length} игр.</span></h3>${
					g.players.length
						? `<ol>${g.players.map((p) => `<li>${esc(p.name)}</li>`).join("")}</ol>`
						: '<div class="off">Состав не заполнен</div>'
				}</section>`,
		)
		.join("");
	return `<div class="poster"><header class="ph"><b>${esc(teamName)}</b><h2>СОСТАВЫ ПОДГРУПП</h2><div>Актуально на ${fmt(dateISO, { day: "numeric", month: "long", year: "numeric" })}</div></header>${cards || '<div class="off">Ни один состав не выбран для печати</div>'}</div>`;
}