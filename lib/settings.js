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
		scope: "all",               // "all" = todas las ventanas, "window" = solo la misma ventana
		separateContainers: true,   // pestañas en contenedores distintos no son duplicadas
		keepPolicy: "oldest",       // al cerrar: "oldest" | "newest" | "recent"
		anchorsDistinct: false,     // #secciones distintas = páginas distintas
		exclusions: "",             // una regla por línea
		clickAction: "popup",       // icono: "popup" (ventanita) | "tab" (pestaña completa) | "sidebar" (panel lateral)
		popupWidth: 380,            // ventanita del icono: se cambian arrastrando su esquina
		popupHeight: 420,
		popupFontSize: 13,

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

	const load = async () => {
		const { settings } = await browser.storage.local.get("settings");
		return { ...DEFAULTS, ...(settings || {}), custom: { ...DEFAULTS.custom, ...((settings && settings.custom) || {}) } };
	};

	const save = async (patch) => {
		const current = await load();
		const next = { ...current, ...patch };
		await browser.storage.local.set({ settings: next });
		return next;
	};

	// "instagram.com" → ese dominio y sus subdominios
	// "*://ejemplo.com/privado/*" o "ejemplo.com/privado*" → comodines sobre la dirección
	const compileExclusions = (text) => (text || "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(line => {
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

	root.DupSettings = { DEFAULTS, load, save, compileExclusions };
})(globalThis);
