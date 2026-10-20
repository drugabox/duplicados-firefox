/* Ventanita del icono (y ventana grande): lista directa de duplicados, como la original. */
"use strict";

const $ = (s) => document.querySelector(s);

const mode = new URLSearchParams(location.search).get("mode") === "window" ? "window" : "popup";
document.documentElement.dataset.mode = mode;

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

const go = (tabId) => { send({ cmd: "activate", tabId }); if (mode === "popup") setTimeout(() => window.close(), 60); };

const renderGroup = (g) => {
	const rows = g.tabs.map(t => {
		const extra = g.level === "seguro" && t.id !== g.keepId && !t.pinned;
		const cls = ["row", extra ? "extra" : "", t.active ? "active" : "", t.id === newTabId ? "new" : ""].filter(Boolean).join(" ");
		return h("div", { class: cls, tabindex: "0", "data-tab": t.id, "data-group": g.id, title: t.url, onclick: () => go(t.id) },
			favicon(t),
			h("span", { class: "title" }, t.title || t.url),
			t.id === newTabId ? h("span", { class: "tag new" }, "nueva") : null,
			t.pinned ? h("span", { class: "tag", title: "Fijada" }, "📌") : null,
			h("button", { class: "icon keep", title: "Conservar esta y cerrar las demás del grupo", "aria-label": "Conservar esta", onclick: (e) => { e.stopPropagation(); send({ cmd: "keepOnly", groupId: g.id, tabId: t.id }); } }, svgIcon("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z")),
			h("button", { class: "icon x", title: "Cerrar esta pestaña", "aria-label": "Cerrar", onclick: (e) => { e.stopPropagation(); send({ cmd: "close", tabIds: [t.id] }); } }, svgIcon("M6 6l12 12M18 6L6 18")));
	});
	return h("div", { class: `group ${g.level}`, "data-id": g.id }, rows);
};

const render = () => {
	if (!state) return;
	const safe = state.groups.filter(g => g.level === "seguro" && !g.ignored);
	const doubt = state.groups.filter(g => g.level === "dudoso" && !g.ignored);
	const closable = safe.reduce((n, g) => n + g.tabs.filter(t => t.id !== g.keepId && !t.pinned).length, 0);

	const count = $("#count");
	count.textContent = closable ? String(closable) : doubt.length ? "" : "0";
	count.className = "count" + (closable ? "" : " zero");
	count.title = closable ? `${closable} pestaña${closable > 1 ? "s" : ""} de sobra` : "Sin duplicados";
	$("#countDoubt").textContent = doubt.length ? doubt.length + "?" : "";
	$("#countDoubt").title = `${doubt.length} caso${doubt.length === 1 ? "" : "s"} dudoso${doubt.length === 1 ? "" : "s"}`;
	const btn = $("#closeAll");
	btn.disabled = !closable;
	btn.title = closable ? `Cerrar ${closable} duplicado${closable > 1 ? "s" : ""} (se conserva una de cada grupo)` : "No hay duplicados que cerrar";
	$("#undo").hidden = !state.undo;

	const list = $("#list");
	const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.tab : null;
	const frag = document.createDocumentFragment();
	safe.forEach(g => frag.append(renderGroup(g)));
	if (doubt.length) {
		const open = showDoubtful || !safe.length;
		frag.append(h("button", { class: "section", title: "Casi la misma página, con un matiz. Nunca se cierran solos.", onclick: () => { showDoubtful = !open; render(); } },
			h("span", { class: "dot" }), (open ? "▾ " : "▸ ") + `Dudosos (${doubt.length})`));
		if (open) doubt.forEach(g => frag.append(renderGroup(g)));
	}
	if (!safe.length && !doubt.length) frag.append(h("div", { class: "empty" }, "No hay pestañas duplicadas."));
	list.replaceChildren(frag);
	if (focused) document.querySelector(`.row[data-tab="${focused}"]`)?.focus({ preventScroll: true });
};

const applyFocus = (f) => {
	if (!f) return;
	if (f.message) { note(f.message); pendingFocus = null; return; }
	const g = state && state.groups.find(x => x.id === f.groupId);
	if (!g) { pendingFocus = (f.tries || 0) > 5 ? null : { ...f, tries: (f.tries || 0) + 1 }; return; }
	pendingFocus = null;
	newTabId = f.tabId || null;
	if (g.level === "dudoso") showDoubtful = true;
	render();
	const el = document.querySelector(`.group[data-id="${CSS.escape(g.id)}"]`);
	if (!el) return;
	el.classList.remove("flash");
	void el.offsetWidth;
	el.classList.add("flash");
	el.scrollIntoView({ block: "center" });
	(el.querySelector(`.row[data-tab="${f.tabId}"]`) || el.querySelector(".row"))?.focus({ preventScroll: true });
	note(g.level === "seguro" ? "Ya tenías esta página abierta." : "Ya tenías abierta una página muy parecida.");
};

let noteTimer = null;
const note = (text) => {
	const n = $("#note");
	n.textContent = text;
	n.hidden = false;
	clearTimeout(noteTimer);
	noteTimer = setTimeout(() => { n.hidden = true; }, 10000);
};

$("#closeAll").addEventListener("click", () => send({ cmd: "closeAllSafe" }));
$("#undo").addEventListener("click", () => send({ cmd: "undo" }));
$("#openWindow").addEventListener("click", () => { send({ cmd: "openWindow" }); setTimeout(() => window.close(), 60); });
$("#openTab").addEventListener("click", () => { send({ cmd: "openPage" }); if (mode === "popup") setTimeout(() => window.close(), 60); });
$("#openSettings").addEventListener("click", () => { send({ cmd: "openPage", view: "ajustes" }); if (mode === "popup") setTimeout(() => window.close(), 60); });

document.addEventListener("keydown", (e) => {
	const rows = [...document.querySelectorAll(".row")];
	const i = rows.indexOf(document.activeElement);
	if (e.key === "ArrowDown") { e.preventDefault(); (rows[i + 1] || rows[0])?.focus(); }
	else if (e.key === "ArrowUp") { e.preventDefault(); (rows[i - 1] || rows[rows.length - 1])?.focus(); }
	else if (i >= 0 && e.key === "Enter") go(Number(rows[i].dataset.tab));
	else if (i >= 0 && (e.key === "Delete" || e.key === "Backspace")) { send({ cmd: "close", tabIds: [Number(rows[i].dataset.tab)] }); (rows[i + 1] || rows[i - 1])?.focus(); }
	else if (i >= 0 && e.key.toLowerCase() === "k") send({ cmd: "keepOnly", groupId: rows[i].dataset.group, tabId: Number(rows[i].dataset.tab) });
});

// ------------------------------------------------------------------ tamaño

const applySize = () => {
	if (mode !== "popup") return;
	document.body.style.setProperty("--w", settings.popupWidth + "px");
	document.body.style.setProperty("--h", settings.popupHeight + "px");
};

// Ventanita: asa inferior = alto; esquina = alto y ancho (límite de Firefox: 800 × 600).
const grip = $("#grip");
grip.addEventListener("pointerdown", (e) => {
	e.preventDefault();
	grip.setPointerCapture(e.pointerId);
	grip.classList.add("drag");
	const corner = e.offsetX > grip.clientWidth - 18;
	const start = { x: e.screenX, y: e.screenY, w: settings.popupWidth, h: settings.popupHeight };
	const { POPUP_MIN: lo, POPUP_MAX: hi } = DupSettings;
	const move = (ev) => {
		settings.popupHeight = Math.max(lo.height, Math.min(hi.height, start.h + ev.screenY - start.y));
		if (corner) settings.popupWidth = Math.max(lo.width, Math.min(hi.width, start.w + ev.screenX - start.x));
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
grip.addEventListener("dblclick", () => {
	const { popupWidth, popupHeight } = DupSettings.DEFAULTS;
	Object.assign(settings, { popupWidth, popupHeight });
	applySize();
	DupSettings.save({ popupWidth, popupHeight });
});

// Ventana grande: recordar tamaño y posición.
if (mode === "window") {
	let last = "";
	const report = () => {
		const b = { width: window.outerWidth, height: window.outerHeight, left: window.screenX, top: window.screenY };
		const sig = JSON.stringify(b);
		if (sig !== last && b.width > 200 && b.height > 200) { last = sig; send({ cmd: "bounds", bounds: b }); }
	};
	let t = null;
	window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(report, 400); });
	setInterval(report, 2000); // mover la ventana no genera eventos
}

// ------------------------------------------------------------------ arranque

(async () => {
	settings = await DupSettings.load();
	applySize();
	await DupTheme.apply(settings, { fontSize: settings.popupFontSize });
	let windowId = null;
	try { windowId = (await browser.windows.getCurrent()).id; } catch { /* sin ventana */ }
	send({ cmd: "hello", kind: mode, windowId: mode === "window" ? windowId : null });
})();
