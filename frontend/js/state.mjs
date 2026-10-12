import * as api from "./api.js";
import { addDays } from "./poster.js";
import { mondayOf } from "./week.js";

const clone = (o) => structuredClone(o);
export const uid = () => crypto.randomUUID();
const ws0 = mondayOf();
export const state = {
	loaded: false,
	venues: [],
	subgroups: null,
	weekStart: ws0,
	week: { week_start: ws0, events: [], announcements: [] },
	groups: [],
};
const saved = { week: clone(state.week), groups: [] };
const subs = [];
export const on = (f) => subs.push(f);
export const emit = (kind) => {
	for (const f of subs) f(kind);
};
export const dirty = () =>
	JSON.stringify(saved) !==
	JSON.stringify({ week: state.week, groups: state.groups });
export const groupUsage = (id) =>
	state.week.events.filter((e) => e.assignments?.some((a) => a.group_id === id))
		.length;

const setWeek = (ws, doc) => {
	state.weekStart = ws;
	state.week = {
		week_start: ws,
		events: doc.events,
		announcements: doc.announcements,
	};
	saved.week = clone(state.week);
};
export async function loadAll() {
	const [s, venues, groups] = await Promise.all([
		api.get("/settings"),
		api.get("/venues"),
		api.get("/groups"),
	]);
	Object.assign(state, {
		subgroups: s.subgroups_enabled,
		venues,
		groups,
		loaded: true,
	});
	saved.groups = clone(groups);
	setWeek(state.weekStart, await api.get(`/schedules/${state.weekStart}`));
	emit("reset");
}
export async function goWeek(ws) {
	if (
		dirty() &&
		!confirm(
			"Несохранённые изменения будут потеряны. Перейти на другую неделю?",
		)
	)
		return false;
	state.groups = clone(saved.groups);
	setWeek(ws, await api.get(`/schedules/${ws}`));
	emit("reset");
}
export async function save() {
	if (JSON.stringify(state.groups) !== JSON.stringify(saved.groups)) {
		try {
			state.groups = await api.put("/groups", { groups: state.groups });
		} catch (e) {
			if (e.status !== 409) throw e;
			if (
				!confirm(
					`Удаляемая группа назначена в расписаниях (недели: ${e.data.weeks.join(", ")}). В старых афишах останется её название. Удалить?`,
				)
			)
				throw new Error("Удаление группы отменено, ничего не сохранено");
			state.groups = await api.put("/groups?force=true", {
				groups: state.groups,
			});
		}
		saved.groups = clone(state.groups);
	}
	const doc = await api.put(`/schedules/${state.weekStart}`, {
		events: state.week.events,
		announcements: state.week.announcements,
	});
	setWeek(state.weekStart, doc);
	emit("save");
}
export function cancel() {
	state.week = clone(saved.week);
	state.groups = clone(saved.groups);
	emit("reset");
}
export async function setSubgroups(on) {
	// настройка команды сохраняется сразу, это не черновик
	const s = await api.put("/settings", {
		team_name: "ХК Торпедо · 2019",
		subgroups_enabled: on,
	});
	state.subgroups = s.subgroups_enabled;
	state.groups = await api.get("/groups");
	saved.groups = clone(state.groups);
	emit("settings");
}
export async function copyPrev() {
	if (dirty() && !confirm("Несохранённые правки будут потеряны. Продолжить?"))
		return false;
	const url = `/schedules/${state.weekStart}/copy-from/${addDays(state.weekStart, -7)}`;
	let doc;
	try {
		doc = await api.post(url);
	} catch (e) {
		if (e.status !== 409) throw e;
		if (
			!confirm(
				"На этой неделе уже есть расписание. Заменить копией прошлой недели?",
			)
		)
			return false;
		doc = await api.post(`${url}?overwrite=true`);
	}
	state.groups = clone(saved.groups);
	setWeek(state.weekStart, doc);
	emit("reset");
}
