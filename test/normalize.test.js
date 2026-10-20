"use strict";
// Ejecutar con:  node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const { explain, analyze, PRESETS, titleSimilarity } = require("../lib/normalize.js");

const level = (a, b, opts) => explain(a, b, opts).level;

const SEGURO = [
	["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"],
	["https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc", "https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ"],
	["https://www.youtube.com/watch?v=abc&t=90", "https://youtu.be/abc?t=1m30s"],
	// Mismo vídeo en otro minuto o abierto desde una lista: es el mismo vídeo
	["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/watch?v=abc&t=120"],
	["https://www.youtube.com/watch?v=abc&t=5s", "https://youtu.be/abc?t=3600"],
	["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/watch?v=abc&list=PL1&index=3"],
	["https://www.youtube.com/@eldescampaopodcast", "https://www.youtube.com/@ElDescampaoPodcast/featured"],
	["https://www.youtube.com/playlist?list=PLfnlhgwRalOIhXXcV7shVUDthLucCkkqU", "https://youtube.com/playlist?list=PLfnlhgwRalOIhXXcV7shVUDthLucCkkqU&si=xyz"],
	["https://www.instagram.com/nasa/", "https://instagram.com/NASA?igsh=MTIz"],
	["https://www.instagram.com/p/AbC123/", "https://www.instagram.com/nasa/p/AbC123/?img_index=1".replace("?img_index=1", "")],
	["https://twitter.com/jack/status/20", "https://x.com/Jack/status/20?s=20&t=abc"],
	["https://x.com/whoever/status/20", "https://mobile.twitter.com/someone_else/status/20"],
	["https://www.reddit.com/r/firefox/comments/abc123/some_title/", "https://old.reddit.com/r/Firefox/comments/abc123/?share_id=1"],
	["https://es.wikipedia.org/wiki/Firefox", "https://es.m.wikipedia.org/wiki/firefox"],
	["https://es.wikipedia.org/wiki/Mozilla_Firefox", "https://es.wikipedia.org/wiki/Mozilla%20Firefox"],
	["https://www.google.com/search?q=gatos&ei=1&ved=2", "https://google.com/search?q=gatos&oq=gat&sourceid=chrome"],
	["https://www.amazon.es/Some-Product/dp/B000123456/ref=sr_1_1?qid=1&sr=8-1", "https://amazon.es/dp/B000123456"],
	["http://example.com/page/", "https://www.example.com/page?utm_source=x&fbclid=y"],
	["https://example.com/a?b=1&c=2", "https://example.com/a?c=2&b=1"],
	["https://docs.google.com/document/d/ID123/edit", "https://docs.google.com/document/d/ID123/view?usp=sharing"],
	["https://github.com/Peuj/duplicate-tabs-closer", "https://github.com/peuj/Duplicate-Tabs-Closer/"],
	["https://open.spotify.com/intl-es/track/XYZ?si=1", "https://open.spotify.com/track/XYZ"],
	["https://www.tiktok.com/@user/video/123?is_from_webapp=1", "https://m.tiktok.com/@OTHER/video/123"],
	["https://www.example.com", "https://example.com/"]
];

const DISTINTO = [
	// Ejemplos reales del usuario
	["https://www.youtube.com/playlist?list=PLfnlhgwRalOIhXXcV7shVUDthLucCkkqU", "https://www.youtube.com/@eldescampaopodcast/videos"],
	["https://www.youtube.com/@eldescampaopodcast/videos", "https://www.youtube.com/@eldescampaopodcast/shorts"],
	["https://www.youtube.com/@eldescampaopodcast/videos", "https://www.youtube.com/@otrocanal/videos"],
	["https://www.youtube.com/playlist?list=AAA", "https://www.youtube.com/playlist?list=BBB"],
	["https://www.youtube.com/watch?v=aaa", "https://www.youtube.com/watch?v=bbb"],
	["https://www.instagram.com/nasa/", "https://www.instagram.com/esa/"],
	["https://www.instagram.com/nasa/", "https://www.instagram.com/nasa/reels/"],
	["https://www.instagram.com/p/AbC123/", "https://www.instagram.com/p/abc123/"],
	["https://x.com/a/status/1", "https://x.com/a/status/2"],
	["https://example.com/page?id=1", "https://example.com/page?id=2"],
	["https://example.com/page?page=2", "https://example.com/page"],
	["https://mail.google.com/mail/u/0/#inbox/AAA", "https://mail.google.com/mail/u/0/#inbox/BBB"],
	["https://app.example.com/#/users/1", "https://app.example.com/#/users/2"],
	["https://www.google.com/search?q=gatos", "https://www.google.com/search?q=perros"],
	["https://docs.google.com/document/d/AAA/edit", "https://docs.google.com/document/d/BBB/edit"],
	["https://example.com/a", "https://example.org/a"],
	["https://es.wikipedia.org/wiki/Firefox", "https://en.wikipedia.org/wiki/Firefox"],
	["https://music.youtube.com/watch?v=abc", "https://www.youtube.com/watch?v=xyz"],
	// Grupos de Sidebery y Tree Style Tab: lo que identifica el grupo va tras «#» o en «?»
	["moz-extension://1b2c/sidebery/group.html#title=Música&id=aaa", "moz-extension://1b2c/sidebery/group.html#title=Música&id=bbb"],
	["moz-extension://1b2c/group.html#k3xG", "moz-extension://1b2c/group.html#p9Qz"],
	["moz-extension://9f/resources/group-tab.html?title=A&temporary=true", "moz-extension://9f/resources/group-tab.html?title=B&temporary=true"],
	// Pestañas suspendidas por otras extensiones: la dirección real va tras «#»
	["moz-extension://abc/suspended.html#url=https://a.com", "moz-extension://abc/suspended.html#url=https://b.com"],
	["about:reader?url=https%3A%2F%2Fa.com%2F1", "about:reader?url=https%3A%2F%2Fa.com%2F2"],
	["https://es.wikipedia.org/wiki/Firefox", "https://es.wikipedia.org/wiki/Firefox?action=history"],
	["https://www.youtube.com/@canal/videos", "https://www.youtube.com/@canal/videos?view=0&sort=p"]
];

const DUDOSO = [
	["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/shorts/abc"],
	["https://www.instagram.com/p/AbC123/", "https://www.instagram.com/reel/AbC123/"],
	["https://example.com/page", "https://example.com/page?ref=newsletter"],
	["https://example.com/About", "https://example.com/about"],
	["https://example.com/blog/", "https://example.com/blog/index.html"],
	["https://docs.google.com/spreadsheets/d/ID/edit#gid=0", "https://docs.google.com/spreadsheets/d/ID/edit#gid=123"],
	["https://example.com/articulo", "about:reader?url=https%3A%2F%2Fexample.com%2Farticulo"],
	["https://example.com/doc#seccion", "https://example.com/doc"],
	["https://es.wikipedia.org/wiki/Firefox#Historia", "https://es.wikipedia.org/wiki/Firefox"],
	["https://app.example.com/#dashboard", "https://app.example.com/#informes"]
];

test("duplicados seguros", () => {
	for (const [a, b] of SEGURO) assert.match(level(a, b), /^(seguro|exacto)$/, `${a}  vs  ${b}`);
});

test("páginas distintas (sin falsos positivos)", () => {
	for (const [a, b] of DISTINTO) assert.equal(level(a, b), "distinto", `${a}  vs  ${b}`);
});

test("casos dudosos", () => {
	for (const [a, b] of DUDOSO) assert.equal(level(a, b), "dudoso", `${a}  vs  ${b}`);
});

test("tratamiento de «#»", () => {
	assert.equal(level("https://e.com/d#a", "https://e.com/d#b"), "dudoso");
	assert.equal(level("https://e.com/d#a", "https://e.com/d#b", { hashMode: "ignore" }), "seguro");
	assert.equal(level("https://e.com/d#a", "https://e.com/d#b", { hashMode: "distinct" }), "distinto");
	assert.equal(level("https://e.com/#/a", "https://e.com/#/b", { hashMode: "doubt" }), "distinto");
});

test("preset «original» imita Duplicate Tabs Closer", () => {
	const o = PRESETS.original;
	assert.equal(level("https://e.com/Pagina", "https://e.com/pagina", o), "seguro");      // ignora mayúsculas
	assert.equal(level("https://e.com/p#a", "https://e.com/p#b", o), "seguro");            // ignora #
	assert.equal(level("https://e.com/p?utm_source=x", "https://e.com/p", o), "distinto"); // no quita rastreo
	assert.equal(level("https://youtu.be/abc", "https://www.youtube.com/watch?v=abc", o), "distinto"); // sin reglas por web
	assert.equal(level("https://e.com/v?t=1", "https://e.com/v", o), "distinto");          // sin dudosos
});

test("opciones personalizadas", () => {
	assert.equal(level("https://e.com/a/b", "https://e.com/x/y", { ignorePath: true }), "seguro");
	assert.equal(level("https://e.com/a?x=1", "https://e.com/a?x=2", { queryMode: "ignore" }), "seguro");
	assert.equal(level("https://e.com/a?sort=1", "https://e.com/a", { ignoreParams: "sort, view" }), "seguro");
	assert.equal(level("https://e.com/a?utm_source=1", "https://e.com/a", { dropTracking: false }), "distinto");
	// Si desactivas una equivalencia, esas parejas dejan de ser duplicadas y pasan a dudosas.
	assert.equal(level("http://e.com/a", "https://e.com/a", { ignoreScheme: false }), "dudoso");
	assert.equal(level("https://www.e.com/a", "https://e.com/a", { ignoreWww: false, siteRules: false }), "dudoso");
});

test("reglas propias", () => {
	const r = { urlRules: "tienda.com ruta:2\nforo.com parametros:t\n/news\\.com\\/articulo\\/(\\d+)/" };
	assert.equal(level("https://tienda.com/cat/zapatos/rojo", "https://tienda.com/cat/zapatos/azul", r), "seguro");
	assert.equal(level("https://tienda.com/cat/zapatos", "https://tienda.com/cat/camisas", r), "distinto");
	assert.equal(level("https://foro.com/hilo?t=5&page=2", "https://foro.com/hilo?t=5", r), "seguro");
	assert.equal(level("https://news.com/articulo/12/titulo-a", "https://news.com/articulo/12/titulo-b", r), "seguro");
	assert.equal(level("https://news.com/articulo/12/x", "https://news.com/articulo/13/x", r), "distinto");
});

test("parecido de títulos", () => {
	assert.equal(titleSimilarity("Hola Mundo", "hola  mundo"), 100);
	assert.ok(titleSimilarity("NASA (@nasa) • Instagram photos and videos", "ESA (@esa) • Instagram photos and videos") > 85);
});

test("páginas de extensiones: siempre dirección exacta, en cualquier modo", () => {
	const a = "moz-extension://1b2c/group.html#k3xG", b = "moz-extension://1b2c/group.html#p9Qz";
	for (const prof of [undefined, PRESETS.original, { hashMode: "ignore", ignoreCase: true, queryMode: "ignore", ignorePath: true }]) {
		assert.equal(level(a, b, prof), "distinto");
	}
	assert.equal(level(a, a), "exacto");
});

test("pestañas vacías no se comparan", () => {
	assert.equal(analyze("about:newtab").ok, false);
	assert.equal(analyze("about:blank").ok, false);
	assert.equal(analyze("https://example.com").ok, true);
});

test("explicación legible", () => {
	const e = explain("https://example.com/p?utm_source=x", "https://example.com/p");
	assert.equal(e.level, "seguro");
	assert.ok(e.details.some(d => d.includes("rastreo")));
});
