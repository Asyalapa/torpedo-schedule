import getToken, { setToken } from "./api.js";
import { initEditor } from "./editor.js";
import { exportPng } from "./export.js";
import { initGroups, initTips } from "./groups-ui.js";
import { addDays, fmt, posterHTML, rosterHTML } from "./poster.js";
import {
	cancel,
	copyPrev,
	dirty,
	goWeek,
	loadAll,
	on,
	save,
	setSubgroups,
	state,
} from "./state.js";
import { localISO } from "./week.js";

const $ = (id) => document.getElementById(id);
let busy = false,
	timer;

function render() {
	const sub = state.subgroups === true,
		ws = state.weekStart;
	$("poster").innerHTML = posterHTML(state.week, state.venues);
	$("roster").innerHTML = rosterHTML(state.groups, localISO());
	$("groups-panel").hidden = $("roster-panel").hidden = !sub;
	$("first").hidden = !(state.loaded && state.subgroups === null);
	$("sub").checked = sub;
	$("week-label").textContent =
		`${fmt(ws, { day: "numeric", month: "long" })} – ${fmt(addDays(ws, 6), { day: "numeric", month: "long", year: "numeric" })}`;
	$("dirty").textContent = busy
		? "Загрузка…"
		: dirty()
			? "Есть несохранённые изменения"
			: "Всё сохранено";
	document.body.setAttribute("aria-busy", busy);
}
function toast(msg, err = false) {
	const t = $("toast");
	t.textContent = msg;
	t.className = err ? "err" : "";
	t.hidden = false;
	clearTimeout(timer);
	timer = setTimeout(() => (t.hidden = true), err ? 9000 : 3500);
}
const askToken = (wrong) =>
	new Promise((res) => {
		const d = $("login");
		$("login-err").textContent = wrong
			? "Токен не подошёл. Введите ещё раз."
			: "";
		d.addEventListener(
			"close",
			() => {
				setToken($("tok").value.trim());
				$("tok").value = "";
				res();
			},
			{ once: true },
		);
		d.showModal();
	});
async function run(fn, okMsg) {
	// единая обёртка: индикатор, повторный вход при 401, понятные ошибки
	busy = true;
	render();
	try {
		for (;;) {
			try {
				if (!getToken()) await askToken(false);
				const r = await fn();
				if (okMsg && r !== false) toast(okMsg);
				return r;
			} catch (e) {
				if (e.status !== 401) throw e;
				setToken("");
				await askToken(true);
			}
		}
	} catch (e) {
		toast(e.message, true);
	} finally {
		busy = false;
		render();
	}
}
on(render);
initEditor();
initGroups();
initTips();
render();
$("save").onclick = () => run(save, "Сохранено");
$("cancel").onclick = () =>
	dirty() && confirm("Отменить все несохранённые изменения?") && cancel();
$("prev").onclick = () => run(() => goWeek(addDays(state.weekStart, -7)));
$("next").onclick = () => run(() => goWeek(addDays(state.weekStart, 7)));
$("copy").onclick = () =>
	run(copyPrev, "Расписание скопировано с прошлой недели");
$("yes").onclick = () => run(() => setSubgroups(true));
$("no").onclick = () => run(() => setSubgroups(false));
$("sub").onchange = (e) => {
	const v = e.target.checked;
	run(() => setSubgroups(v));
}; // читать до run(): render() сбросит галочку
async function exp(html, name) {
	busy = true;
	render();
	try {
		await exportPng(html, name);
		toast("Картинка готова, смотрите в загрузках");
	} catch (e) {
		toast(`Не удалось создать картинку: ${e.message}`, true);
	} finally {
		busy = false;
		render();
	}
}
$("png-s").onclick = () =>
	exp(
		posterHTML(state.week, state.venues),
		`torpedo-raspisanie-${state.weekStart}.png`,
	);
$("png-r").onclick = () =>
	exp(
		rosterHTML(state.groups, localISO()),
		`torpedo-sostavy-${localISO()}.png`,
	);
addEventListener("beforeunload", (e) => {
	if (dirty()) {
		e.preventDefault();
		e.returnValue = "";
	}
});
run(loadAll);
