/* Aplica el tema elegido (variables de lib/theme.css) a la página actual. */
(function (root) {
	"use strict";

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

	const apply = async (settings, { fontSize } = {}) => {
		const root = document.documentElement;
		root.removeAttribute("style");
		root.dataset.density = settings.density;
		root.style.setProperty("--fs", (fontSize || settings.fontSize) + "px");
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

	root.DupTheme = { apply, luminance };
})(globalThis);
