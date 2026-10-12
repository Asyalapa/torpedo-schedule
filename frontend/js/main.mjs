import {
	adminCreateTeam,
	adminCreateVenue,
	adminDeleteTeam,
	adminDeleteVenue,
	adminListTeams,
	adminListVenues,
	adminPatchTeam,
	adminUpdateVenue,
	getMe,
	getToken,
	listTeams,
	login,
	logout,
	setToken,
} from "./api.mjs";
import { enhanceAllSelects, mountDropdown } from "./dropdown.mjs";
import { initEditor } from "./editor.mjs";
import { exportPng } from "./export.mjs";
import { initGroups, initTips } from "./groups-ui.mjs";
import { addDays, fmt, posterHTML, rosterHTML } from "./poster.mjs";
import {
	cancel,
	copyPrev,
	dirty,
	goWeek,
	loadAll,
	on,
	resetState,
	save,
	setSubgroups,
	state,
} from "./state.mjs";
import { localISO } from "./week.mjs";

const $ = (id) => document.getElementById(id);
let busy = false;
let timer;
let currentMe = null; // { role, team?, login? }

// ---------- отрисовка ----------
function render() {
	if (!currentMe) return;
	const sub = state.subgroups === true;
	const ws = state.weekStart;

	$("poster").innerHTML = posterHTML(state.week, state.venues, state.teamName);
	$("roster").innerHTML = rosterHTML(state.groups, localISO(), state.teamName);
	$("groups-panel").hidden = $("roster-panel").hidden = !sub;
	if (!busy) $("sub").checked = sub;
	$("week-label").textContent =
		`${fmt(ws, { day: "numeric", month: "long" })} – ${fmt(addDays(ws, 6), {
			day: "numeric",
			month: "long",
			year: "numeric",
		})}`;
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

// ---------- экраны ----------
function showLogin() {
	$("login-screen").hidden = false;
	$("app").hidden = true;
	$("login-err").textContent = "";
}

function showApp() {
	$("login-screen").hidden = true;
	$("app").hidden = false;
}

// ---------- логин ----------
let teamDropdown = null;

function setLoginMode(mode) {
	for (const el of document.querySelectorAll(".login-mode")) {
		el.hidden = el.dataset.mode !== mode;
	}
	$("login-mode-toggle").textContent =
		mode === "coach" ? "Вход для администратора" : "Вход для тренера";
	$("login-form").dataset.mode = mode;
	$("login-err").textContent = "";
}

function showWeekView(show) {
	$("week-view").hidden = !show;
	$("admin-panel").hidden = show;
}

async function initLogin() {
	setLoginMode("coach");

	$("login-mode-toggle").onclick = () => {
		const cur = $("login-form").dataset.mode || "coach";
		setLoginMode(cur === "coach" ? "admin" : "coach");
	};

	// Загружаем список команд для дропдауна
	try {
		const teams = await listTeams();
		const dd = document.querySelector(
			'.login-mode[data-mode="coach"] [data-dd]',
		);
		teamDropdown = mountDropdown(dd, {
			placeholder: "Выберите команду",
			items: teams.map((t) => ({ value: t.slug, label: t.name })),
		});
		if (teams.length === 0) {
			toast(
				"Пока ни одной команды не заведено. Обратитесь к администратору.",
				true,
			);
		}
	} catch (e) {
		toast(`Не удалось получить список команд: ${e.message}`, true);
	}

	$("login-form").onsubmit = async (e) => {
		e.preventDefault();
		$("login-err").textContent = "";
		const mode = $("login-form").dataset.mode || "coach";
		const fd = new FormData(e.target);
		const password = fd.get("password") || "";

		if (!password) {
			$("login-err").textContent = "Введите пароль.";
			return;
		}

		let body;
		if (mode === "coach") {
			const slug = teamDropdown?.value || "";
			if (!slug) {
				$("login-err").textContent = "Выберите команду.";
				return;
			}
			body = { team_slug: slug, password };
		} else {
			const login = (fd.get("admin_login") || "").toString().trim();
			if (!login) {
				$("login-err").textContent = "Введите логин администратора.";
				return;
			}
			body = { admin_login: login, password };
		}

		const btn = $("login-form").querySelector("button[type=submit]");
		btn.disabled = true;
		try {
			const res = await login(body);
			currentMe = res;
			await enterApp(res);
		} catch (err) {
			$("login-err").textContent = err.message;
		} finally {
			btn.disabled = false;
		}
	};
}

// ---------- вход в приложение ----------
async function enterApp(me) {
	currentMe = me;
	$("team-chip").hidden = true;
	setBackToAdminVisible(false);

	if (me.role === "admin") {
		showApp();
		showWeekView(false);
		await renderAdminTeams();
		return;
	}

	// тренер
	$("team-chip").hidden = false;
	$("team-chip-name").textContent = me.team?.name || "";
	showApp();
	showWeekView(true);
	await loadAllForTeam(me.team.id);
}

async function openTeamAsAdmin(teamId, teamName) {
	showWeekView(true);
	$("team-chip").hidden = false;
	$("team-chip-name").textContent = teamName || "";
	setBackToAdminVisible(true);
	await loadAllForTeam(teamId);
}

async function loadAllForTeam(teamId) {
	busy = true;
	render();
	try {
		await loadAll(teamId);
		render();
	} catch (e) {
		toast(e.message, true);
	} finally {
		busy = false;
		render();
	}
}

// ---------- админ-панель ----------
let adminTeamDialogMode = "create"; // "create" | "edit"
let adminEditTeamId = null;

async function renderAdminTeams() {
	const ul = $("admin-teams");
	ul.innerHTML = "<li>Загрузка…</li>";
	try {
		const teams = await adminListTeams();
		ul.innerHTML = teams.length
			? teams
					.map(
						(t) => `
        <li data-id="${t.id}">
          <div class="grow">
            <strong>${escapeHtml(t.name)}</strong>
            <small>${escapeHtml(t.slug)}</small>
          </div>
          <button type="button" data-open="${t.id}" data-name="${escapeAttr(t.name)}">Открыть</button>
          <button type="button" class="alt" data-edit="${t.id}" data-name="${escapeAttr(t.name)}" data-slug="${escapeAttr(t.slug)}">Изменить</button>
          <button type="button" class="alt" data-del="${t.id}" data-name="${escapeAttr(t.name)}">Удалить</button>
        </li>`,
					)
					.join("")
			: "<li>Пока ни одной команды.</li>";
	} catch (e) {
		ul.innerHTML = `<li>Ошибка: ${escapeHtml(e.message)}</li>`;
	}
	await renderVenues();
}

async function renderVenues() {
	const ul = $("venues-list");
	ul.innerHTML = "<li>Загрузка…</li>";
	try {
		const list = await adminListVenues();
		ul.innerHTML = list.length
			? list
					.map(
						(v) => `
        <li data-id="${v.id}">
          <span class="swatch" style="background:${v.color}"></span>
          <span style="flex:1">${escapeHtml(v.name)}</span>
          <button type="button" class="alt" data-vedit="${v.id}">Изменить</button>
          <button type="button" class="alt" data-vdel="${v.id}">Удалить</button>
        </li>`,
					)
					.join("")
			: "<li>Пока ни одной площадки.</li>";
	} catch (e) {
		ul.innerHTML = `<li>Ошибка: ${escapeHtml(e.message)}</li>`;
	}
}

function openTeamDialog(mode, team = null) {
	adminTeamDialogMode = mode;
	adminEditTeamId = team?.id ?? null;
	$("team-dialog-title").textContent =
		mode === "create" ? "Новая команда" : `Изменить: ${team.name}`;
	$("team-form").reset();
	$("team-dialog-err").textContent = "";
	if (mode === "edit") {
		$("team-form").elements.name.value = team.name;
		$("team-form").elements.slug.value = team.slug;
		$("team-form").elements.slug.disabled = true; // slug не меняем
		$("team-form").elements.password.value = "";
		$("team-form").elements.password.placeholder =
			"оставьте пустым, чтобы не менять";
		$("team-form").elements.password.required = false;
	} else {
		$("team-form").elements.slug.disabled = false;
		$("team-form").elements.password.placeholder = "";
		$("team-form").elements.password.required = true;
	}
	$("team-dialog").showModal();
}

let venueDialogMode = "create";
let venueEditId = null;

function openVenueDialog(mode, venue = null) {
	venueDialogMode = mode;
	venueEditId = venue?.id ?? null;
	$("venue-dialog-title").textContent =
		mode === "create" ? "Новая площадка" : `Изменить: ${venue.name}`;
	const f = $("venue-form");
	f.reset();
	$("venue-dialog-err").textContent = "";
	if (mode === "edit") {
		f.elements.name.value = venue.name;
		f.elements.color.value = venue.color;
		f.elements.tint.value = venue.tint;
	}
	$("venue-dialog").showModal();
}

function wireVenuesPanel() {
	$("venue-add").onclick = () => openVenueDialog("create");
	$("venue-dialog-cancel").onclick = () => $("venue-dialog").close();

	$("venue-form").onsubmit = async (e) => {
		e.preventDefault();
		$("venue-dialog-err").textContent = "";
		const fd = new FormData(e.target);
		const name = (fd.get("name") || "").toString().trim();
		const color = (fd.get("color") || "").toString();
		const tint = (fd.get("tint") || "").toString();

		try {
			if (venueDialogMode === "create") {
				await adminCreateVenue({ name, color, tint });
			} else {
				await adminUpdateVenue(venueEditId, {
					id: venueEditId,
					name,
					color,
					tint,
				});
			}
			$("venue-dialog").close();
			await renderVenues();
			toast("Сохранено");
		} catch (err) {
			$("venue-dialog-err").textContent = err.message;
		}
	};

	$("venues-list").addEventListener("click", async (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		if (b.dataset.vedit) {
			const list = await adminListVenues();
			const v = list.find((x) => x.id === b.dataset.vedit);
			if (v) openVenueDialog("edit", v);
		} else if (b.dataset.vdel) {
			if (!confirm("Удалить площадку?")) return;
			try {
				await adminDeleteVenue(b.dataset.vdel);
				await renderVenues();
				toast("Удалено");
			} catch (err) {
				toast(err.message, true);
			}
		}
	});
}

function wireAdminPanel() {
	$("admin-new-team").onclick = () => openTeamDialog("create");

	$("team-dialog-cancel").onclick = () => $("team-dialog").close();

	$("team-form").onsubmit = async (e) => {
		e.preventDefault();
		$("team-dialog-err").textContent = "";
		const fd = new FormData(e.target);
		const name = (fd.get("name") || "").toString().trim();
		const slug = (fd.get("slug") || "").toString().trim();
		const password = (fd.get("password") || "").toString();

		try {
			if (adminTeamDialogMode === "create") {
				await adminCreateTeam({ name, slug, password });
			} else {
				const body = { name };
				if (password) body.password = password;
				await adminPatchTeam(adminEditTeamId, body);
			}
			$("team-dialog").close();
			await renderAdminTeams();
			toast("Сохранено");
		} catch (err) {
			$("team-dialog-err").textContent = err.message;
		}
	};

	$("admin-teams").addEventListener("click", async (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		if (b.dataset.open) {
			openTeamAsAdmin(b.dataset.open, b.dataset.name);
		} else if (b.dataset.edit) {
			openTeamDialog("edit", {
				id: b.dataset.edit,
				name: b.dataset.name,
				slug: b.dataset.slug,
			});
		} else if (b.dataset.del) {
			if (
				!confirm(
					`Удалить команду «${b.dataset.name}»? Это удалит все её расписания и группы.`,
				)
			)
				return;
			try {
				await adminDeleteTeam(b.dataset.del);
				await renderAdminTeams();
				toast("Команда удалена");
			} catch (err) {
				toast(err.message, true);
			}
		}
	});
}

function setBackToAdminVisible(visible) {
	$("back-to-admin").hidden = !visible;
}

// ---------- обработчики основной страницы ----------
function wireAppHandlers() {
	on(render);

	initEditor();
	initGroups();
	initTips();

	$("save").onclick = () => run(save, "Сохранено");
	$("cancel").onclick = () =>
		dirty() && confirm("Отменить все несохранённые изменения?") && cancel();
	$("prev").onclick = () => run(() => goWeek(addDays(state.weekStart, -7)));
	$("next").onclick = () => run(() => goWeek(addDays(state.weekStart, 7)));
	$("copy").onclick = () =>
		run(copyPrev, "Расписание скопировано с прошлой недели");
	$("sub").onchange = (e) => run(() => setSubgroups(e.target.checked));

	$("png-s").onclick = () =>
		exp(
			posterHTML(state.week, state.venues, state.teamName),
			`torpedo-raspisanie-${state.weekStart}.png`,
		);
	$("png-r").onclick = () =>
		exp(
			rosterHTML(state.groups, localISO(), state.teamName),
			`torpedo-sostavy-${localISO()}.png`,
		);

	$("back-to-admin").onclick = async () => {
		if (
			dirty() &&
			!confirm("Есть несохранённые изменения. Вернуться к списку команд?")
		)
			return;
		resetState();
		currentMe = { role: "admin", login: currentMe.login };
		await enterApp(currentMe);
	};

	$("logout").onclick = () => {
		if (
			dirty() &&
			!confirm("Есть несохранённые изменения. Выйти без сохранения?")
		)
			return;
		doLogout();
	};

	// Админ-панель: открыть команду по клику
	wireAdminPanel();
	wireVenuesPanel();

	addEventListener("beforeunload", (e) => {
		if (dirty()) {
			e.preventDefault();
			e.returnValue = "";
		}
	});
}

function doLogout() {
	logout();
	currentMe = null;
	resetState();
	$("team-chip").hidden = true;
	$("admin-panel").hidden = true;
	showLogin();
}

async function run(fn, okMsg) {
	busy = true;
	render();
	try {
		const r = await fn();
		if (okMsg && r !== false) toast(okMsg);
		return r;
	} catch (e) {
		if (e.status === 401) {
			toast("Сессия истекла, войдите заново", true);
			doLogout();
			return;
		}
		toast(e.message, true);
	} finally {
		busy = false;
		render();
	}
}

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

// ---------- инициализация ----------
const escapeHtml = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
const escapeAttr = escapeHtml;

async function boot() {
	wireAppHandlers();
	await initLogin();
	render(); // на случай, если что-то уже загружено

	const t = getToken();
	if (!t) {
		showLogin();
		return;
	}
	try {
		const me = await getMe();
		currentMe = me;
		await enterApp(me);
	} catch {
		setToken("");
		showLogin();
	}
}

boot();

// Автоматически оборачиваем все <select>, которые уже есть в DOM.
// Динамически вставляемые оборачиваются в editor.mjs/groups-ui.mjs через enhanceAllSelects.
enhanceAllSelects(document);
