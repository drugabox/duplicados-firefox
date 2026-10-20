/* Ajustes por defecto, compartidos entre el fondo y el panel. */
(function (root) {
	"use strict";

	const DEFAULTS = {
		// Qué hacer al abrir una pestaña que ya estaba abierta:
		//   "panel"  → abrir la lista y saltar a esa pareja
		//   "notify" → solo una notificación del sistema
		//   "badge"  → solo el número del icono
		//   "close"  → cerrar la nueva y mostrar la que ya existía
		onDuplicate: "panel",
		alertDoubtful: false,       // avisar también de los dudosos

		// Cómo se detectan: "inequivoco" (por defecto), "original" (como Duplicate Tabs Closer) o "personalizado".
		preset: "inequivoco",
		match: null,                // opciones del modo personalizado (ver PRESETS en lib/normalize.js)

		// Qué pestañas se comparan
		scope: "all",               // "all" = todas las ventanas, "window" = solo la misma ventana
		separateContainers: true,   // pestañas en contenedores distintos no son duplicadas
		includeHidden: true,        // pestañas ocultas por gestores de grupos (Simple Tab Groups...)
		exclusions: "",             // una regla por línea

		// Al cerrar, cuál se conserva (las fijadas siempre)
		keepPolicy: "oldest",       // "oldest" | "newest" | "recent"
		keepActive: false,          // la que estás viendo
		preferActiveWindow: false,  // la de la ventana en uso
		keepHttps: true,            // la segura (https) frente a http

		// Icono
		clickAction: "popup",       // "popup" (ventanita) | "window" (ventana grande) | "tab" (pestaña) | "sidebar" (panel lateral)
		popupWidth: 420,            // ventanita: Firefox no permite más de 800 × 600
		popupHeight: 560,           // alto total de la ventanita
		popupFontSize: 13,
		badgeColor: "#d92d20",
		badgeDoubtColor: "#dc8a00",
		badgeZeroColor: "#4f6bed",
		badgeDoubtful: true,        // «?» cuando solo hay dudosos
		showZeroBadge: false,       // mostrar «0» cuando no hay duplicados

		// Apariencia
		theme: "auto",
		accent: "",
		density: "normal",          // "compact" | "normal" | "comfy"
		fontSize: 14,
		radius: 10,
		showFavicons: true,
		urlDisplay: "full",         // "full" | "short"
		custom: {
			bg: "#f6f7fb", surface: "#ffffff", text: "#1d2230", muted: "#667085",
			accent: "#4f6bed", safe: "#d92d20", doubt: "#dc8a00", border: "#e3e6ee"
		}
	};

	// Límites de Firefox para la ventanita del icono.
	const POPUP_MAX = { width: 800, height: 600 };
	const POPUP_MIN = { width: 300, height: 220 };
	const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || a));

	const presets = () => root.DupNormalize.PRESETS;

	// Opciones de detección efectivas según el modo elegido.
	const profileOf = (s) => {
		const P = presets();
		if (s.preset === "personalizado") return { ...P.inequivoco, ...(s.match || {}) };
		return P[s.preset] || P.inequivoco;
	};

	const load = async () => {
		const { settings } = await browser.storage.local.get("settings");
		const s = { ...DEFAULTS, ...(settings || {}), custom: { ...DEFAULTS.custom, ...((settings && settings.custom) || {}) } };
		s.match = { ...presets().inequivoco, ...(s.match || {}) };
		s.popupWidth = clamp(s.popupWidth, POPUP_MIN.width, POPUP_MAX.width);
		s.popupHeight = clamp(s.popupHeight, POPUP_MIN.height, POPUP_MAX.height);
		return s;
	};

	const save = async (patch) => {
		const current = await load();
		const next = { ...current, ...patch };
		await browser.storage.local.set({ settings: next });
		return next;
	};

	// "instagram.com" → ese dominio y sus subdominios
	// "*://ejemplo.com/privado/*" o "ejemplo.com/privado*" → comodines sobre la dirección
	// "/expresión/" → expresión regular sobre la dirección completa
	const compileExclusions = (text) => (text || "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(line => {
		const rx = /^\/(.+)\/([a-z]*)$/.exec(line);
		if (rx) {
			try { const re = new RegExp(rx[1], rx[2].replace(/[gy]/g, "")); return (url) => re.test(url); } catch { return () => false; }
		}
		if (!/[*/]/.test(line)) {
			const d = line.toLowerCase().replace(/^www\./, "");
			return (url) => {
				try {
					const h = new URL(url).hostname.toLowerCase();
					return h === d || h.endsWith("." + d);
				} catch { return false; }
			};
		}
		const body = line.replace(/^[a-z*]+:\/\//i, "");
		const re = new RegExp("^(?:[a-z-]+://)?(?:www\\.)?" + body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"), "i");
		return (url) => re.test(url);
	});

	root.DupSettings = { DEFAULTS, POPUP_MAX, POPUP_MIN, load, save, profileOf, compileExclusions };
})(globalThis);
