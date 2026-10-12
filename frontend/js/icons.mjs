const P = {
	snow: '<path d="M12 2v20M4.2 7l15.6 10M4.2 17L19.8 7M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
	dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
	ball: '<circle cx="12" cy="12" r="9.5"/><path d="M12 2.5v19M2.5 12h19M5 5c4 3 4 11 0 14M19 5c-4 3-4 11 0 14"/>',
	// человечек в шпагате: голова, торс, руки в стороны, ноги вдоль пола
	splits:
		'<circle cx="12" cy="4.5" r="2"/><path d="M12 7.5V16M6.5 12.5 12 9.5l5.5 3M2.5 19.5h19M12 16v3.5"/>',
	// клюшка с крюком и шайба
	stick:
		'<path d="M18 2.5 9.5 19.5H3.5"/><ellipse cx="17.5" cy="20" rx="3.5" ry="1.6"/>',
	star: '<path d="m12 2.5 2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.6l-5.9 3.2 1.3-6.7L2.5 9.5l6.6-.8z"/>',
	trophy:
		'<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M9.5 18h5M8 21h8"/>',
};
export const ICON_NAMES = Object.keys(P);
export const icon = (n) =>
	`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
