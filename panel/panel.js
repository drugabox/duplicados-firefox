/* Interfaz: lista de duplicados, ajustes y ayuda. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const mode = new URLSearchParams(location.search).get("mode") || "window"; // window | sidebar | options
document.documentElement.dataset.mode = mode;

let settings = { ...DupSettings.DEFAULTS };
let state = null;
let filter = "todos";
let query = "";
let pendingFocus = null;
let highlightTabId = null;
let lastRenderSig = "";

// Crea elementos sin innerHTML: los títulos de las webs nunca se interpretan como HTML.
const h = (tag, attrs = {}, ...children) => {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === null || v === undefined || v === false) continue;
		if (k === "class") el.className = v;
		else if (k === "dataset") Object.assign(el.dataset, v);
		else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
		else if (k === "style") el.style.cssText = v;
		else el.setAttribute(k, v === true ? "" : v);
	}
	for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	return el;
};

const ICONS = {
	go: "M5 12h14M13 6l6 6-6 6",
	keep: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
	ignore: "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6c1.5 0 2.9-.4 4.1-1",
	close: "M6 6l12 12M18 6L6 18"
};
const icon = (name) => {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
	p.setAttribute("d", ICONS[name]);
	svg.append(p);
	return svg;
};

// ------------------------------------------------------------------ conexión con el fondo

const port = browser.runtime.connect({ name: "panel" });
const send = (msg) => port.postMessage(msg);

port.onMessage.addListener((msg) => {
	if (msg.type === "state") {
		state = msg.state;
		render();
		if (pendingFocus) applyFocus(pendingFocus);
	} else if (msg.type === "focus") {
		applyFocus(msg.focus);
	}
});

// ------------------------------------------------------------------ vistas

const showView = (name) => {
	for (const b of $$(".views button")) b.setAttribute("aria-selected", String(b.dataset.view === name));
	for (const v of $$(".view")) v.hidden = v.id !== "view-" + name;
	if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
};
$$(".views button").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));

// ------------------------------------------------------------------ lista

const windowNumbers = () => {
	const ids = [...new Set(state.groups.flatMap(g => g.tabs.map(t => t.windowId)))].sort((a, b) => a - b);
	return new Map(ids.map((id, i) => [id, i + 1]));
};

const safeDecode = (s) => { try { return decodeURI(s); } catch { return s; } };

// Divide una dirección en trozos para resaltar lo que cambia entre pestañas.
const urlTokens = (url) => {
	try {
		const u = new URL(url);
		if (!/^https?:$/.test(u.protocol)) return [{ id: "raw:" + url, text: url }];
		const t = [{ id: "host:" + u.host.replace(/^www\./, ""), text: u.host }];
		if (u.pathname !== "/") t.push({ id: "path:" + u.pathname, text: safeDecode(u.pathname) });
		let first = true;
		for (const [k, v] of u.searchParams) {
			t.push({ id: `q:${k}=${v}`, text: (first ? "?" : "&") + k + (v ? "=" + v : "") });
			first = false;
		}
		if (u.hash) t.push({ id: "hash:" + u.hash, text: safeDecode(u.hash) });
		return t;
	} catch { return [{ id: "raw:" + url, text: url }]; }
};

const renderUrl = (url, common, short) => {
	const tokens = urlTokens(url);
	const el = h("div", { class: "tab-url", title: url });
	tokens.forEach((tk, i) => {
		const differs = common && !common.has(tk.id);
		if (short && !differs && i > 1) return;
		el.append(differs ? h("mark", {}, tk.text) : tk.text);
	});
	return el;
};

const favicon = (t) => {
	if (settings.showFavicons && t.favIconUrl && !t.favIconUrl.startsWith("chrome:")) {
		const img = h("img", { class: "fav", src: t.favIconUrl, alt: "", loading: "lazy" });
		img.addEventListener("error", () => img.replaceWith(letterIcon(t)), { once: true });
		return img;
	}
	return letterIcon(t);
};
const letterIcon = (t) => {
	let ch = "?";
	try { ch = new URL(t.url).hostname.replace(/^www\./, "").charAt(0).toUpperCase() || "?"; } catch { /* nada */ }
	return h("span", { class: "fav letter", "aria-hidden": "true" }, settings.showFavicons ? ch : "•");
};

const CONTAINER_COLORS = { blue: "#37adff", turquoise: "#00c79a", green: "#51cd00", yellow: "#ffcb00", orange: "#ff9f00", red: "#ff613d", pink: "#ff4bda", purple: "#af51f5", toolbar: "#7c7c7d" };

const matchesQuery = (g) => {
	if (!query) return true;
	const q = query.toLowerCase();
	return g.tabs.some(t => (t.title || "").toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) || (g.what || "").toLowerCase().includes(q);
};

const visibleGroups = () => {
	if (!state) return [];
	return state.groups.filter(g => {
		if (filter === "ignorado") return g.ignored;
		if (g.ignored) return false;
		if (filter !== "todos" && g.level !== filter) return false;
		return matchesQuery(g);
	}).sort((a, b) => (a.level === b.level ? 0 : a.level === "seguro" ? -1 : 1));
};

const renderStats = () => {
	const s = state.stats;
	const box = $("#stats");
	box.replaceChildren();
	if (s.extra) box.append(h("span", { class: "stat safe", title: "Pestañas que sobran" }, `${s.extra} sobrante${s.extra > 1 ? "s" : ""}`));
	if (s.doubtful) box.append(h("span", { class: "stat doubt" }, `${s.doubtful} dudoso${s.doubtful > 1 ? "s" : ""}`));
	if (!s.extra && !s.doubtful) box.append(h("span", { class: "stat ok" }, "Todo en orden"));
	box.append(h("span", { class: "stat", title: "Pestañas comprobadas" }, `${s.tabs} pestañas`));
};

const render = () => {
	if (!state) return;
	const sig = JSON.stringify([state, filter, query, highlightTabId, settings.urlDisplay, settings.showFavicons]);
	if (sig === lastRenderSig) return;
	lastRenderSig = sig;

	renderStats();
	const closable = state.groups.filter(g => g.level === "seguro" && !g.ignored).reduce((n, g) => n + g.tabs.filter(t => t.id !== g.keepId && !t.pinned).length, 0);
	const btn = $("#closeAll");
	btn.disabled = closable === 0;
	btn.textContent = closable ? `Cerrar ${closable} duplicado${closable > 1 ? "s" : ""}` : "Cerrar duplicados";
	$("#undo").hidden = !state.undo;

	const focusedTab = document.activeElement && document.activeElement.closest(".tab") ? Number(document.activeElement.closest(".tab").dataset.tab) : null;
	const wins = windowNumbers();
	const multiWin = wins.size > 1;
	const list = $("#groups");
	const groups = visibleGroups();
	const frag = document.createDocumentFragment();

	if (filter === "ignorado" && (state.ignoredTabs || groups.length)) {
		frag.append(h("div", { class: "banner" },
			`${groups.length} página${groups.length === 1 ? "" : "s"} con «mantener todas» y ${state.ignoredTabs || 0} pestaña${state.ignoredTabs === 1 ? "" : "s"} marcada${state.ignoredTabs === 1 ? "" : "s"} como «no es duplicada». `,
			h("button", { class: "btn small ghost", onclick: () => send({ cmd: "unignoreAll" }) }, "Volver a vigilarlo todo")));
	}

	let lastLevel = null;
	for (const g of groups) {
		if (filter === "todos" && g.level !== lastLevel && groups.some(x => x.level !== g.level)) {
			frag.append(h("div", { class: "section-title" }, g.level === "seguro" ? "Duplicados" : "Dudosos — revisa tú"));
		}
		lastLevel = g.level;
		frag.append(renderGroup(g, wins, multiWin));
	}
	list.replaceChildren(frag);

	const empty = $("#empty");
	empty.hidden = groups.length > 0 || (filter === "ignorado" && state.ignoredTabs);
	if (!groups.length) {
		$("h2", empty).textContent = query ? "Nada coincide con la búsqueda" : filter === "ignorado" ? "No hay nada ignorado" : filter === "dudoso" ? "No hay casos dudosos" : "No hay pestañas duplicadas";
		$("p", empty).textContent = query ? "Prueba con otra palabra." : "Cuando abras una página que ya tengas abierta, aparecerá aquí.";
	}
	if (focusedTab) {
		const row = $(`.tab[data-tab="${focusedTab}"]`);
		if (row) row.focus({ preventScroll: true });
	}
};

const renderGroup = (g, wins, multiWin) => {
	const isSafe = g.level === "seguro";
	const common = new Set(urlTokens(g.tabs[0].url).map(t => t.id).filter(id => g.tabs.every(t => urlTokens(t.url).some(x => x.id === id))));
	const short = settings.urlDisplay === "short";
	let host = "";
	try { host = new URL(g.tabs[0].url).hostname.replace(/^www\./, ""); } catch { /* interna */ }

	const head = h("div", { class: "group-head" },
		h("span", { class: "pill " + (isSafe ? "safe" : "doubt") }, isSafe ? (g.identical ? "Idénticas" : "Duplicado") : "Dudoso"),
		h("span", { class: "what" }, g.what || g.site || host, g.what && host ? h("small", {}, " · " + host) : null, h("small", {}, ` · ${g.tabs.length} pestañas`)),
		h("div", { class: "group-actions" },
			g.ignored
				? h("button", { class: "btn small ghost", onclick: () => send({ cmd: "unignoreGroup", groupId: g.id }) }, "Volver a vigilar")
				: [
					isSafe ? h("button", { class: "btn small primary", title: "Cierra todas menos la marcada con ★", onclick: () => send({ cmd: "closeGroup", groupId: g.id }) }, `Cerrar ${g.tabs.length - 1} sobrante${g.tabs.length > 2 ? "s" : ""}`) : null,
					h("button", { class: "btn small ghost", title: "No volver a avisar de esta página en esta sesión", onclick: () => { send({ cmd: "ignoreGroup", groupId: g.id }); toast("No se volverá a avisar de esta página durante la sesión."); } }, "Mantener todas")
				]
		)
	);

	const why = h("div", { class: "why" }, h("strong", {}, g.title + (g.details.length ? ": " : ".")));
	if (g.details.length === 1) why.append(g.details[0].replace(/\.$/, "").replace(/^./, c => c.toLowerCase()) + ".");
	else if (g.details.length > 1) why.append(h("ul", {}, g.details.map(d => h("li", {}, d))));

	const ul = h("ul", { class: "tablist" });
	for (const t of g.tabs) {
		const chips = [];
		if (t.id === highlightTabId) chips.push(h("span", { class: "chip new" }, "Recién abierta"));
		if (isSafe && t.id === g.keepId) chips.push(h("span", { class: "chip keep", title: "Es la que se conserva al cerrar sobrantes" }, "★ Se conserva"));
		if (multiWin) chips.push(h("span", { class: "chip" }, "Ventana " + wins.get(t.windowId)));
		const c = state.containers && state.containers[t.cookieStoreId];
		if (c) chips.push(h("span", { class: "chip container", style: `background:${CONTAINER_COLORS[c.color] || c.color || "#888"}` }, c.name));
		if (t.incognito) chips.push(h("span", { class: "chip" }, "Privada"));
		if (t.pinned) chips.push(h("span", { class: "chip" }, "📌 Fijada"));
		if (t.active) chips.push(h("span", { class: "chip" }, "Visible"));
		if (t.discarded) chips.push(h("span", { class: "chip", title: "Firefox la tiene descargada de memoria" }, "Dormida"));
		if (t.audible) chips.push(h("span", { class: "chip" }, "🔊 Sonando"));
		if (t.intentional) chips.push(h("span", { class: "chip", title: "Se abrió desde la misma página: no genera avisos" }, "Abierta a propósito"));

		const li = h("li", { class: "tab" + (t.id === highlightTabId ? " focused" : ""), tabindex: "0", dataset: { tab: t.id, group: g.id } },
			favicon(t),
			h("div", { class: "tab-main" },
				h("div", { class: "tab-title", title: "Ir a esta pestaña", onclick: () => send({ cmd: "activate", tabId: t.id }) }, t.title || t.url),
				renderUrl(t.url, g.tabs.length > 1 ? common : null, short),
				chips.length ? h("div", { class: "meta" }, chips) : null
			),
			h("div", { class: "tab-acts" },
				h("button", { class: "icon-btn", title: "Ir a esta pestaña (Intro)", "aria-label": "Ir", onclick: () => send({ cmd: "activate", tabId: t.id }) }, icon("go")),
				h("button", { class: "icon-btn", title: "Conservar solo esta y cerrar las demás del grupo (K)", "aria-label": "Conservar solo esta", onclick: () => send({ cmd: "keepOnly", groupId: g.id, tabId: t.id }) }, icon("keep")),
				h("button", { class: "icon-btn", title: "No es duplicada: ignorar esta pestaña", "aria-label": "Ignorar", onclick: () => send({ cmd: "ignoreTab", tabId: t.id }) }, icon("ignore")),
				h("button", { class: "icon-btn close", title: "Cerrar esta pestaña (Supr)", "aria-label": "Cerrar", onclick: () => send({ cmd: "close", tabIds: [t.id] }) }, icon("close"))
			)
		);
		ul.append(li);
	}
	return h("article", { class: `group ${g.level}${g.ignored ? " ignored" : ""}`, dataset: { id: g.id } }, head, why, ul);
};

// Saltar a la pareja recién abierta
const applyFocus = (f) => {
	if (!f) return;
	showView("lista");
	if (f.message) { showBanner(f.message); pendingFocus = null; return; }
	if (!state) { pendingFocus = f; return; }
	const g = state.groups.find(x => x.id === f.groupId);
	if (!g) {
		// Puede que el estado aún no haya llegado; se reintenta con la próxima actualización.
		pendingFocus = f.tries > 3 ? null : { ...f, tries: (f.tries || 0) + 1 };
		return;
	}
	pendingFocus = null;
	filter = g.ignored ? "ignorado" : "todos";
	syncFilterButtons();
	query = "";
	$("#search").value = "";
	highlightTabId = f.tabId || null;
	render();
	const card = $(`.group[data-id="${CSS.escape(g.id)}"]`);
	if (!card) return;
	card.classList.remove("flash");
	void card.offsetWidth;
	card.classList.add("flash");
	card.scrollIntoView({ block: "center", behavior: "smooth" });
	const row = f.tabId ? $(`.tab[data-tab="${f.tabId}"]`, card) : $(".tab", card);
	if (row) row.focus({ preventScroll: true });
	showBanner(g.level === "seguro" ? "Acabas de abrir una página que ya estaba abierta." : "Acabas de abrir una página parecida a otra que ya estaba abierta.");
	clearTimeout(applyFocus.t);
	applyFocus.t = setTimeout(() => { highlightTabId = null; render(); }, 15000);
};

let bannerTimer = null;
const showBanner = (text) => {
	const b = $("#banner");
	b.textContent = text;
	b.hidden = false;
	clearTimeout(bannerTimer);
	bannerTimer = setTimeout(() => { b.hidden = true; }, 8000);
};

let toastTimer = null;
const toast = (text, action) => {
	const t = $("#toast");
	t.replaceChildren(h("span", {}, text), action ? h("button", { onclick: () => { action.fn(); t.hidden = true; } }, action.label) : null);
	t.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
};

const syncFilterButtons = () => $$("#filters button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.filter === filter)));

$$("#filters button").forEach(b => b.addEventListener("click", () => { filter = b.dataset.filter; syncFilterButtons(); render(); }));
$("#search").addEventListener("input", (e) => { query = e.target.value.trim(); render(); });
$("#closeAll").addEventListener("click", () => {
	send({ cmd: "closeAllSafe" });
	toast("Duplicados cerrados.", { label: "Deshacer", fn: () => send({ cmd: "undo" }) });
});
$("#undo").addEventListener("click", () => send({ cmd: "undo" }));

// Teclado
document.addEventListener("keydown", (e) => {
	if ($("#view-lista").hidden) return;
	const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
	if (e.key === "/" && !inField) { e.preventDefault(); $("#search").focus(); return; }
	if (e.key === "Escape" && e.target.id === "search") { e.target.value = ""; query = ""; render(); return; }
	if (inField && !(e.target.id === "search" && e.key === "ArrowDown")) return;
	const rows = $$(".tab");
	const row = e.target.closest && e.target.closest(".tab");
	const i = row ? rows.indexOf(row) : -1;
	if (e.key === "ArrowDown") { e.preventDefault(); (rows[i + 1] || rows[0])?.focus(); }
	else if (e.key === "ArrowUp") { e.preventDefault(); (rows[i - 1] || rows[rows.length - 1])?.focus(); }
	else if (!row) return;
	else if (e.key === "Enter") send({ cmd: "activate", tabId: Number(row.dataset.tab) });
	else if (e.key === "Delete" || e.key === "Backspace") {
		const next = rows[i + 1] || rows[i - 1];
		send({ cmd: "close", tabIds: [Number(row.dataset.tab)] });
		next?.focus();
	}
	else if (e.key.toLowerCase() === "k") send({ cmd: "keepOnly", groupId: row.dataset.group, tabId: Number(row.dataset.tab) });
});

// ------------------------------------------------------------------ temas

const THEMES = [
	{ id: "auto", name: "Automático", p: ["#f4f5f9", "#ffffff", "#1d2028", "#4f6bed"] },
	{ id: "claro", name: "Claro", p: ["#f4f5f9", "#ffffff", "#e1e4ec", "#4f6bed"] },
	{ id: "oscuro", name: "Oscuro", p: ["#14161c", "#1d2028", "#2f3442", "#7b93ff"] },
	{ id: "firefox", name: "Como Firefox", p: ["#f0f0f4", "#ffffff", "#1c1b22", "#0061e0"] },
	{ id: "sepia", name: "Sepia", p: ["#f3ecdf", "#fbf7ef", "#e0d3bb", "#b0602b"] },
	{ id: "lavanda", name: "Lavanda", p: ["#f5f3fb", "#ffffff", "#e0daf2", "#7c5cdb"] },
	{ id: "nord", name: "Nord", p: ["#2e3440", "#3b4252", "#4c566a", "#88c0d0"] },
	{ id: "bosque", name: "Bosque", p: ["#121a16", "#1a251f", "#2d4035", "#5fd393"] },
	{ id: "contraste", name: "Alto contraste", p: ["#000000", "#000000", "#ffffff", "#ffd400"] },
	{ id: "custom", name: "Personalizado", p: null }
];

const CUSTOM_LABELS = { bg: "Fondo", surface: "Tarjetas", text: "Texto", muted: "Texto suave", border: "Bordes", accent: "Acento", safe: "Duplicado", doubt: "Dudoso" };

const luminance = (hex) => {
	const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex || "");
	if (!m) return 1;
	const [r, g, b] = m.slice(1).map(x => { const c = parseInt(x, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const toHex = (c) => {
	if (!c) return null;
	if (Array.isArray(c)) return "#" + c.slice(0, 3).map(n => Number(n).toString(16).padStart(2, "0")).join("");
	const ctx = document.createElement("canvas").getContext("2d");
	ctx.fillStyle = "#000";
	ctx.fillStyle = c;
	return ctx.fillStyle.startsWith("#") ? ctx.fillStyle : null;
};

const applyTheme = async () => {
	const root = document.documentElement;
	root.removeAttribute("style");
	root.dataset.density = settings.density;
	root.style.setProperty("--fs", settings.fontSize + "px");
	root.style.setProperty("--radius", settings.radius + "px");
	let theme = settings.theme;
	const setVars = (v) => {
		for (const [k, val] of Object.entries(v)) if (val) root.style.setProperty("--" + k, val);
		if (v.surface && v.text) root.style.setProperty("--surface-2", `color-mix(in srgb, ${v.surface} 88%, ${v.text})`);
		if (v.bg) root.style.setProperty("color-scheme", luminance(v.bg) < 0.25 ? "dark" : "light");
	};
	if (theme === "custom") {
		setVars(settings.custom);
	} else if (theme === "firefox") {
		theme = "auto";
		try {
			const th = await browser.theme.getCurrent();
			const c = (th && th.colors) || {};
			const bg = toHex(c.frame || c.accentcolor), surface = toHex(c.popup || c.toolbar), text = toHex(c.popup_text || c.toolbar_text || c.tab_background_text);
			if (bg && surface && text) {
				theme = "firefox";
				setVars({ bg, surface, text, border: toHex(c.popup_border || c.toolbar_bottom_separator) || `color-mix(in srgb, ${surface} 80%, ${text})`, muted: `color-mix(in srgb, ${text} 65%, ${surface})`, accent: toHex(c.tab_line || c.toolbar_field_border_focus || c.icons_attention) });
			}
		} catch { /* sin tema */ }
	}
	root.dataset.theme = theme;
	if (settings.accent) setVars({ accent: settings.accent });
	const acc = getComputedStyle(root).getPropertyValue("--accent").trim();
	if (acc.startsWith("#")) root.style.setProperty("--accent-text", luminance(acc) > 0.45 ? "#111" : "#fff");
};
if (browser.theme && browser.theme.onUpdated) browser.theme.onUpdated.addListener(() => { if (settings.theme === "firefox") applyTheme(); });

const renderThemes = () => {
	const box = $("#themes");
	box.replaceChildren(...THEMES.map(t => {
		const colors = t.p || [settings.custom.bg, settings.custom.surface, settings.custom.border, settings.custom.accent];
		return h("button", { type: "button", class: "theme-card", "aria-pressed": String(settings.theme === t.id), onclick: () => save({ theme: t.id }) },
			h("div", { class: "theme-preview", style: `background:${colors[0]}` },
				h("i", { style: `background:${colors[1]};height:70%;border:1px solid ${colors[2]}` }),
				h("i", { style: `background:${colors[1]};height:100%;border:1px solid ${colors[2]}` }),
				h("i", { style: `background:${colors[3]};height:45%` })),
			h("span", {}, t.name));
	}));
	const cc = $("#customColors");
	cc.hidden = settings.theme !== "custom";
	if (!cc.hidden) {
		cc.replaceChildren(...Object.entries(CUSTOM_LABELS).map(([k, label]) =>
			h("label", {}, h("input", { type: "color", value: settings.custom[k], oninput: (e) => save({ custom: { ...settings.custom, [k]: e.target.value } }) }), label)));
	}
};

// ------------------------------------------------------------------ ajustes

let saveTimer = null;
let pendingPatch = {};
const save = (patch, delay = 0) => {
	settings = { ...settings, ...patch };
	pendingPatch = { ...pendingPatch, ...patch };
	applyTheme();
	renderThemes();
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => { const p = pendingPatch; pendingPatch = {}; DupSettings.save(p); }, delay);
};

const form = $("#settings");
form.addEventListener("submit", (e) => e.preventDefault());

const fillForm = () => {
	for (const el of form.elements) {
		if (!el.name || !(el.name in DupSettings.DEFAULTS) || el === document.activeElement) continue;
		const v = settings[el.name];
		if (el.type === "radio") el.checked = el.value === String(v);
		else if (el.type === "checkbox") el.checked = !!v;
		else if (el.type === "color") el.value = v || getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#4f6bed";
		else el.value = v;
	}
	$("#fontSizeOut").textContent = settings.fontSize + " px";
	$("#radiusOut").textContent = settings.radius + " px";
	renderThemes();
};

form.addEventListener("input", (e) => {
	const el = e.target;
	if (!el.name || !(el.name in DupSettings.DEFAULTS)) return;
	let v;
	if (el.type === "checkbox") v = el.checked;
	else if (el.type === "range") v = Number(el.value);
	else v = el.value;
	if (el.name === "fontSize") $("#fontSizeOut").textContent = v + " px";
	if (el.name === "radius") $("#radiusOut").textContent = v + " px";
	save({ [el.name]: v }, el.tagName === "TEXTAREA" || el.type === "range" || el.type === "color" ? 400 : 0);
	if (el.name === "anchorsDistinct") runTest();
});

$("#accentReset").addEventListener("click", () => { save({ accent: "" }); setTimeout(fillForm, 50); });

// Probador de direcciones
const runTest = () => {
	const a = $("#testA").value.trim(), b = $("#testB").value.trim();
	const out = $("#testResult");
	if (!a || !b) { out.hidden = true; return; }
	const r = DupNormalize.explain(a, b, { anchorsDistinct: settings.anchorsDistinct });
	const A = DupNormalize.analyze(a, { anchorsDistinct: settings.anchorsDistinct }), B = DupNormalize.analyze(b, { anchorsDistinct: settings.anchorsDistinct });
	const cls = r.level === "dudoso" ? "doubt" : r.level === "distinto" ? "neutral" : "safe";
	const label = { exacto: "Idénticas", seguro: "Duplicado", dudoso: "Dudoso", distinto: "Distintas" }[r.level];
	out.replaceChildren(
		h("div", { class: "row" }, h("span", { class: "pill " + cls }, label), h("strong", {}, r.title)),
		r.details.length ? h("ul", {}, r.details.map(d => h("li", {}, d))) : null,
		A.ok && B.ok ? h("p", { class: "hint" }, "Lo que se compara: ", h("br"), h("code", {}, A.strict), h("br"), h("code", {}, B.strict)) : null
	);
	out.hidden = false;
};
$("#testA").addEventListener("input", runTest);
$("#testB").addEventListener("input", runTest);

// Copia de seguridad
$("#export").addEventListener("click", () => {
	const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
	const a = h("a", { href: URL.createObjectURL(blob), download: "duplicados-ajustes.json" });
	document.body.append(a);
	a.click();
	setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
$("#import").addEventListener("change", async (e) => {
	const file = e.target.files[0];
	if (!file) return;
	try {
		const data = JSON.parse(await file.text());
		const clean = Object.fromEntries(Object.entries(data).filter(([k]) => k in DupSettings.DEFAULTS));
		await DupSettings.save(clean);
		toast("Ajustes importados.");
	} catch { toast("Ese archivo no es una copia de ajustes válida."); }
	e.target.value = "";
});
$("#reset").addEventListener("click", async () => {
	if (!confirm("¿Volver a los ajustes de fábrica? Se perderán tus temas y exclusiones.")) return;
	await browser.storage.local.set({ settings: { ...DupSettings.DEFAULTS } });
	toast("Ajustes restablecidos.");
});

browser.storage.onChanged.addListener(async (changes, area) => {
	if (area !== "local" || !changes.settings) return;
	settings = { ...(await DupSettings.load()), ...pendingPatch };
	await applyTheme();
	fillForm();
	lastRenderSig = "";
	render();
});

// ------------------------------------------------------------------ ventana ajustable: recordar tamaño y posición

if (mode === "window") {
	let last = "";
	const report = () => {
		const b = { width: window.outerWidth, height: window.outerHeight, left: window.screenX, top: window.screenY };
		const sig = JSON.stringify(b);
		if (sig !== last && b.width > 200 && b.height > 200) { last = sig; send({ cmd: "bounds", bounds: b }); }
	};
	let t = null;
	window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(report, 400); });
	setInterval(report, 2000); // los movimientos de ventana no generan eventos
}

// ------------------------------------------------------------------ arranque

(async () => {
	settings = await DupSettings.load();
	await applyTheme();
	fillForm();
	const initial = (location.hash || "#lista").slice(1);
	showView(["lista", "ajustes", "ayuda"].includes(initial) ? initial : "lista");
	let windowId = null;
	try { windowId = (await browser.windows.getCurrent()).id; } catch { /* panel lateral */ }
	send({ cmd: "hello", sidebar: mode === "sidebar", windowId: mode === "window" ? windowId : null });
})();
