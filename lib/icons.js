/* Diseños del icono de la barra. Cada uno recibe el color elegido y devuelve un SVG. */
(function (root) {
	"use strict";

	const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;

	const STYLES = {
		pestanas: { name: "Pestañas", draw: c => svg(`<rect x="6" y="14" width="38" height="38" rx="8" fill="${c}" opacity=".45"/><rect x="18" y="6" width="40" height="40" rx="9" fill="${c}"/><rect x="18" y="6" width="40" height="11" rx="5" fill="#000" opacity=".18"/><path d="M28 30l6 6 12-13" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`) },
		copias: { name: "Copias", draw: c => svg(`<rect x="6" y="18" width="34" height="38" rx="6" fill="none" stroke="${c}" stroke-width="6"/><rect x="24" y="6" width="34" height="38" rx="6" fill="${c}"/>`) },
		capas: { name: "Capas", draw: c => svg(`<path d="M32 6L60 20 32 34 4 20z" fill="${c}"/><path d="M8 32l24 12 24-12" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round" opacity=".75"/><path d="M8 44l24 12 24-12" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round" opacity=".5"/>`) },
		circulos: { name: "Círculos", draw: c => svg(`<circle cx="23" cy="32" r="18" fill="${c}" opacity=".5"/><circle cx="41" cy="32" r="18" fill="${c}"/>`) },
		letra: { name: "Letra D", draw: c => svg(`<rect x="4" y="4" width="56" height="56" rx="14" fill="${c}"/><path d="M22 16h10a16 16 0 0 1 0 32H22z" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>`) },
		dos: { name: "×2", draw: c => svg(`<rect x="4" y="4" width="56" height="56" rx="28" fill="${c}"/><path d="M15 25l12 14M27 25L15 39" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M34 27a6 6 0 0 1 12 0c0 6-12 10-12 14h13" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`) },
		lupa: { name: "Lupa", draw: c => svg(`<rect x="6" y="6" width="30" height="30" rx="6" fill="${c}" opacity=".45"/><circle cx="34" cy="34" r="16" fill="none" stroke="${c}" stroke-width="7"/><path d="M46 46l12 12" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`) }
	};

	const COLORS = ["#4f6bed", "#d92d20", "#12a150", "#dc8a00", "#8839ef", "#0b8ec2", "#e64e9b", "#5f6b7a", "#1d2230", "#ffffff"];

	const dataUrl = (style, color) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent((STYLES[style] || STYLES.pestanas).draw(color || COLORS[0]));

	root.DupIcons = { STYLES, COLORS, dataUrl };
})(globalThis);
