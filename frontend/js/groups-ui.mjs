import { enhanceAllSelects } from "./dropdown.mjs";
import { esc } from "./poster.mjs";
import { emit, groupUsage, on, state, uid } from "./state.mjs";

const $ = (s) => document.querySelector(s);
const open = new Set();

export const parseNames = (text, existing = []) => {
	const seen = new Set(existing.map((n) => n.toLowerCase()));
	return text
		.split("\n")
		.map((s) => s.trim())
		.filter(
			(s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()),
		);
};

const move = (a, i, d) => {
	const j = i + d;
	if (i >= 0 && j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]];
};

export function renderGroups() {
	const el = $("#groups-editor");
	el.querySelectorAll("details[data-g]").forEach((d) => {
		if (d.open) open.add(d.dataset.g);
		else open.delete(d.dataset.g);
	});
	el.innerHTML = state.groups
			.map((g) => `<details data-g="${g.id}" ${open.has(g.id) ? "open" : ""}>
<summary>${esc(g.name)} · ${g.players.length}</summary>
<label class="roster-toggle">
  <input type="checkbox" data-rprint ${g.print_on_roster !== false ? "checked" : ""}>
  Печатать состав в афише
</label>
<label>Название<input data-gname value="${esc(g.name)}"></label>
<ol class="pl">${g.players
					.map(
						(p) =>
							`<li data-p="${p.id}"><input data-pname value="${esc(p.name)}" aria-label="Имя игрока"><button type="button" data-act="pup" aria-label="Выше">↑</button><button type="button" data-act="pdn" aria-label="Ниже">↓</button><button type="button" class="alt" data-act="pdel" aria-label="Удалить">✕</button></li>`,
					)
					.join("")}</ol>
<div class="row"><input data-newp placeholder="Имя игрока" style="flex:1"><button type="button" data-act="padd">Добавить</button></div>
<details><summary>Вставить список</summary><textarea data-bulk rows="5" placeholder="По одному имени в строке"></textarea><div data-prev></div><button type="button" data-act="bulk">Добавить из списка</button></details>
<div class="row"><button type="button" class="alt" data-act="gup">Группу выше</button><button type="button" class="alt" data-act="gdn">Ниже</button><button type="button" class="alt" data-act="gdel">Удалить группу</button></div></details>`,
			)
			.join("") + '<button type="button" data-act="gadd">+ Добавить группу</button>';
	el.querySelectorAll("details[data-g]").forEach((d) => {
		d.addEventListener("toggle", () => {
			if (d.open) open.add(d.dataset.g);
			else open.delete(d.dataset.g);
		});
	});
	enhanceAllSelects(el);
}

export function initGroups() {
	const el = $("#groups-editor");
	const done = () => {
		emit("groups");
	};

	el.addEventListener("click", (ev) => {
		const b = ev.target.closest("[data-act]");
		if (!b) return;
		const act = b.dataset.act;
		if (act === "gadd") {
			const g = { id: uid(), name: "Новая группа", players: [] };
			state.groups.push(g);
			open.add(g.id);
			done();
			requestAnimationFrame(() => {
				const det = el.querySelector(`details[data-g="${g.id}"]`);
				det?.scrollIntoView({ block: "nearest" });
				det?.querySelector("[data-gname]")?.focus();
			});
			return;
		}
		const d = b.closest("[data-g]"),
			g = state.groups.find((x) => x.id === d.dataset.g),
			gi = state.groups.indexOf(g);
		const li = b.closest("[data-p]"),
			pi = li ? g.players.findIndex((p) => p.id === li.dataset.p) : -1;
		open.add(g.id);
		if (act === "pup") move(g.players, pi, -1);
		else if (act === "pdn") move(g.players, pi, 1);
		else if (act === "pdel") g.players.splice(pi, 1);
		else if (act === "gup") move(state.groups, gi, -1);
		else if (act === "gdn") move(state.groups, gi, 1);
		else if (act === "gdel") {
			const n = groupUsage(g.id);
			if (
				!confirm(
					n
						? `Группа назначена в занятиях этой недели: ${n}. В афише останется её старое название. Удалить?`
						: `Удалить группу «${g.name}»?`,
				)
			)
				return;
			state.groups.splice(gi, 1);
		} else if (act === "padd") {
			const inp = d.querySelector("[data-newp]"),
				[name] = parseNames(
					inp.value,
					g.players.map((p) => p.name),
				);
			if (!name) return;
			g.players.push({ id: uid(), name });
		} else if (act === "bulk") {
			const names = parseNames(
				d.querySelector("[data-bulk]").value,
				g.players.map((p) => p.name),
			);
			for (const name of names) g.players.push({ id: uid(), name });
		}
		done();
	});

	el.addEventListener("input", (ev) => {
		const ta = ev.target.closest("[data-bulk]");
		if (!ta) return;
		const g = state.groups.find(
			(x) => x.id === ta.closest("[data-g]").dataset.g,
		);
		ta.parentElement.querySelector("[data-prev]").textContent =
			`Будет добавлено: ${
				parseNames(
					ta.value,
					g.players.map((p) => p.name),
				).length
			}`;
	});

	el.addEventListener("change", (ev) => {
		const g = state.groups.find(
			(x) => x.id === ev.target.closest("[data-g]")?.dataset.g,
		);
		if (!g) return;

		// чекбокс «печатать в афише составов»
		if (ev.target.matches("[data-rprint]")) {
			g.print_on_roster = ev.target.checked;
			emit("names");
			return;
		}

		const v = ev.target.value.trim();
		if (ev.target.matches("[data-gname]") && v) g.name = v;
		if (ev.target.matches("[data-pname]") && v)
			g.players.find(
				(p) => p.id === ev.target.closest("[data-p]").dataset.p,
			).name = v;
		emit("names");
	});

	on((k) => {
		if (["groups", "reset", "settings"].includes(k)) renderGroups();
	});

	renderGroups();
}

// Подсказка с составом: клик/тап везде, hover — только где есть мышь.
export function initTips() {
	const tip = Object.assign(document.createElement("div"), {
		id: "tip",
		hidden: true,
	});
	document.body.append(tip);
	let pinned = false;
	const hide = () => {
		tip.hidden = true;
		pinned = false;
	};
	const show = (btn) => {
		const g = state.groups.find((x) => x.id === btn.dataset.tip);
		if (!g) return;
		tip.innerHTML = `<b>${esc(g.name)} · ${g.players.length} игр.</b><div>${g.players.length ? g.players.map((p) => esc(p.name)).join(", ") : "Состав не заполнен"}</div>`;
		tip.hidden = false;
		tip.dataset.for = btn.dataset.tip;
		const r = btn.getBoundingClientRect(),
			w = tip.offsetWidth,
			h = tip.offsetHeight;
		let y = r.bottom + 6;
		if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
		tip.style.left = `${Math.min(Math.max(8, r.left), innerWidth - w - 8)}px`;
		tip.style.top = `${y}px`;
	};
	document.addEventListener("click", (e) => {
		const b = e.target.closest("[data-tip]");
		if (b) {
			e.preventDefault();
			const same = !tip.hidden && pinned && tip.dataset.for === b.dataset.tip;
			if (same) return hide();
			show(b);
			pinned = true;
		} else if (!tip.contains(e.target)) hide();
	});
	if (matchMedia("(hover:hover)").matches) {
		document.addEventListener("mouseover", (e) => {
			const b = e.target.closest("[data-tip]");
			if (b && !pinned) show(b);
		});
		document.addEventListener("mouseout", (e) => {
			if (e.target.closest("[data-tip]") && !pinned) tip.hidden = true;
		});
	}
	document.addEventListener("keydown", (e) => e.key === "Escape" && hide());
	addEventListener(
		"scroll",
		(e) => {
			if (!tip.contains(e.target)) hide();
		},
		true,
	);
}