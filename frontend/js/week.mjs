import { addDays } from "./poster.mjs";
export const localISO = (d = new Date()) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function mondayOf(d = new Date()) {
	// локальная дата, без сюрпризов часовых поясов
	const iso = localISO(d);
	return addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
}
