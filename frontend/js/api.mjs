const BASE = document.querySelector("meta[name=api-base]")?.content ?? "";
const KEY = "torpedo_admin_token";
const getToken = () => localStorage.getItem(KEY) || "";
export default getToken
export const setToken = (t) =>
	t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY);

export class ApiError extends Error {
	constructor(status, message, data) {
		super(message);
		this.status = status;
		this.data = data;
	}
}
async function req(method, path, body) {
	let r;
	try {
		r = await fetch(`${BASE}/api${path}`, {
			method,
			headers: {
				"Content-Type": "application/json",
				"X-Admin-Token": getToken(),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch {
		throw new ApiError(
			0,
			"Нет связи с сервером. Проверьте интернет и повторите",
		);
	}
	const data = await r.json().catch(() => null);
	if (!r.ok) {
		const d = data?.detail;
		const msg = data?.errors?.length
			? data.errors.map((e) => e.message).join(". ")
			: typeof d === "string"
				? d
				: d?.message || `Ошибка сервера (${r.status})`;
		throw new ApiError(r.status, msg, d);
	}
	return data;
}
export const get = (p) => req("GET", p);
export const put = (p, b) => req("PUT", p, b);
export const post = (p, b) => req("POST", p, b);
