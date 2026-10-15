/**
 * Базовый URL API. Берётся из <meta name="api-base"> в index.html.
 * Если тега нет — пустая строка (запросы идут на тот же origin).
 */
const BASE = document.querySelector("meta[name=api-base]")?.content ?? "";

/**
 * Ключ, под которым JWT-токен лежит в localStorage.
 */
const KEY = "torpedo_token";

/**
 * Возвращает текущий токен авторизации.
 * @returns {string} токен или "" если его нет
 */
export const getToken = () => localStorage.getItem(KEY) || "";

/**
 * Сохраняет или удаляет токен в localStorage.
 * @param {string} t — токен; если пусто — токен удаляется
 */
export const setToken = (t) =>
	t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY);

/**
 * Ошибка API. Помимо сообщения несёт HTTP-статус и тело ответа,
 * чтобы вызывающий код мог отличить 401 от 409 и т.д.
 */
export class ApiError extends Error {
	/**
	 * @param {number} status — HTTP-статус (0 — нет связи с сервером)
	 * @param {string} message — человекочитаемое сообщение
	 * @param {*} data — тело ответа (обычно detail или объект ошибки)
	 */
	constructor(status, message, data) {
		super(message);
		this.status = status;
		this.data = data;
	}
}

/**
 * Универсальный HTTP-запрос к API.
 * Автоматически подставляет Authorization: Bearer и Content-Type: application/json,
 * разворачивает тело ответа, а при ошибке бросает ApiError с разобранным сообщением.
 *
 * @param {"GET"|"POST"|"PUT"|"DELETE"} method — HTTP-метод
 * @param {string} path — путь относительно /api (например, "/auth/login")
 * @param {*} [body] — тело запроса; если undefined — тело не отправляется
 * @param {{auth?: boolean}} [opts] — auth: false отключает подстановку токена
 * @returns {Promise<*>} разобранный JSON ответа
 * @throws {ApiError} при сетевой ошибке или HTTP-статусе >= 400
 */
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

/**
 * GET-запрос с авторизацией.
 * @param {string} p — путь относительно /api
 * @returns {Promise<*>}
 */
export const get = (p) => req("GET", p);

/**
 * PUT-запрос с авторизацией.
 * @param {string} p — путь относительно /api
 * @param {*} b — тело запроса
 * @returns {Promise<*>}
 */
export const put = (p, b) => req("PUT", p, b);

/**
 * POST-запрос с авторизацией.
 * @param {string} p — путь относительно /api
 * @param {*} b — тело запроса
 * @returns {Promise<*>}
 */
export const post = (p, b) => req("POST", p, b);

// --- аутентификация ---

/**
 * Публичный список команд для выпадашки на экране логина.
 * Токен не требуется.
 * @returns {Promise<Array<{id: string, slug: string, name: string}>>}
 */
export const listTeams = () =>
	req("GET", "/auth/teams", undefined, { auth: false });

/**
 * Логин. Принимает либо данные тренера, либо администратора:
 *  - { team_slug, password }
 *  - { admin_login, password }
 * При успехе сохраняет токен в localStorage.
 * @param {object} body — данные входа
 * @returns {Promise<{token: string, role: string, team?: object, login?: string}>}
 */
export const login = (body) =>
	req("POST", "/auth/login", body, { auth: false }).then((res) => {
		if (res?.token) setToken(res.token);
		return res;
	});

/**
 * Выход: удаляет токен из localStorage.
 * На сервер ничего не отправляет (JWT не отзывается).
 * @returns {void}
 */
export const logout = () => {
	setToken("");
};

/**
 * Кто я: возвращает роль и связанную команду или логин админа.
 * Требует валидного токена.
 * @returns {Promise<{role: "coach"|"admin", team?: {id: string, name: string}, login?: string}>}
 */
export const getMe = () => req("GET", "/auth/me");

// --- админ: команды ---

/**
 * Список всех команд (только для админа).
 * @returns {Promise<Array<{id: string, slug: string, name: string, subgroups_enabled: number|null}>>}
 */
export const adminListTeams = () => req("GET", "/admin/teams");

/**
 * Создаёт команду (только для админа).
 * @param {{name: string, slug: string, password: string}} body
 * @returns {Promise<{id: string, slug: string, name: string}>}
 */
export const adminCreateTeam = (body) => req("POST", "/admin/teams", body);

/**
 * Обновляет команду (только для админа).
 * Все поля кроме name можно не передавать.
 * @param {string} id — id команды
 * @param {{name?: string, password?: string, subgroups_enabled?: boolean}} body
 * @returns {Promise<{ok: true}>}
 */
export const adminPatchTeam = (id, body) =>
	req("PUT", `/admin/teams/${id}`, body);

/**
 * Удаляет команду вместе со всеми её расписаниями и группами (только для админа).
 * @param {string} id — id команды
 * @returns {Promise<{deleted: string}>}
 */
export const adminDeleteTeam = (id) => req("DELETE", `/admin/teams/${id}`);

// --- админ: площадки ---

/**
 * Список всех площадок (только для админа).
 * @returns {Promise<Array<{id: string, name: string, color: string, tint: string}>>}
 */
export const adminListVenues = () => req("GET", "/admin/venues");

/**
 * Создаёт площадку (только для админа).
 * @param {{name: string, color: string, tint: string}} body
 * @returns {Promise<{id: string, name: string, color: string, tint: string}>}
 */
export const adminCreateVenue = (body) => req("POST", "/admin/venues", body);

/**
 * Обновляет площадку (только для админа).
 * @param {string} vid — id площадки
 * @param {{id: string, name: string, color: string, tint: string}} body
 * @returns {Promise<{id: string, name: string, color: string, tint: string}>}
 */
export const adminUpdateVenue = (vid, body) =>
	req("PUT", `/admin/venues/${vid}`, body);

/**
 * Удаляет площадку (только для админа).
 * Сервер вернёт 409, если площадка используется в расписаниях.
 * @param {string} vid — id площадки
 * @returns {Promise<{deleted: string}>}
 */
export const adminDeleteVenue = (vid) => req("DELETE", `/admin/venues/${vid}`);