// PNG: афиша рендерится в скрытом узле шириной 1080 px, высота растёт по содержимому.
const W = 1080,
	MAX_PIXELS = 16e6; // потолок канваса iOS Safari ~16.7 млн пикселей

export async function exportPng(html, filename) {
	const lib = window.htmlToImage;
	if (!lib) throw new Error("не загружена библиотека html-to-image");
	const wrap = document.createElement("div"); // 0×0 с overflow:hidden: не виден и не смещает узел за экран
	wrap.className = "export-wrap";
	wrap.setAttribute("aria-hidden", "true");
	wrap.innerHTML = `<div class="pw export">${html}</div>`;
	document.body.append(wrap);
	try {
		if (document.fonts) {
			// иначе в PNG может попасть системный шрифт
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
		const blob = await lib.toBlob(node, {
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
