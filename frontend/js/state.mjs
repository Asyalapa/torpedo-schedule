// js/state.mjs
import * as api from "./api.mjs";
import { addDays } from "./poster.mjs";
import { mondayOf } from "./week.mjs";

const clone = (o) => structuredClone(o);
export const uid = () => crypto.randomUUID();
const ws0 = mondayOf();

const DRAFT_KEY = "torpedo:draft";
const DRAFT_TTL = 1000 * 60 * 60 * 24 * 3;

export const state = {
	loaded: false,
	teamId: null,
	teamName: "",
	venues: [],
	subgroups: null,
	weekStart: ws0,
	week: { week_start: ws0, events: [], announcements: [] },
	groups: [],
};

const saved = { week: clone(state.week), groups: [] };
const subs = [];
export const on = (f) => subs.push(f);

let saveTimer = null;
function persistDraft() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			const key = state.teamId ? `${DRAFT_KEY}:${state.teamId}` : DRAFT_KEY;
			localStorage.setItem(
				key,
				JSON.stringify({
					t: Date.now(),
					teamId: state.teamId,
					weekStart: state.weekStart,
					week: state.week,
					groups: state.groups,
				}),
			);
		} catch {}
	}, 400);
}
function loadDraft() {
	try {
		const key = state.teamId ? `${DRAFT_KEY}:${state.teamId}` : DRAFT_KEY;
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const d = JSON.parse(raw);
		if (!d?.t || Date.now() - d.t > DRAFT_TTL) {
			localStorage.removeItem(key);
			return null;
		}
		return d;
	} catch {
		return null;
	}
}
function clearDraft() {
	clearTimeout(saveTimer);
	const key = state.teamId ? `${DRAFT_KEY}:${state.teamId}` : DRAFT_KEY;
	localStorage.removeItem(key);
}

export const emit = (kind) => {
	if (kind !== "reset" && kind !== "save" && kind !== "settings")
		persistDraft();
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

const T = () => {
	if (!state.teamId) throw new Error("Не выбрана команда");
	return `/teams/${state.teamId}`;
};

export async function loadAll(teamId) {
	state.teamId = teamId;

	const [s, venues, groups] = await Promise.all([
		api.get(`${T()}/settings`),
		api.get(`${T()}/venues`),
		api.get(`${T()}/groups`),
	]);
	Object.assign(state, {
		teamName: s.team_name,
		subgroups: s.subgroups_enabled,
		venues,
		groups,
		loaded: true,
	});
	saved.groups = clone(groups);

	const draft = loadDraft();
	if (draft?.weekStart) {
		state.weekStart = draft.weekStart;
		state.week = draft.week;
		saved.week = clone(draft.week);
		saved.groups = clone(draft.groups || groups);
		state.groups = clone(draft.groups || groups);
		emit("reset");
		return;
	}

	setWeek(
		state.weekStart,
		await api.get(`${T()}/schedules/${state.weekStart}`),
	);
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
	clearDraft();
	state.groups = clone(saved.groups);
	setWeek(ws, await api.get(`${T()}/schedules/${ws}`));
	emit("reset");
}

export async function save() {
	if (JSON.stringify(state.groups) !== JSON.stringify(saved.groups)) {
		try {
			state.groups = await api.put(`${T()}/groups`, { groups: state.groups });
		} catch (e) {
			if (e.status !== 409) throw e;
			if (
				!confirm(
					`Удаляемая группа назначена в расписаниях (недели: ${e.data.weeks.join(", ")}). В старых афишах останется её название. Удалить?`,
				)
			)
				throw new Error("Удаление группы отменено, ничего не сохранено");
			state.groups = await api.put(`${T()}/groups?force=true`, {
				groups: state.groups,
			});
		}
		saved.groups = clone(state.groups);
	}
	const doc = await api.put(`${T()}/schedules/${state.weekStart}`, {
		events: state.week.events,
		announcements: state.week.announcements,
	});
	setWeek(state.weekStart, doc);
	clearDraft();
	emit("save");
}

export function cancel() {
	state.week = clone(saved.week);
	state.groups = clone(saved.groups);
	emit("reset");
}

export async function setSubgroups(on) {
	const s = await api.put(`${T()}/settings`, {
		team_name: state.teamName || "ХК Торпедо",
		subgroups_enabled: on,
	});
	state.subgroups = s.subgroups_enabled;
	state.groups = await api.get(`${T()}/groups`);
	saved.groups = clone(state.groups);
	emit("settings");
}

export async function copyPrev() {
	if (dirty() && !confirm("Несохранённые правки будут потеряны. Продолжить?"))
		return false;
	const url = `${T()}/schedules/${state.weekStart}/copy-from/${addDays(state.weekStart, -7)}`;
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

export function resetState() {
	state.loaded = false;
	state.teamId = null;
	state.teamName = "";
	state.venues = [];
	state.subgroups = null;
	state.groups = [];
	state.week = { week_start: state.weekStart, events: [], announcements: [] };
	saved.week = clone(state.week);
	saved.groups = [];
	clearDraft();
	emit("reset");
}
