const BASE = document.querySelector("meta[name=api-base]")?.content ?? "";
const KEY = "torpedo_token";

export const getToken = () => localStorage.getItem(KEY) || "";
export const setToken = (t) =>
	t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY);

export class ApiError extends Error {
	constructor(status, message, data) {
		super(message);
		this.status = status;
		this.data = data;
	}
}

async function req(method, path, body, { auth = true } = {}) {
	let r;
	const headers = { "Content-Type": "application/json" };
	if (auth) {
		const t = getToken();
		if (t) headers.Authorization = `Bearer ${t}`;
	}
	try {
		r = await fetch(`${BASE}/api${path}`, {
			method,
			headers,
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

// --- аутентификация ---

// Публичный список команд для выпадашки на логине.
export const listTeams = () =>
	req("GET", "/auth/teams", undefined, { auth: false });

// body: { team_slug, password } ИЛИ { admin_login, password }
export const login = (body) =>
	req("POST", "/auth/login", body, { auth: false }).then((res) => {
		if (res?.token) setToken(res.token);
		return res;
	});

export const logout = () => {
	setToken("");
};

// Кто я: { role: "coach"|"admin", team?: {id,name}, login?: "admin" }
export const getMe = () => req("GET", "/auth/me");

// admin
export const adminListTeams = () => req("GET", "/admin/teams");
export const adminCreateTeam = (body) => req("POST", "/admin/teams", body);
export const adminPatchTeam = (id, body) =>
	req("PUT", `/admin/teams/${id}`, body);
export const adminDeleteTeam = (id) => req("DELETE", `/admin/teams/${id}`);
export const adminListVenues = () => req("GET", "/admin/venues");
export const adminCreateVenue = (body) => req("POST", "/admin/venues", body);
export const adminUpdateVenue = (vid, body) =>
	req("PUT", `/admin/venues/${vid}`, body);
export const adminDeleteVenue = (vid) => req("DELETE", `/admin/venues/${vid}`);
