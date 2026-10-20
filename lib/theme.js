/* Temas: paletas conocidas y aplicación del tema elegido a la página actual. */
(function (root) {
	"use strict";

	// Cada tema: fondo, superficie (tarjetas), superficie 2, texto, texto suave, borde,
	// acento, duplicado, dudoso y correcto. Colores tomados de las paletas oficiales.
	const T = (id, name, c) => ({ id, name, colors: { bg: c[0], surface: c[1], "surface-2": c[2], text: c[3], muted: c[4], border: c[5], accent: c[6], safe: c[7], doubt: c[8], ok: c[9] } });
	const LIST = [
		T("claro", "Claro", ["#f4f5f9", "#ffffff", "#eef0f6", "#1d2230", "#667085", "#e1e4ec", "#4f6bed", "#d92d20", "#c27a00", "#12a150"]),
		T("oscuro", "Oscuro", ["#14161c", "#1d2028", "#262a35", "#e7e9ef", "#9aa1b2", "#2f3442", "#7b93ff", "#ff6b5e", "#f5b544", "#3ccf7f"]),
		T("latte", "Catppuccin Latte", ["#e6e9ef", "#eff1f5", "#dce0e8", "#4c4f69", "#6c6f85", "#ccd0da", "#8839ef", "#d20f39", "#df8e1d", "#40a02b"]),
		T("frappe", "Catppuccin Frappé", ["#292c3c", "#303446", "#414559", "#c6d0f5", "#a5adce", "#51576d", "#ca9ee6", "#e78284", "#e5c890", "#a6d189"]),
		T("macchiato", "Catppuccin Macchiato", ["#1e2030", "#24273a", "#363a4f", "#cad3f5", "#a5adcb", "#494d64", "#c6a0f6", "#ed8796", "#eed49f", "#a6da95"]),
		T("mocha", "Catppuccin Mocha", ["#181825", "#1e1e2e", "#313244", "#cdd6f4", "#a6adc8", "#45475a", "#cba6f7", "#f38ba8", "#f9e2af", "#a6e3a1"]),
		T("dracula", "Dracula", ["#21222c", "#282a36", "#343746", "#f8f8f2", "#9ea4c4", "#44475a", "#bd93f9", "#ff5555", "#ffb86c", "#50fa7b"]),
		T("kanagawa", "Kanagawa Wave", ["#16161d", "#1f1f28", "#2a2a37", "#dcd7ba", "#a6a69c", "#363646", "#7e9cd8", "#e46876", "#e6c384", "#98bb6c"]),
		T("kanagawa-dragon", "Kanagawa Dragon", ["#0d0c0c", "#181616", "#282727", "#c5c9c5", "#a6a69c", "#393836", "#8ba4b0", "#c4746e", "#c4b28a", "#87a987"]),
		T("kanagawa-lotus", "Kanagawa Lotus", ["#e7dba0", "#f2ecbc", "#e5ddb0", "#545464", "#716e61", "#d5cea3", "#4d699b", "#c84053", "#cc6d00", "#6f894e"]),
		T("tokyonight", "Tokyo Night", ["#16161e", "#1a1b26", "#24283b", "#c0caf5", "#9aa5ce", "#292e42", "#7aa2f7", "#f7768e", "#e0af68", "#9ece6a"]),
		T("rosepine", "Rosé Pine", ["#191724", "#1f1d2e", "#26233a", "#e0def4", "#908caa", "#403d52", "#c4a7e7", "#eb6f92", "#f6c177", "#9ccfd8"]),
		T("rosepine-dawn", "Rosé Pine Dawn", ["#faf4ed", "#fffaf3", "#f2e9e1", "#575279", "#797593", "#dfdad9", "#907aa9", "#b4637a", "#ea9d34", "#286983"]),
		T("gruvbox", "Gruvbox", ["#1d2021", "#282828", "#3c3836", "#ebdbb2", "#a89984", "#504945", "#83a598", "#fb4934", "#fabd2f", "#b8bb26"]),
		T("gruvbox-light", "Gruvbox claro", ["#f2e5bc", "#fbf1c7", "#ebdbb2", "#3c3836", "#7c6f64", "#d5c4a1", "#076678", "#9d0006", "#b57614", "#79740e"]),
		T("nord", "Nord", ["#2e3440", "#3b4252", "#434c5e", "#eceff4", "#b5bdcc", "#4c566a", "#88c0d0", "#bf616a", "#ebcb8b", "#a3be8c"]),
		T("solarized", "Solarized", ["#002b36", "#073642", "#0b4552", "#eee8d5", "#93a1a1", "#174e5a", "#268bd2", "#dc322f", "#b58900", "#859900"]),
		T("solarized-light", "Solarized claro", ["#eee8d5", "#fdf6e3", "#e9e2cb", "#586e75", "#7d8b8c", "#ddd6c1", "#268bd2", "#dc322f", "#b58900", "#859900"]),
		T("onedark", "One Dark", ["#21252b", "#282c34", "#2c313a", "#abb2bf", "#8b919c", "#3e4451", "#61afef", "#e06c75", "#e5c07b", "#98c379"]),
		T("everforest", "Everforest", ["#232a2e", "#2d353b", "#343f44", "#d3c6aa", "#9da9a0", "#475258", "#7fbbb3", "#e67e80", "#dbbc7f", "#a7c080"]),
		T("monokai", "Monokai", ["#1e1f1c", "#272822", "#3e3d32", "#f8f8f2", "#a59f85", "#49483e", "#66d9ef", "#f92672", "#e6db74", "#a6e22e"]),
		T("github-dark", "GitHub oscuro", ["#010409", "#0d1117", "#161b22", "#e6edf3", "#8d96a0", "#30363d", "#4493f8", "#f85149", "#d29922", "#3fb950"])
	];
	// Además: «auto» (claro u oscuro según el sistema), «firefox» (colores de tu tema) y «custom».

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
			if (v.surface && v.text && !v["surface-2"]) root.style.setProperty("--surface-2", `color-mix(in srgb, ${v.surface} 88%, ${v.text})`);
			if (v.bg) {
				const dark = luminance(v.bg) < 0.25;
				root.style.setProperty("color-scheme", dark ? "dark" : "light");
				if (dark) root.style.setProperty("--shadow", "0 1px 2px rgb(0 0 0 / .35)");
			}
		};
		const known = LIST.find(t => t.id === theme);
		if (known) setVars(known.colors);
		else if (theme === "custom") setVars(settings.custom);
		else if (theme === "firefox") {
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
		} else theme = "auto"; // temas antiguos que ya no existen
		root.dataset.theme = theme;
		if (settings.accent) setVars({ accent: settings.accent });
		const acc = getComputedStyle(root).getPropertyValue("--accent").trim();
		if (acc.startsWith("#")) root.style.setProperty("--accent-text", luminance(acc) > 0.45 ? "#111" : "#fff");
	};

	root.DupTheme = { apply, luminance, LIST };
})(globalThis);
