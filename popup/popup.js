/* Ventanita del icono: lista directa de duplicados. */
"use strict";

const $ = (s) => document.querySelector(s);

let settings = { ...DupSettings.DEFAULTS };
let state = null;
let showDoubtful = false;
let newTabId = null;
let pendingFocus = null;

const h = (tag, attrs = {}, ...children) => {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === null || v === undefined || v === false) continue;
		if (k === "class") el.className = v;
		else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v);
	}
	for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	return el;
};
const svgIcon = (d) => {
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	const p = document.createElementNS(ns, "path");
	p.setAttribute("d", d);
	svg.append(p);
	return svg;
};

const port = browser.runtime.connect({ name: "panel" });
const send = (m) => port.postMessage(m);
port.onMessage.addListener((msg) => {
	if (msg.type === "state") { state = msg.state; render(); if (pendingFocus) applyFocus(pendingFocus); }
	else if (msg.type === "focus") applyFocus(msg.focus);
});

// ------------------------------------------------------------------ lista

const safeDecode = (s) => { try { return decodeURI(s); } catch { return s; } };

// Trozos de la dirección para mostrar solo lo que cambia entre pestañas del grupo.
const tokens = (url) => {
	try {
		const u = new URL(url);
		const t = [u.host, safeDecode(u.pathname)];
		for (const [k, v] of u.searchParams) t.push(k + (v ? "=" + v : ""));
		if (u.hash) t.push(safeDecode(u.hash));
		return t;
	} catch { return [url]; }
};
const diffText = (tab, group) => {
	if (group.identical) return "";
	const others = group.tabs.filter(t => t.id !== tab.id).map(t => new Set(tokens(t.url)));
	const mine = tokens(tab.url).filter(tk => others.some(o => !o.has(tk)));
	return mine.length ? mine.join("  ") : "";
};

const letter = (url) => {
	let ch = "?";
	try { ch = new URL(url).hostname.replace(/^www\./, "").charAt(0).toUpperCase() || "?"; } catch { /* interna */ }
	return h("span", { class: "fav letter", "aria-hidden": "true" }, ch);
};
const favicon = (t) => {
	if (!settings.showFavicons) return null;
	if (!t.favIconUrl || t.favIconUrl.startsWith("chrome:")) return letter(t.url);
	const img = h("img", { class: "fav", src: t.favIconUrl, alt: "" });
	img.addEventListener("error", () => img.replaceWith(letter(t.url)), { once: true });
	return img;
};

const go = (tabId) => { send({ cmd: "activate", tabId }); setTimeout(() => window.close(), 60); };

const renderGroup = (g, wins) => {
	let host = "";
	try { host = new URL(g.tabs[0].url).hostname.replace(/^www\./, ""); } catch { /* interna */ }
	const label = (g.what ? g.what + " · " : "") + (host || g.site);
	const head = h("div", { class: "ghead" },
		h("span", { class: "dot", title: g.level === "seguro" ? "Duplicado" : "Dudoso" }),
		h("span", { class: "gname", title: g.title + (g.details.length ? ": " + g.details.join(" ") : "") }, label),
		g.level === "seguro" ? h("button", { class: "link", title: "Cerrar todas menos la marcada con ★", onclick: () => send({ cmd: "closeGroup", groupId: g.id }) }, "Cerrar sobrantes") : null);

	const rows = g.tabs.map(t => {
		const diff = diffText(t, g);
		const tags = [];
		if (t.id === newTabId) tags.push(h("span", { class: "tag new" }, "nueva"));
		if (g.level === "seguro" && t.id === g.keepId) tags.push(h("span", { class: "tag keep", title: "Se conserva al cerrar sobrantes" }, "★"));
		if (t.pinned) tags.push(h("span", { class: "tag", title: "Fijada" }, "📌"));
		// Ventana y contenedor solo si ayudan a distinguir las pestañas del grupo.
		if (new Set(g.tabs.map(x => x.windowId)).size > 1) tags.push(h("span", { class: "tag", title: "Ventana " + wins.get(t.windowId) }, "V" + wins.get(t.windowId)));
		const c = state.containers && state.containers[t.cookieStoreId];
		if (c && new Set(g.tabs.map(x => x.cookieStoreId)).size > 1) tags.push(h("span", { class: "tag", style: `color:${c.color}` }, c.name));
		return h("div", { class: "row" + (t.id === newTabId ? " new" : ""), tabindex: "0", "data-tab": t.id, title: t.url, onclick: () => go(t.id) },
			favicon(t),
			h("div", { class: "txt" }, h("div", { class: "title" }, t.title || t.url), diff ? h("div", { class: "diff" }, diff) : null),
			tags,
			h("button", { class: "icon x", title: "Cerrar esta pestaña", "aria-label": "Cerrar", onclick: (e) => { e.stopPropagation(); send({ cmd: "close", tabIds: [t.id] }); } }, svgIcon("M6 6l12 12M18 6L6 18")));
	});
	return h("div", { class: `group ${g.level}`, "data-id": g.id }, head, rows);
};

const render = () => {
	if (!state) return;
	const safe = state.groups.filter(g => g.level === "seguro" && !g.ignored);
	const doubt = state.groups.filter(g => g.level === "dudoso" && !g.ignored);
	const { extra } = state.stats;

	$("#summary").textContent = extra ? `· ${extra} sobra${extra > 1 ? "n" : ""}` : doubt.length ? "· solo dudosos" : "· sin duplicados";
	const closable = safe.reduce((n, g) => n + g.tabs.filter(t => t.id !== g.keepId && !t.pinned).length, 0);
	const btn = $("#closeAll");
	btn.disabled = !closable;
	btn.textContent = closable ? `Cerrar ${closable} duplicado${closable > 1 ? "s" : ""}` : "No hay duplicados que cerrar";
	$("#undo").hidden = !state.undo;

	const ids = [...new Set(state.groups.flatMap(g => g.tabs.map(t => t.windowId)))].sort((a, b) => a - b);
	const wins = new Map(ids.map((id, i) => [id, i + 1]));
	const list = $("#list");
	const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.tab : null;
	const frag = document.createDocumentFragment();

	safe.forEach(g => frag.append(renderGroup(g, wins)));
	if (doubt.length) {
		const open = showDoubtful || !safe.length;
		frag.append(h("button", { class: "more", onclick: () => { showDoubtful = !open; render(); } },
			(open ? "▾ " : "▸ ") + `Dudosos (${doubt.length})`, h("span", { style: "flex:1" }), open ? "" : "revísalos tú"));
		if (open) doubt.forEach(g => frag.append(renderGroup(g, wins)));
	}
	if (!safe.length && !doubt.length) frag.append(h("div", { class: "empty" }, "No hay pestañas duplicadas."));
	list.replaceChildren(frag);
	if (focused) document.querySelector(`.row[data-tab="${focused}"]`)?.focus({ preventScroll: true });
};

const applyFocus = (f) => {
	if (!f) return;
	if (f.message) { note(f.message); pendingFocus = null; return; }
	const g = state && state.groups.find(x => x.id === f.groupId);
	if (!g) { pendingFocus = (f.tries || 0) > 3 ? null : { ...f, tries: (f.tries || 0) + 1 }; return; }
	pendingFocus = null;
	newTabId = f.tabId || null;
	if (g.level === "dudoso") showDoubtful = true;
	render();
	const el = document.querySelector(`.group[data-id="${CSS.escape(g.id)}"]`);
	if (!el) return;
	el.classList.add("flash");
	el.scrollIntoView({ block: "nearest" });
	(el.querySelector(`.row[data-tab="${f.tabId}"]`) || el.querySelector(".row"))?.focus({ preventScroll: true });
	note(g.level === "seguro" ? "Ya tenías esta página abierta." : "Ya tenías abierta una página muy parecida.");
};

const note = (text) => { const n = $("#note"); n.textContent = text; n.hidden = false; };

$("#closeAll").addEventListener("click", () => send({ cmd: "closeAllSafe" }));
$("#undo").addEventListener("click", () => send({ cmd: "undo" }));
$("#openTab").addEventListener("click", () => { send({ cmd: "openPage" }); setTimeout(() => window.close(), 60); });
$("#openSettings").addEventListener("click", () => { send({ cmd: "openPage", view: "ajustes" }); setTimeout(() => window.close(), 60); });
$("#onDuplicate").addEventListener("change", (e) => DupSettings.save({ onDuplicate: e.target.value }));

document.addEventListener("keydown", (e) => {
	const rows = [...document.querySelectorAll(".row")];
	const i = rows.indexOf(document.activeElement);
	if (e.key === "ArrowDown") { e.preventDefault(); (rows[i + 1] || rows[0])?.focus(); }
	else if (e.key === "ArrowUp") { e.preventDefault(); (rows[i - 1] || rows[rows.length - 1])?.focus(); }
	else if (i >= 0 && e.key === "Enter") go(Number(rows[i].dataset.tab));
	else if (i >= 0 && (e.key === "Delete" || e.key === "Backspace")) { send({ cmd: "close", tabIds: [Number(rows[i].dataset.tab)] }); (rows[i + 1] || rows[i - 1])?.focus(); }
});

// ------------------------------------------------------------------ tamaño (asa inferior: alto; esquina: alto y ancho)

const applySize = () => {
	document.body.style.setProperty("--w", settings.popupWidth + "px");
	document.body.style.setProperty("--h", settings.popupHeight + "px");
};
const grip = $("#grip");
grip.addEventListener("pointerdown", (e) => {
	e.preventDefault();
	grip.setPointerCapture(e.pointerId);
	grip.classList.add("drag");
	const corner = e.offsetX > grip.clientWidth - 18;
	const start = { x: e.screenX, y: e.screenY, w: settings.popupWidth, h: settings.popupHeight };
	const move = (ev) => {
		settings.popupHeight = Math.max(120, Math.min(540, start.h + ev.screenY - start.y));
		if (corner) settings.popupWidth = Math.max(300, Math.min(780, start.w + ev.screenX - start.x));
		applySize();
	};
	const up = () => {
		grip.classList.remove("drag");
		grip.removeEventListener("pointermove", move);
		DupSettings.save({ popupWidth: settings.popupWidth, popupHeight: settings.popupHeight });
	};
	grip.addEventListener("pointermove", move);
	grip.addEventListener("pointerup", up, { once: true });
});
grip.addEventListener("dblclick", () => { settings.popupHeight = 420; settings.popupWidth = 380; applySize(); DupSettings.save({ popupWidth: 380, popupHeight: 420 }); });

// ------------------------------------------------------------------ arranque

(async () => {
	settings = await DupSettings.load();
	applySize();
	await DupTheme.apply(settings, { fontSize: settings.popupFontSize });
	$("#onDuplicate").value = settings.onDuplicate;
	send({ cmd: "hello", kind: "popup" });
})();
