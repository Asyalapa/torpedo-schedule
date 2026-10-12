import { toBlob } from "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm";

const W = 1080,
	MAX_PIXELS = 16e6;

export async function exportPng(html, filename) {
	const wrap = document.createElement("div");
	wrap.className = "export-wrap";
	wrap.setAttribute("aria-hidden", "true");
	wrap.innerHTML = `<div class="pw export">${html}</div>`;
	document.body.append(wrap);
	try {
		if (document.fonts) {
			await Promise.all(
				["400", "700"].map((w) =>
					document.fonts.load(`${w} 36px Play`, "АЯёЁ0:–«»"),
				),
			);
			await document.fonts.ready;
		}
		const node = wrap.firstElementChild;
		const ratio = Math.min(
			2,
			Math.sqrt(MAX_PIXELS / (W * (node.offsetHeight || 1))),
		);
		const blob = await toBlob(node, {
			pixelRatio: ratio,
			backgroundColor: "#ffffff",
		});
		if (!blob) throw new Error("браузер не смог создать изображение");
		const a = Object.assign(document.createElement("a"), {
			href: URL.createObjectURL(blob),
			download: filename,
		});
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 10000);
	} finally {
		wrap.remove();
	}
}
