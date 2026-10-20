/* Proceso de fondo: vigila las pestañas, agrupa duplicados y avisa. */
"use strict";

const { analyze, explain } = DupNormalize;
const OWN_URL = browser.runtime.getURL("");

let settings = { ...DupSettings.DEFAULTS };
let exclusions = [];

const ports = new Set();            // paneles abiertos (ventana y/o lateral)
let panelWindowId = null;           // ventana ajustable del panel
let pendingFocus = null;            // pareja a mostrar cuando el panel se conecte
let state = { groups: [], stats: { safe: 0, doubtful: 0, extra: 0, tabs: 0 }, undo: 0 };

const ignoredTabs = new Set();      // "no es duplicada" para una pestaña concreta
const ignoredGroups = new Set();    // "mantener ambas" para una página en esta sesión
const intentional = new Set();      // abiertas a propósito desde la misma página (Duplicar pestaña...)
const pendingChecks = new Map();    // tabId → momento en que cambió su dirección
const lastKey = new Map();          // tabId → huella estricta anterior
let undoStack = [];                 // última tanda de pestañas cerradas
let quietUntil = Date.now() + 5000; // sin avisos durante el arranque (restauración de sesión)
let createdBurst = [];

// ------------------------------------------------------------------ análisis

let profile = DupNormalize.compile(DupSettings.profileOf(settings));

const cache = new Map();
const analyzeCached = (url, prof = profile) => {
	const k = prof.sig + "\n" + url;
	let a = cache.get(k);
	if (!a) {
		if (cache.size > 8000) cache.clear();
		a = analyze(url, prof);
		cache.set(k, a);
	}
	return a;
};

const scopeOf = (tab) => {
	let s = tab.incognito ? "privada" : "normal";
	if (settings.separateContainers && tab.cookieStoreId) s += "|" + tab.cookieStoreId;
	if (settings.scope === "window") s += "|w" + tab.windowId;
	return s;
};

const isTrackable = (tab) => tab.url && !tab.url.startsWith(OWN_URL) && !(tab.hidden && !settings.includeHidden) && !exclusions.some(fn => fn(tab.url));

const tabInfo = (t) => ({
	id: t.id, windowId: t.windowId, index: t.index, title: t.title || t.url, url: t.url,
	favIconUrl: t.favIconUrl || "", pinned: t.pinned, active: t.active, discarded: !!t.discarded,
	cookieStoreId: t.cookieStoreId, incognito: t.incognito, lastAccessed: t.lastAccessed || 0,
	status: t.status, intentional: intentional.has(t.id), audible: !!t.audible, hidden: !!t.hidden
});

// Cuál conservar: siempre la fijada; luego, según tus prioridades.
let focusedWindowId = null;
const chooseKeep = (tabs) => {
	const score = (t) => {
		if (settings.keepPolicy === "newest") return t.id;
		if (settings.keepPolicy === "recent") return t.lastAccessed;
		return -t.id; // las pestañas más antiguas tienen identificador menor
	};
	const https = (t) => (settings.keepHttps && t.url.startsWith("https:") ? 1 : 0);
	const active = (t) => (settings.keepActive && t.active ? 1 : 0);
	const win = (t) => (settings.preferActiveWindow && t.windowId === focusedWindowId ? 1 : 0);
	return tabs.slice().sort((a, b) => (b.pinned - a.pinned) || (active(b) - active(a)) || (win(b) - win(a)) || (https(b) - https(a)) || (score(b) - score(a)))[0].id;
};

// Explica un grupo comparando la primera dirección con las demás.
const explainGroup = (tabs, joinedBy, profile) => {
	const details = new Set(), codes = new Set();
	const urls = [...new Set(tabs.map(t => t.url))];
	if (urls.length === 1) return { title: "Direcciones idénticas", details: ["Las pestañas tienen exactamente la misma dirección."], codes: ["identical"] };
	let urlJoined = true;
	for (let i = 1; i < urls.length; i++) {
		const e = explain(urls[0], urls[i], profile);
		if (e.level === "seguro" || e.level === "exacto" || joinedBy === "loose") {
			e.details.forEach(d => details.add(d));
			e.codes.forEach(c => codes.add(c));
		} else urlJoined = false;
	}
	let title = joinedBy === "loose" ? "Dudoso: casi la misma página" : "Misma página";
	if (!urlJoined) {
		const regexJoined = joinedBy === "titleRegex";
		const similar = profile.titleMode === "similar" && profile.titleThreshold < 100;
		codes.add(regexJoined ? "custom" : similar ? "titleSimilar" : "title");
		details.add(regexJoined ? "Sus títulos encajan en una de tus reglas de títulos." : similar ? `Sus títulos se parecen al menos un ${profile.titleThreshold} % (ajuste «comparar títulos»).` : `Tienen el mismo título: «${tabs[0].title}» (ajuste «comparar títulos»).`);
		title = regexJoined ? "Regla de títulos" : similar ? "Título parecido" : "Mismo título";
	}
	return { title, details: [...details], codes: [...codes] };
};

let containers = {};
const loadContainers = async () => {
	try {
		const list = await browser.contextualIdentities.query({});
		containers = Object.fromEntries(list.map(c => [c.cookieStoreId, { name: c.name, color: c.colorCode }]));
	} catch { containers = {}; }
};

// Agrupa las pestañas según un perfil de detección.
const buildGroups = (all, profile) => {
	const items = [];
	for (const t of all) {
		if (!isTrackable(t) || ignoredTabs.has(t.id)) continue;
		const a = analyzeCached(t.url, profile);
		if (!a.ok) continue;
		const info = tabInfo(t);
		info.strict = a.strict;
		items.push({ info, a, scope: scopeOf(t), title: DupNormalize.normTitle(t.title) });
	}

	// Unión de pestañas: misma huella (y, si lo pides, mismo título o título parecido).
	const parent = items.map((_, i) => i);
	const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
	const join = new Map(); // raíz → cómo se unió
	const union = (i, j, how) => { const a = find(i), b = find(j); if (a !== b) { parent[b] = a; if (how !== "url") join.set(a, how); } };
	const byKey = (keyOf, how) => {
		const seen = new Map();
		items.forEach((it, i) => {
			const k = keyOf(it);
			if (k === null) return;
			if (seen.has(k)) union(seen.get(k), i, how); else seen.set(k, i);
		});
	};
	// El título nunca se usa en páginas internas ni de otras extensiones (grupos de Sidebery, Tree Style Tab...):
	// dos grupos pueden llamarse igual y ser distintos.
	const usableTitle = (it) => it.title && it.title !== it.info.url.toLowerCase() && it.info.status !== "loading" && /^(https?|file):/i.test(it.info.url);
	const tm = profile.titleMode;
	byKey(it => it.scope + "§" + it.a.strict + (tm === "and" ? "§" + (usableTitle(it) ? it.title : it.info.id) : ""), "url");
	if (tm === "or" || (tm === "similar" && profile.titleThreshold >= 100)) byKey(it => (usableTitle(it) ? it.scope + "§" + it.title : null), "title");
	else if (tm === "similar") {
		const buckets = new Map();
		items.forEach((it, i) => { if (usableTitle(it)) { if (!buckets.has(it.scope)) buckets.set(it.scope, []); buckets.get(it.scope).push(i); } });
		const th = profile.titleThreshold;
		for (const list of buckets.values()) {
			for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
				const A = items[list[x]].title, B = items[list[y]].title;
				const maxLen = Math.max(A.length, B.length);
				if (Math.abs(A.length - B.length) > maxLen * (100 - th) / 100) continue;
				if (DupNormalize.titleSimilarity(A, B) >= th) union(list[x], list[y], "title");
			}
		}
	}
	profile.titleRegex.forEach((re, r) => byKey(it => (usableTitle(it) && re.test(it.info.title) ? it.scope + "§tre" + r : null), "titleRegex"));

	const roots = new Map();
	items.forEach((it, i) => { const r = find(i); if (!roots.has(r)) roots.set(r, []); roots.get(r).push(it); });

	const groups = [];
	const reasons = {};
	let extra = 0, doubtful = 0;
	for (const [r, list] of roots) {
		if (list.length < 2) continue;
		const tabs = list.map(x => x.info);
		const id = "s§" + list[0].scope + "§" + list[0].a.strict;
		const exp = explainGroup(tabs, join.get(r) || "url", profile);
		const ignored = ignoredGroups.has(id);
		if (!ignored) { extra += tabs.length - 1; exp.codes.forEach(c => { reasons[c] = (reasons[c] || 0) + 1; }); }
		groups.push({
			id, level: "seguro", identical: exp.codes.length === 1 && exp.codes[0] === "identical", ignored,
			site: list[0].a.site, what: list[0].a.what, key: list[0].a.strict, codes: exp.codes,
			keepId: chooseKeep(tabs), tabs, title: exp.title, details: exp.details
		});
	}
	if (profile.showDoubtful) {
		const looseMap = new Map();
		for (const it of items) {
			const lk = it.scope + "§" + it.a.loose;
			if (!looseMap.has(lk)) looseMap.set(lk, { a: it.a, tabs: [], stricts: new Set() });
			const l = looseMap.get(lk);
			l.tabs.push(it.info);
			l.stricts.add(it.a.strict);
		}
		for (const [lk, g] of looseMap) {
			if (g.stricts.size < 2) continue;
			const id = "d§" + lk;
			const exp = explainGroup(g.tabs, "loose", profile);
			const ignored = ignoredGroups.has(id);
			if (!ignored) doubtful++;
			groups.push({
				id, level: "dudoso", ignored, site: g.a.site, what: g.a.what, key: g.a.loose, codes: exp.codes,
				keepId: chooseKeep(g.tabs), tabs: g.tabs, title: exp.title, details: exp.details
			});
		}
	}
	return { groups, reasons, extra, doubtful, tracked: items.length };
};

const compute = async () => {
	const [all, fw] = await Promise.all([browser.tabs.query({}), browser.windows.getLastFocused().catch(() => null)]);
	focusedWindowId = fw ? fw.id : null;
	const { groups, reasons, extra, doubtful, tracked } = buildGroups(all, profile);
	const safe = groups.filter(g => g.level === "seguro" && !g.ignored).length;
	state = {
		groups, reasons, preset: settings.preset,
		stats: { safe, doubtful, extra, tabs: tracked, total: all.length },
		undo: undoStack.length, containers, ignoredTabs: ignoredTabs.size
	};
	updateBadge();
	broadcast({ type: "state", state });
	handlePendingChecks(all);
};

let computeTimer = null;
const scheduleCompute = (delay = 120) => {
	clearTimeout(computeTimer);
	computeTimer = setTimeout(() => compute().catch(console.error), delay);
};

// ------------------------------------------------------------------ insignia

const updateBadge = () => {
	const { extra, doubtful } = state.stats;
	let text = "", color = settings.badgeColor;
	if (extra > 0) text = String(extra);
	else if (doubtful > 0 && settings.badgeDoubtful) { text = "?"; color = settings.badgeDoubtColor; }
	else if (settings.showZeroBadge) { text = "0"; color = settings.badgeZeroColor; }
	browser.browserAction.setBadgeText({ text });
	browser.browserAction.setBadgeBackgroundColor({ color });
	if (browser.browserAction.setBadgeTextColor) browser.browserAction.setBadgeTextColor({ color: "#ffffff" });
	const parts = [];
	parts.push(extra ? `${extra} pestaña${extra > 1 ? "s" : ""} duplicada${extra > 1 ? "s" : ""}` : "Sin duplicados");
	if (doubtful) parts.push(`${doubtful} caso${doubtful > 1 ? "s" : ""} dudoso${doubtful > 1 ? "s" : ""}`);
	browser.browserAction.setTitle({ title: "Duplicados · " + parts.join(" · ") });
};

// ------------------------------------------------------------------ avisos

const handlePendingChecks = async (allTabs) => {
	if (!pendingChecks.size) return;
	const now = Date.now();
	const checks = [...pendingChecks.keys()];
	pendingChecks.clear();
	if (now < quietUntil) return;

	for (const tabId of checks) {
		const g = state.groups.find(x => x.level === "seguro" && !x.ignored && x.tabs.some(t => t.id === tabId))
			|| (settings.alertDoubtful && state.groups.find(x => x.level === "dudoso" && !x.ignored && x.tabs.some(t => t.id === tabId)));
		if (!g || intentional.has(tabId)) continue;
		const tab = g.tabs.find(t => t.id === tabId);
		const others = g.tabs.filter(t => t.id !== tabId);
		const mode = settings.onDuplicate;

		if (mode === "close" && g.level === "seguro" && !tab.pinned) {
			const keep = others.find(t => t.id === chooseKeep(others)) || others[0];
			await closeTabs([tabId], allTabs);
			try {
				await browser.tabs.update(keep.id, { active: true });
				await browser.windows.update(keep.windowId, { focused: true });
			} catch { /* ya no existe */ }
			notify(`Se cerró una pestaña duplicada`, `«${trim(tab.title, 70)}» ya estaba abierta. Pulsa aquí para deshacer o ver la lista.`, { groupId: g.id, tabId: keep.id });
		} else if (mode === "panel" || (mode === "close" && g.level === "dudoso")) {
			openPanel({ groupId: g.id, tabId });
		} else if (mode === "notify") {
			notify(g.level === "seguro" ? "Pestaña duplicada" : "Posible duplicado", `«${trim(tab.title, 70)}» ya está abierta${others.length > 1 ? ` (${others.length} veces)` : ""}. Pulsa para verla.`, { groupId: g.id, tabId });
		}
		break; // un aviso por tanda es suficiente
	}
};

const trim = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

const notifyTargets = new Map();
const notify = (title, message, focus) => {
	const id = "dup-" + Date.now();
	notifyTargets.set(id, focus);
	browser.notifications.create(id, { type: "basic", iconUrl: browser.runtime.getURL("icons/icon.svg"), title, message });
};
browser.notifications.onClicked.addListener((id) => {
	openPanel(notifyTargets.get(id));
	notifyTargets.delete(id);
	browser.notifications.clear(id);
});

// ------------------------------------------------------------------ panel

const broadcast = (msg) => { for (const p of ports) { try { p.postMessage(msg); } catch { /* cerrado */ } } };

const POPUP_URL = "popup/popup.html";
const PAGE_URL = browser.runtime.getURL("panel/panel.html");

// Avisar de un duplicado: se abre la ventanita del icono (Firefox 149+ lo permite sin pulsar nada).
// Si ya está abierta (o el panel lateral), solo salta a la pareja. Si no se puede, ventana aparte.
const openPanel = async (focus) => {
	if (focus) pendingFocus = focus;
	const shown = [...ports].find(p => p.kind === "popup") || [...ports].find(p => p.kind === "sidebar" || p.kind === "window");
	if (shown) {
		if (pendingFocus) { shown.postMessage({ type: "focus", focus: pendingFocus }); pendingFocus = null; }
		if (shown.kind === "window" && panelWindowId !== null) browser.windows.update(panelWindowId, { focused: true }).catch(() => {});
		return;
	}
	// Si prefieres la ventana grande, el aviso también la usa.
	if (settings.clickAction === "window") { await openWindow(); return; }
	// Firefox no siempre deja abrir la ventanita sin que pulses el icono (según versión y ajustes,
	// o si el botón está en el menú de desbordamiento). A veces ni siquiera da error: por eso se
	// comprueba que de verdad se ha abierto y, si no, se abre la ventana grande.
	try {
		if (settings.clickAction !== "popup") await browser.browserAction.setPopup({ popup: POPUP_URL });
		await browser.browserAction.openPopup();
		if (await waitForPort("popup", 1500)) return;
	} catch {
		/* no se puede: ventana grande */
	} finally {
		if (settings.clickAction !== "popup") setTimeout(() => browser.browserAction.setPopup({ popup: "" }), 1500);
	}
	await openWindow();
};

const waitForPort = (kind, ms) => new Promise((resolve) => {
	const start = Date.now();
	const tick = () => {
		if ([...ports].some(p => p.kind === kind)) resolve(true);
		else if (Date.now() - start > ms) resolve(false);
		else setTimeout(tick, 50);
	};
	tick();
});

const openWindow = async () => {
	if (panelWindowId !== null) {
		try {
			const w = await browser.windows.get(panelWindowId);
			await browser.windows.update(panelWindowId, w.state === "minimized" ? { focused: true, state: "normal" } : { focused: true });
			const port = [...ports].find(p => p.kind === "window");
			if (port && pendingFocus) { port.postMessage({ type: "focus", focus: pendingFocus }); pendingFocus = null; }
			return;
		} catch { panelWindowId = null; }
	}
	const { panelBounds } = await browser.storage.local.get("panelBounds");
	const b = panelBounds || { width: 460, height: 760 };
	const opts = { type: "popup", url: browser.runtime.getURL(POPUP_URL) + "?mode=window", width: b.width, height: b.height };
	if (Number.isFinite(b.left) && Number.isFinite(b.top)) { opts.left = b.left; opts.top = b.top; }
	const w = await browser.windows.create(opts);
	panelWindowId = w.id;
};

// Página completa en su propia pestaña (lista detallada, ajustes y ayuda).
const openPage = async (view) => {
	const existing = (await browser.tabs.query({})).find(t => t.url && t.url.startsWith(PAGE_URL) && !t.url.includes("mode=window") && !t.url.includes("mode=sidebar"));
	const url = PAGE_URL + "?mode=tab#" + (view || "lista");
	if (existing) {
		await browser.tabs.update(existing.id, view ? { active: true, url } : { active: true });
		await browser.windows.update(existing.windowId, { focused: true });
	} else {
		await browser.tabs.create({ url });
	}
};

const applyClickAction = () => browser.browserAction.setPopup({ popup: settings.clickAction === "popup" ? POPUP_URL : "" });

browser.windows.onRemoved.addListener((id) => { if (id === panelWindowId) panelWindowId = null; });

browser.runtime.onConnect.addListener((port) => {
	if (port.name !== "panel") return;
	ports.add(port);
	port.onDisconnect.addListener(() => ports.delete(port));
	port.onMessage.addListener((msg) => handlePanelMessage(port, msg));
});

const handlePanelMessage = async (port, msg) => {
	switch (msg.cmd) {
		case "hello":
			port.kind = msg.kind || "page";
			if (port.kind === "window" && msg.windowId) panelWindowId = msg.windowId;
			port.postMessage({ type: "state", state });
			if (pendingFocus) { port.postMessage({ type: "focus", focus: pendingFocus }); pendingFocus = null; }
			break;
		case "openPage":
			openPage(msg.view);
			break;
		case "openWindow":
			openWindow();
			break;
		case "compare": {
			// Cuántas pestañas sobrarían con cada modo, sobre tus pestañas de ahora.
			const all = await browser.tabs.query({});
			const out = {};
			for (const preset of ["inequivoco", "original", "personalizado"]) {
				const r = buildGroups(all, DupNormalize.compile(DupSettings.profileOf({ ...settings, preset })));
				out[preset] = { extra: r.extra, doubtful: r.doubtful, groups: r.groups.filter(g => g.level === "seguro").length };
			}
			port.postMessage({ type: "compare", result: out });
			break;
		}
		case "bounds":
			browser.storage.local.set({ panelBounds: msg.bounds });
			break;
		case "activate":
			try {
				const t = await browser.tabs.update(msg.tabId, { active: true });
				await browser.windows.update(t.windowId, { focused: true });
			} catch { /* cerrada */ }
			break;
		case "close":
			await closeTabs(msg.tabIds);
			break;
		case "keepOnly": {
			const g = state.groups.find(x => x.id === msg.groupId);
			if (g) await closeTabs(g.tabs.filter(t => t.id !== msg.tabId).map(t => t.id));
			break;
		}
		case "closeGroup": {
			const g = state.groups.find(x => x.id === msg.groupId);
			if (g) await closeTabs(g.tabs.filter(t => t.id !== g.keepId).map(t => t.id));
			break;
		}
		case "closeAllSafe":
			await closeAllSafe();
			break;
		case "ignoreGroup":
			ignoredGroups.add(msg.groupId); scheduleCompute(0);
			break;
		case "unignoreGroup":
			ignoredGroups.delete(msg.groupId); scheduleCompute(0);
			break;
		case "ignoreTab":
			ignoredTabs.add(msg.tabId); scheduleCompute(0);
			break;
		case "unignoreAll":
			ignoredTabs.clear(); ignoredGroups.clear(); scheduleCompute(0);
			break;
		case "undo":
			await undo();
			break;
		case "refresh":
			cache.clear(); scheduleCompute(0);
			break;
	}
};

// ------------------------------------------------------------------ cerrar / deshacer

const closeTabs = async (ids, allTabs) => {
	if (!ids.length) return;
	const tabs = allTabs || await browser.tabs.query({});
	const snap = tabs.filter(t => ids.includes(t.id)).map(t => ({
		url: t.url, title: t.title, windowId: t.windowId, index: t.index, pinned: t.pinned, cookieStoreId: t.cookieStoreId
	}));
	undoStack = snap;
	try { await browser.tabs.remove(ids); } catch (e) { console.warn(e); }
	scheduleCompute(0);
};

const closeAllSafe = async () => {
	const ids = [];
	for (const g of state.groups) {
		if (g.level !== "seguro" || g.ignored) continue;
		for (const t of g.tabs) if (t.id !== g.keepId && !t.pinned) ids.push(t.id);
	}
	await closeTabs([...new Set(ids)]);
};

const undo = async () => {
	const batch = undoStack;
	undoStack = [];
	if (!batch.length) return;
	// Lo que se reabre al deshacer no debe volver a avisar ni cerrarse solo.
	quietUntil = Math.max(quietUntil, Date.now() + 2000);
	let recent = [];
	try { recent = await browser.sessions.getRecentlyClosed({ maxResults: 25 }); } catch { /* sin permiso */ }
	for (const s of batch) {
		const i = recent.findIndex(r => r.tab && r.tab.url === s.url);
		if (i >= 0) {
			const [r] = recent.splice(i, 1);
			try {
				const restored = await browser.sessions.restore(r.tab.sessionId);
				if (restored && restored.tab) intentional.add(restored.tab.id);
				continue;
			} catch { /* reabrir a mano */ }
		}
		const opts = { url: s.url, windowId: s.windowId, index: s.index, pinned: s.pinned, active: false };
		if (s.cookieStoreId && s.cookieStoreId !== "firefox-default" && s.cookieStoreId !== "firefox-private") opts.cookieStoreId = s.cookieStoreId;
		try {
			let t;
			try { t = await browser.tabs.create(opts); } catch { t = await browser.tabs.create({ url: s.url, active: false }); }
			intentional.add(t.id);
		} catch { /* url no permitida */ }
	}
	scheduleCompute(0);
};

// ------------------------------------------------------------------ eventos de pestañas

const markChanged = (tab) => {
	if (!tab.url || !isTrackable(tab)) return;
	const a = analyzeCached(tab.url);
	if (!a.ok) return;
	const key = scopeOf(tab) + "§" + a.strict;
	if (lastKey.get(tab.id) === key) return;
	lastKey.set(tab.id, key);
	pendingChecks.set(tab.id, Date.now());
};

// ¿Se abrió desde una pestaña con la misma página? Entonces es a propósito (Duplicar pestaña, etc.).
const openerChecked = new Set();
const checkOpener = async (tab) => {
	if (tab.openerTabId == null || openerChecked.has(tab.id) || !tab.url || !analyzeCached(tab.url).ok) return;
	openerChecked.add(tab.id);
	try {
		const opener = await browser.tabs.get(tab.openerTabId);
		const a = analyzeCached(tab.url), b = analyzeCached(opener.url);
		if (a.ok && b.ok && a.strict === b.strict) intentional.add(tab.id);
	} catch { /* la de origen ya no existe */ }
};

browser.tabs.onCreated.addListener(async (tab) => {
	const now = Date.now();
	createdBurst = createdBurst.filter(t => now - t < 1500);
	createdBurst.push(now);
	// Muchas pestañas a la vez = restaurar sesión o abrir un grupo de marcadores: no avisar.
	if (createdBurst.length > 4) quietUntil = Math.max(quietUntil, now + 2500);
	await checkOpener(tab);
	markChanged(tab);
	scheduleCompute();
});

browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
	if (change.url) {
		await checkOpener(tab);
		markChanged(tab);
		scheduleCompute();
	} else if (change.title || change.favIconUrl || change.pinned !== undefined || change.discarded !== undefined || change.status === "complete") {
		scheduleCompute(250);
	}
});

browser.tabs.onRemoved.addListener((tabId) => {
	lastKey.delete(tabId); openerChecked.delete(tabId); ignoredTabs.delete(tabId); intentional.delete(tabId); pendingChecks.delete(tabId);
	scheduleCompute();
});
browser.tabs.onAttached.addListener(() => scheduleCompute());
browser.tabs.onActivated.addListener(() => scheduleCompute(300));

// ------------------------------------------------------------------ icono, atajos y menús

// Solo se usa si el icono no abre la ventanita (ajuste «Al pulsar el icono»).
browser.browserAction.onClicked.addListener(() => {
	if (settings.clickAction === "sidebar") browser.sidebarAction.toggle();
	else if (settings.clickAction === "window") openWindow();
	else openPage();
});

browser.commands.onCommand.addListener((cmd) => {
	if (cmd === "open-page") openPage();
	else if (cmd === "open-window") openWindow();
	else if (cmd === "close-safe") closeAllSafe();
});

const setupMenus = () => {
	browser.menus.removeAll();
	browser.menus.create({ id: "show", title: "Ver duplicados de esta pestaña", contexts: ["tab"] });
	browser.menus.create({ id: "ignore", title: "No es duplicada: ignorar esta pestaña", contexts: ["tab"] });
	browser.menus.create({ id: "close-safe", title: "Cerrar todos los duplicados seguros", contexts: ["browser_action"] });
	browser.menus.create({ id: "window", title: "Abrir en ventana grande", contexts: ["browser_action"] });
	browser.menus.create({ id: "page", title: "Abrir en una pestaña", contexts: ["browser_action"] });
	browser.menus.create({ id: "sidebar", title: "Abrir en el panel lateral", contexts: ["browser_action"] });
};
browser.menus.onClicked.addListener((info, tab) => {
	if (info.menuItemId === "sidebar") { browser.sidebarAction.open(); return; }
	if (info.menuItemId === "page") openPage();
	else if (info.menuItemId === "window") openWindow();
	else if (info.menuItemId === "close-safe") closeAllSafe();
	else if (info.menuItemId === "ignore" && tab) { ignoredTabs.add(tab.id); scheduleCompute(0); }
	else if (info.menuItemId === "show" && tab) {
		const g = state.groups.find(x => x.tabs.some(t => t.id === tab.id));
		openPanel(g ? { groupId: g.id, tabId: tab.id } : { message: "Esta pestaña no tiene duplicados." });
	}
});

// ------------------------------------------------------------------ arranque

const applySettings = (s) => {
	settings = s;
	exclusions = DupSettings.compileExclusions(s.exclusions);
	profile = DupNormalize.compile(DupSettings.profileOf(s));
	applyClickAction();
	cache.clear();
};

// Huellas de lo que ya está abierto: no genera avisos, solo lo que cambie después.
const seedKeys = async () => {
	lastKey.clear();
	for (const t of await browser.tabs.query({})) {
		if (!t.url || !isTrackable(t)) continue;
		const a = analyzeCached(t.url);
		if (a.ok) lastKey.set(t.id, scopeOf(t) + "§" + a.strict);
	}
};

browser.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && changes.settings) {
		DupSettings.load().then(async s => { applySettings(s); await seedKeys(); scheduleCompute(0); });
	}
});

if (browser.contextualIdentities && browser.contextualIdentities.onCreated) {
	for (const ev of ["onCreated", "onRemoved", "onUpdated"]) browser.contextualIdentities[ev].addListener(() => loadContainers().then(() => scheduleCompute(0)));
}

(async () => {
	applySettings(await DupSettings.load());
	await loadContainers();
	setupMenus();
	await seedKeys();
	await compute();
})();
