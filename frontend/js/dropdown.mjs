// js/dropdown.mjs

const openInstances = new Set();

function closeAllExcept(keep = null) {
	for (const inst of [...openInstances]) {
		if (inst !== keep) inst.close();
	}
}

let globalBound = false;
function bindGlobal() {
	if (globalBound) return;
	globalBound = true;

	document.addEventListener("click", (e) => {
		for (const inst of [...openInstances]) {
			if (!inst.wrap.contains(e.target)) inst.close();
		}
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") closeAllExcept(null);
	});
}

/* ------------------------------------------------------------------ */
/* Обёртка над нативным <select>                                       */
/* ------------------------------------------------------------------ */
export function enhanceSelect(sel) {
	if (!sel || sel.dataset.enhanced === "1") return;
	sel.dataset.enhanced = "1";
	sel.classList.add("native-hidden");

	const wrap = document.createElement("div");
	wrap.className = "dd";
	wrap.innerHTML = `
    <button type="button" class="dd-toggle" aria-haspopup="listbox" aria-expanded="false">
      <span class="dd-value"></span>
      <svg class="dd-arrow" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="dd-list" role="listbox" hidden></div>`;
	sel.after(wrap);

	const btn = wrap.querySelector(".dd-toggle");
	const list = wrap.querySelector(".dd-list");
	const value = wrap.querySelector(".dd-value");

	function render() {
		const opts = [...sel.options];
		const cur = opts[sel.selectedIndex];
		value.textContent = cur ? cur.textContent : "";
		if (!cur?.value) value.dataset.placeholder = "";
		else delete value.dataset.placeholder;

		list.innerHTML = opts
			.map(
				(o, i) => `
      <div role="option" data-i="${i}"
          aria-selected="${o.selected}"
          class="${o.disabled ? "disabled" : ""}">${o.textContent}</div>`,
			)
			.join("");
	}

	// ЛОКАЛЬНЫЕ open/close — замыкание на этот конкретный экземпляр
	function open() {
		closeAllExcept(inst);
		list.hidden = false;
		btn.setAttribute("aria-expanded", "true");
		wrap.classList.add("open");
		openInstances.add(inst);
	}
	function close() {
		if (list.hidden) return;
		list.hidden = true;
		btn.setAttribute("aria-expanded", "false");
		wrap.classList.remove("open");
		openInstances.delete(inst);
	}

	const inst = { wrap, open, close, render };

	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		list.hidden ? open() : close();
	});

	list.addEventListener("mousedown", (e) => e.preventDefault());
	list.addEventListener("click", (e) => {
		e.stopPropagation();
		const div = e.target.closest("div[data-i]");
		if (!div) return;
		sel.selectedIndex = Number(div.dataset.i);
		sel.dispatchEvent(new Event("change", { bubbles: true }));
		render();
		inst.close();
	});

	sel.addEventListener("change", render);

	bindGlobal();
	render();
	return inst;
}

export function enhanceAllSelects(root = document) {
	root.querySelectorAll("select:not([data-enhanced])").forEach(enhanceSelect);
}

/* ------------------------------------------------------------------ */
/* Чистый дропдаун без <select> — для логина                           */
/* ------------------------------------------------------------------ */
export function mountDropdown(
	container,
	{ items, onPick, placeholder = "Выберите" },
) {
	const valueEl = container.querySelector(".dd-value");
	const list = container.querySelector(".dd-list");
	const btn = container.querySelector(".dd-toggle");
	const hidden = container.querySelector('input[type="hidden"]');
	let current = null;

	valueEl.textContent = placeholder;
	valueEl.dataset.placeholder = "";

	function renderItems(next) {
		list.innerHTML = next
			.map(
				(it) =>
					`<div role="option" data-v="${escapeAttr(it.value)}">${escapeHtml(it.label)}</div>`,
			)
			.join("");
	}
	renderItems(items);

	// ЛОКАЛЬНЫЕ open/close — замыкание на этот конкретный экземпляр
	function open() {
		closeAllExcept(inst);
		list.hidden = false;
		btn.setAttribute("aria-expanded", "true");
		container.classList.add("open");
		openInstances.add(inst);
	}
	function close() {
		if (list.hidden) return;
		list.hidden = true;
		btn.setAttribute("aria-expanded", "false");
		container.classList.remove("open");
		openInstances.delete(inst);
	}

	const inst = { wrap: container, open, close };

	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		list.hidden ? open() : close();
	});

	list.addEventListener("mousedown", (e) => e.preventDefault());
	list.addEventListener("click", (e) => {
		e.stopPropagation();
		const opt = e.target.closest('[role="option"]');
		if (!opt) return;
		current = { value: opt.dataset.v, label: opt.textContent };
		valueEl.textContent = current.label;
		delete valueEl.dataset.placeholder;
		if (hidden) hidden.value = current.value;
		onPick?.(current);
		inst.close();
	});

	bindGlobal();

	return {
		setItems: renderItems,
		get value() {
			return current?.value ?? "";
		},
		reset() {
			current = null;
			valueEl.textContent = placeholder;
			valueEl.dataset.placeholder = "";
			if (hidden) hidden.value = "";
		},
	};
}

const escapeHtml = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
const escapeAttr = (s) => escapeHtml(s);
