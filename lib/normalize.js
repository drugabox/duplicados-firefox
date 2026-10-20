/*
 * Motor de detección de duplicados.
 *
 * Cada dirección se convierte en dos "huellas":
 *   - strict: si dos pestañas tienen la misma, son la MISMA página (duplicado seguro).
 *   - loose:  si coinciden solo en esta, muestran casi lo mismo pero con algún matiz
 *             (otro minuto del vídeo, otra pestaña de la hoja, modo lectura...) → DUDOSO.
 *
 * Nunca se usa el título de la página: los títulos de un mismo sitio se parecen
 * mucho entre sí (todos los perfiles de Instagram, todos los vídeos de YouTube...)
 * y eso es lo que provoca falsos positivos.
 *
 * Funciona tanto en el navegador (global DupNormalize) como en Node (tests).
 */
(function (root) {
	"use strict";

	// ---------------------------------------------------------------- parámetros

	// Parámetros que solo sirven para rastrear de dónde vienes. Nunca cambian la página.
	const TRACKING = new Set([
		"fbclid", "gclid", "gclsrc", "gbraid", "wbraid", "dclid", "msclkid", "yclid", "twclid",
		"ttclid", "li_fat_id", "mc_cid", "mc_eid", "igshid", "igsh", "_ga", "_gl", "_hsenc",
		"_hsmi", "mkt_tok", "vero_id", "vero_conv", "oly_enc_id", "oly_anon_id", "srsltid",
		"_openstat", "rb_clickid", "wt_mc", "wt.mc_id", "sc_channel", "ga_source", "ga_medium", "ga_campaign",
		"__twitter_impression", "at_medium", "at_campaign", "fb_action_ids", "fb_action_types",
		"fb_ref", "fb_source", "action_object_map", "action_type_map", "action_ref_map",
		"ref_src", "ref_url", "cmpid", "_branch_match_id", "_branch_referrer",
		"si_source"
	]);
	const TRACKING_PREFIX = ["utm_", "pk_", "mtm_", "hsa_", "pd_rd_", "pf_rd_", "__cft__", "__tn__"];

	// Parámetros genéricos que suelen indicar solo "desde dónde llegaste", pero no siempre.
	// Si dos direcciones solo se diferencian en estos → dudoso.
	const SOFT_GENERIC = new Set(["ref", "ref_", "referrer", "source", "src", "from", "via", "share", "shared", "cmp", "campaign", "origin", "hl", "lang"]);

	const isTracking = (name) => {
		const n = name.toLowerCase();
		return TRACKING.has(n) || TRACKING_PREFIX.some(p => n.startsWith(p));
	};

	// ---------------------------------------------------------------- utilidades

	const safeDecode = (s) => {
		try { return decodeURIComponent(s); } catch { return s; }
	};

	// "1m30s", "90s", "90" → "90"
	const youtubeSeconds = (t) => {
		if (!t) return "";
		if (/^\d+$/.test(t)) return String(Number(t));
		const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i.exec(t);
		if (!m) return t;
		return String((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0));
	};

	const sortedQuery = (pairs) => {
		if (!pairs.length) return "";
		const s = pairs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
		return "?" + s.map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join("&");
	};

	const hostEndsWith = (host, domain) => host === domain || host.endsWith("." + domain);

	// Un fragmento "#/ruta", "#!algo", "#inbox/123" o "#gid=5" es estado de la aplicación,
	// no un simple salto a una sección.
	const isRouteHash = (h) => /^[/!]/.test(h) || /[/=&?]/.test(h);

	// ---------------------------------------------------------------- reglas por sitio
	//
	// Cada regla puede definir:
	//   match(host)        → si se aplica
	//   host(host)         → host canónico (alias: x.com/twitter.com, m.youtube.com...)
	//   classify(name, u)  → "tracking" | "soft" | "key" para un parámetro (undefined = genérico)
	//   key(u)             → { strict, loose, what } o null para usar el método genérico
	//   keepHash           → el fragmento (#...) siempre importa
	//   lowerSegs          → nº de segmentos iniciales de la ruta que no distinguen mayúsculas
	//
	// u = { host, segs[], params: [[k,v]], hash, path }

	const param = (u, name) => {
		const p = u.params.find(([k]) => k === name);
		return p ? p[1] : null;
	};

	const YT_DROP = new Set(["si", "feature", "pp", "ab_channel", "app", "embeds_referring_euri", "embeds_referring_origin",
		"embeds_euri", "source_ve_path", "persist_app", "noapp", "cbrd", "ucbcb", "themerefresh", "kw", "lc", "attr_tag", "is_from_webapp"]);
	const YT_SOFT_WATCH = new Set(["t", "start", "time_continue", "list", "index", "start_radio", "rv", "end", "playnext"]);

	const RULES = [
		{
			name: "YouTube",
			match: h => h === "youtu.be" || hostEndsWith(h, "youtube-nocookie.com") ||
				(hostEndsWith(h, "youtube.com") && !h.startsWith("music.") && !h.startsWith("studio.")),
			host: () => "youtube.com",
			classify(name, u) {
				const n = name.toLowerCase();
				if (YT_DROP.has(n)) return "tracking";
				const s0 = u.segs[0] || "";
				if (u.origHost === "youtu.be" || s0 === "watch" || s0 === "shorts" || s0 === "live" || s0 === "embed") {
					if (n === "v") return "key";
					if (YT_SOFT_WATCH.has(n)) return "soft";
				}
				if (s0 === "playlist") return n === "list" ? "key" : "tracking";
				if (s0 === "results") return (n === "search_query" || n === "sp") ? "key" : "tracking";
				return undefined;
			},
			key(u) {
				let id = null, form = "watch";
				const s = u.segs;
				if (u.origHost === "youtu.be") id = s[0];
				else if (s[0] === "watch") id = param(u, "v");
				else if (s[0] === "live" && s[1]) id = s[1];
				else if (s[0] === "shorts" && s[1]) { id = s[1]; form = "shorts"; }
				else if ((s[0] === "embed" || s[0] === "v") && s[1]) { id = s[1]; form = "embed"; }

				if (id) {
					const t = youtubeSeconds(param(u, "t") || param(u, "start") || param(u, "time_continue"));
					const list = param(u, "list");
					let extra = "";
					if (list) extra += `&list=${list}`;
					if (t && t !== "0") extra += `&t=${t}`;
					const base = `youtube.com/watch?v=${id}`;
					const strict = form === "watch" ? base + extra : `youtube.com/${form}/${id}` + extra;
					return { strict, loose: base, what: form === "shorts" ? "Short de YouTube" : "Vídeo de YouTube" };
				}
				if (s[0] === "playlist") {
					const l = param(u, "list");
					if (l) return { strict: `youtube.com/playlist?list=${l}`, loose: `youtube.com/playlist?list=${l}`, what: "Lista de YouTube" };
				}
				if (s[0] && s[0].startsWith("@")) {
					// Los @usuario no distinguen mayúsculas; "featured" es la portada del canal.
					const handle = safeDecode(s[0]).toLowerCase();
					const tab = (s[1] || "").toLowerCase();
					const k = `youtube.com/${handle}${tab && tab !== "featured" ? "/" + tab : ""}`;
					const kq = k + sortedQuery(u.keyParams);
					return { strict: kq, loose: kq, what: "Canal de YouTube" };
				}
				if ((s[0] === "c" || s[0] === "user") && s[1]) {
					const tab = (s[2] || "").toLowerCase();
					const k = `youtube.com/${s[0]}/${s[1].toLowerCase()}${tab && tab !== "featured" ? "/" + tab : ""}`;
					const kq = k + sortedQuery(u.keyParams);
					return { strict: kq, loose: kq, what: "Canal de YouTube" };
				}
				if (s[0] === "channel" && s[1]) {
					const tab = (s[2] || "").toLowerCase();
					const k = `youtube.com/channel/${s[1]}${tab && tab !== "featured" ? "/" + tab : ""}`;
					const kq = k + sortedQuery(u.keyParams);
					return { strict: kq, loose: kq, what: "Canal de YouTube" };
				}
				return null;
			}
		},
		{
			name: "Instagram",
			match: h => hostEndsWith(h, "instagram.com"),
			host: () => "instagram.com",
			classify(name) {
				const n = name.toLowerCase();
				if (n === "img_index" || n === "hl") return "soft";
				if (n === "igsh" || n === "igshid" || n === "next" || n === "ig_rid") return "tracking";
				return undefined;
			},
			key(u) {
				const s = u.segs.slice();
				if (!s.length) return null;
				// Formato nuevo: /usuario/p/ID → /p/ID
				if (s.length >= 3 && ["p", "reel", "reels", "tv"].includes(s[1])) s.splice(0, 1);
				if (["p", "reel", "reels", "tv"].includes(s[0]) && s[1]) {
					// Los ID de publicación SÍ distinguen mayúsculas.
					const kind = s[0] === "reels" ? "reel" : s[0];
					return { strict: `instagram.com/${kind}/${s[1]}`, loose: `instagram.com/media/${s[1]}`, what: "Publicación de Instagram" };
				}
				if (s[0] === "stories" && s[1]) {
					const k = `instagram.com/stories/${s[1].toLowerCase()}${s[2] ? "/" + s[2] : ""}`;
					return { strict: k, loose: k, what: "Historia de Instagram" };
				}
				const reserved = ["explore", "direct", "accounts", "about", "legal", "developer", "web", "challenge", "emails"];
				if (!reserved.includes(s[0])) {
					// Perfil: el nombre de usuario no distingue mayúsculas. /usuario/reels, /usuario/tagged... son otras secciones.
					const k = `instagram.com/${s[0].toLowerCase()}${s[1] ? "/" + s.slice(1).join("/").toLowerCase() : ""}`;
					return { strict: k, loose: k, what: "Perfil de Instagram" };
				}
				return null;
			}
		},
		{
			name: "X / Twitter",
			match: h => hostEndsWith(h, "twitter.com") || hostEndsWith(h, "x.com") || h === "fxtwitter.com" || h === "vxtwitter.com",
			host: () => "x.com",
			classify(name) {
				const n = name.toLowerCase();
				if (["s", "t", "ref_src", "ref_url", "src", "cn", "cxt", "mx"].includes(n)) return "tracking";
				if (n === "lang") return "soft";
				return undefined;
			},
			key(u) {
				const s = u.segs;
				if (s.length >= 3 && (s[1] === "status" || s[1] === "statuses") && /^\d+$/.test(s[2])) {
					const strict = `x.com/status/${s[2]}${s[3] ? "/" + s.slice(3).join("/") : ""}`;
					return { strict, loose: `x.com/status/${s[2]}`, what: "Publicación de X" };
				}
				if (s[0] === "i" && s[1] === "web" && s[2] === "status" && s[3]) {
					return { strict: `x.com/status/${s[3]}`, loose: `x.com/status/${s[3]}`, what: "Publicación de X" };
				}
				if (s[0] && !["i", "home", "search", "explore", "notifications", "messages", "settings", "hashtag"].includes(s[0])) {
					const k = `x.com/${s.join("/").toLowerCase()}`;
					return { strict: k, loose: k, what: "Perfil de X" };
				}
				return null;
			}
		},
		{
			name: "Reddit",
			match: h => hostEndsWith(h, "reddit.com") || h === "redd.it",
			host: () => "reddit.com",
			classify(name) {
				const n = name.toLowerCase();
				if (["share_id", "rdt", "ref", "ref_source", "$deep_link", "correlation_id", "post_fullname", "post_index", "ref_campaign", "embed_host_url", "rdt_cid"].includes(n)) return "tracking";
				if (n === "context") return "soft";
				return undefined;
			},
			key(u) {
				const s = u.segs;
				if (u.origHost === "redd.it" && s[0]) return { strict: `reddit.com/comments/${s[0]}`, loose: `reddit.com/comments/${s[0]}`, what: "Publicación de Reddit" };
				const ci = s.indexOf("comments");
				if (ci >= 0 && s[ci + 1]) {
					// /r/sub/comments/ID/titulo/IDcomentario → el título es decorativo
					const strict = `reddit.com/comments/${s[ci + 1].toLowerCase()}${s[ci + 3] ? "/" + s[ci + 3].toLowerCase() : ""}`;
					return { strict, loose: `reddit.com/comments/${s[ci + 1].toLowerCase()}`, what: "Publicación de Reddit" };
				}
				if ((s[0] === "r" || s[0] === "u" || s[0] === "user") && s[1]) {
					const head = s[0] === "u" ? "user" : s[0];
					const k = `reddit.com/${head}/${s.slice(1).join("/").toLowerCase()}`;
					return { strict: k + sortedQuery(u.keyParams), loose: k, what: s[0] === "r" ? "Subreddit" : "Usuario de Reddit" };
				}
				return null;
			}
		},
		{
			name: "Wikipedia",
			match: h => /(^|\.)(wikipedia|wiktionary|wikiquote|wikibooks|wikisource|wikivoyage|wikimedia)\.org$/.test(h),
			host: h => h.replace(/\.m\./, ".").replace(/^m\./, "").replace(/^www\./, ""),
			classify(name) {
				const n = name.toLowerCase();
				if (n === "wprov" || n === "useskin" || n === "uselang") return "tracking";
				return undefined;
			},
			key(u) {
				let title = null;
				if (u.segs[0] === "wiki" && u.segs[1]) title = u.segs.slice(1).join("/");
				else if (u.segs[0] === "w" && u.segs[1] === "index.php" && param(u, "title") && u.keyParams.length === 1) title = param(u, "title");
				if (!title) return null;
				title = safeDecode(title).replace(/ /g, "_");
				// MediaWiki pone la primera letra en mayúscula automáticamente.
				title = title.charAt(0).toUpperCase() + title.slice(1);
				const k = `${u.host}/wiki/${title}` + sortedQuery(u.keyParams.filter(([n]) => n !== "title"));
				return { strict: k, loose: k, what: "Artículo de Wikipedia" };
			}
		},
		{
			name: "Google",
			match: h => /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h),
			host: h => h.replace(/^www\./, ""),
			classify(name, u) {
				if (u.segs[0] !== "search") return undefined;
				return ["q", "tbm", "udm", "start", "tbs"].includes(name) ? "key" : "tracking";
			},
			key(u) {
				if (u.segs[0] !== "search") return null;
				const q = (param(u, "q") || "").trim().replace(/\s+/g, " ");
				const rest = u.keyParams.filter(([k]) => k !== "q");
				return {
					strict: `${u.host}/search?q=${q}${sortedQuery(rest).replace("?", "&")}`,
					loose: `google/search?q=${q.toLowerCase()}${sortedQuery(rest).replace("?", "&")}`,
					what: "Búsqueda de Google"
				};
			}
		},
		{
			name: "Amazon",
			match: h => /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h),
			host: h => h.replace(/^(www|smile|m)\./, ""),
			classify(name) {
				const n = name.toLowerCase();
				if (["ref", "ref_", "qid", "sr", "crid", "sprefix", "content-id", "_encoding", "psc", "tag", "linkcode", "linkid",
					"ascsubtag", "dib", "dib_tag", "keywords", "sp_csd", "spla", "creative", "creativeasin", "camp", "dchild", "language", "geniuslink", "social_share", "starsleft", "smid"].includes(n)) return "tracking";
				if (n === "th") return "soft";
				return undefined;
			},
			key(u) {
				const s = u.segs.filter(x => !x.startsWith("ref="));
				let asin = null;
				const dp = s.indexOf("dp");
				if (dp >= 0 && s[dp + 1]) asin = s[dp + 1];
				else if (s[0] === "gp" && s[1] === "product" && s[2]) asin = s[2];
				else if (s[0] === "gp" && s[1] === "aw" && s[2] === "d" && s[3]) asin = s[3];
				if (!asin) return null;
				const k = `${u.host}/dp/${asin.toUpperCase()}`;
				return { strict: k + sortedQuery(u.keyParams.concat(u.softParams)), loose: k, what: "Producto de Amazon" };
			}
		},
		{
			name: "Facebook",
			match: h => hostEndsWith(h, "facebook.com") || h === "fb.com" || h === "fb.watch",
			host: h => (h === "fb.watch" ? h : "facebook.com"),
			classify(name) {
				const n = name.toLowerCase();
				if (["mibextid", "rdid", "sfnsn", "extid", "fs", "paipv", "eav", "refsrc", "hc_ref", "_rdr", "comment_tracking", "notif_id", "notif_t", "ref", "sk_ref", "acontext", "rdr", "hc_location"].includes(n)) return "tracking";
				return undefined;
			}
		},
		{
			name: "TikTok",
			match: h => hostEndsWith(h, "tiktok.com"),
			host: () => "tiktok.com",
			classify(name) {
				const n = name.toLowerCase();
				if (["is_from_webapp", "sender_device", "web_id", "_r", "_t", "refer", "is_copy_url", "u_code", "preview_pb", "tt_from", "checksum", "sec_user_id", "timestamp", "user_id", "enter_from", "enter_method", "_d", "item_author_type"].includes(n)) return "tracking";
				if (n === "lang") return "soft";
				return undefined;
			},
			key(u) {
				const s = u.segs;
				if (s[0] && s[0].startsWith("@")) {
					if (s[1] === "video" && s[2]) return { strict: `tiktok.com/video/${s[2]}`, loose: `tiktok.com/video/${s[2]}`, what: "Vídeo de TikTok" };
					const k = `tiktok.com/${s.join("/").toLowerCase()}`;
					return { strict: k, loose: k, what: "Perfil de TikTok" };
				}
				return null;
			}
		},
		{
			name: "GitHub",
			match: h => h === "github.com" || h === "www.github.com",
			host: () => "github.com",
			lowerSegs: 2
		},
		{
			name: "Spotify",
			match: h => h === "open.spotify.com",
			classify(name) {
				const n = name.toLowerCase();
				if (n === "si" || n === "nd" || n === "dl_branch" || n === "go" || n === "sp_cid" || n === "flow_ctx") return "tracking";
				if (n === "context") return "soft";
				return undefined;
			},
			key(u) {
				const s = u.segs[0] && /^intl-/.test(u.segs[0]) ? u.segs.slice(1) : u.segs;
				if (s.length >= 2) {
					const k = `open.spotify.com/${s.join("/")}`;
					return { strict: k + sortedQuery(u.keyParams.concat(u.softParams)), loose: k + sortedQuery(u.keyParams), what: "Spotify" };
				}
				return null;
			}
		},
		{
			name: "Google Docs",
			match: h => h === "docs.google.com",
			ownHash: true,
			classify(name) {
				const n = name.toLowerCase();
				if (["usp", "ouid", "rtpof", "sd", "pli", "pref", "urp", "hl"].includes(n)) return "tracking";
				if (n === "tab" || n === "gid" || n === "range") return "soft";
				return undefined;
			},
			key(u) {
				const s = u.segs;
				// /document/d/ID/edit, /spreadsheets/u/1/d/ID/view... → mismo archivo
				const di = s.indexOf("d");
				if (di >= 1 && s[di + 1]) {
					const type = s[0];
					const account = s[1] === "u" && s[2] ? `u${s[2]}:` : "";
					const k = `docs.google.com/${type}/${account}${s[di + 1]}`;
					const gid = /(?:^|&)gid=(\d+)/.exec(u.hash || "");
					const tab = param(u, "tab") || param(u, "gid") || (gid ? gid[1] : "");
					return { strict: k + (tab ? `#${tab}` : ""), loose: k, what: "Documento de Google" };
				}
				return null;
			}
		},
		{
			name: "Google Drive",
			match: h => h === "drive.google.com",
			classify(name) {
				const n = name.toLowerCase();
				if (["usp", "ouid", "resourcekey", "sharing"].includes(n)) return "tracking";
				return undefined;
			},
			key(u) {
				const s = u.segs;
				const di = s.indexOf("d");
				if (s[0] === "file" && di >= 0 && s[di + 1]) return { strict: `drive.google.com/file/${s[di + 1]}`, loose: `drive.google.com/file/${s[di + 1]}`, what: "Archivo de Drive" };
				if (param(u, "id") && (s[0] === "open" || s[0] === "uc")) {
					const id = param(u, "id");
					return { strict: `drive.google.com/file/${id}`, loose: `drive.google.com/file/${id}`, what: "Archivo de Drive" };
				}
				return null;
			}
		},
		{
			name: "Gmail",
			match: h => h === "mail.google.com",
			keepHash: true
		}
	];


	// ---------------------------------------------------------------- perfiles de detección
	//
	// Un perfil dice qué diferencias se pasan por alto. Hay dos de serie y uno libre:
	//   inequivoco    → solo lo que es, sin lugar a dudas, la misma página (por defecto)
	//   original      → imita Duplicate Tabs Closer con los ajustes habituales (para comparar)
	//   personalizado → cada opción a mano

	const PRESETS = {
		inequivoco: {
			siteRules: true, dropTracking: true, ignoreScheme: true, ignoreWww: true, ignoreMobile: true,
			ignoreCase: false, hashMode: "doubt", queryMode: "keep", ignorePath: false,
			ignoreParams: "", urlRules: "", titleMode: "off", titleThreshold: 90, titleRules: "", showDoubtful: true
		},
		original: {
			siteRules: false, dropTracking: false, ignoreScheme: true, ignoreWww: true, ignoreMobile: false,
			ignoreCase: true, hashMode: "ignore", queryMode: "keep", ignorePath: false,
			ignoreParams: "", urlRules: "", titleMode: "or", titleThreshold: 100, titleRules: "", showDoubtful: false
		}
	};

	const findRule = (host) => RULES.find(r => r.match(host)) || null;

	const MOBILE_PREFIX = /^(m|mobile)\.(.+\..+)$/;
	const MOBILE_ANY = /^(m|mobile|mbasic|touch)\.(.+\..+)$/;

	const splitList = (t) => (t || "").split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);

	const parseRegex = (line) => {
		const m = /^\/(.+)\/([a-z]*)$/.exec(line);
		if (!m) return null;
		try { return new RegExp(m[1], m[2].replace(/[gy]/g, "")); } catch { return null; }
	};

	// Reglas propias, una por línea:
	//   /expresión(captura)/        → agrupa las direcciones que encajan (por lo capturado, si hay paréntesis)
	//   dominio.com ruta:2          → compara solo los 2 primeros tramos de la ruta
	//   dominio.com sin-parametros  → ignora todo lo que va tras «?»
	//   dominio.com parametros:id,page → solo cuentan esos parámetros
	//   dominio.com ignorar:sort,view  → esos parámetros no cuentan
	//   dominio.com sin-ancla       → ignora lo que va tras «#»
	//   dominio.com mayusculas      → no distingue mayúsculas en ese dominio
	const parseUrlRules = (text) => {
		const regex = [], domains = [];
		for (const raw of (text || "").split(/\r?\n/)) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const re = parseRegex(line);
			if (re) { regex.push(re); continue; }
			const [domain, ...opts] = line.split(/\s+/);
			const r = { domain: domain.toLowerCase().replace(/^www\./, ""), depth: null, noQuery: false, noHash: false, only: null, ignore: new Set(), lower: false };
			for (const o of opts.map(x => x.toLowerCase())) {
				if (/^ruta:\d+$/.test(o)) r.depth = Number(o.slice(5));
				else if (o === "sin-parametros") r.noQuery = true;
				else if (o === "sin-ancla") r.noHash = true;
				else if (o.startsWith("parametros:")) r.only = new Set(splitList(o.slice(11)));
				else if (o.startsWith("ignorar:")) splitList(o.slice(8)).forEach(x => r.ignore.add(x));
				else if (o === "mayusculas") r.lower = true;
			}
			domains.push(r);
		}
		return { regex, domains };
	};

	const compiled = new Map();
	const compile = (profile) => {
		const p = { ...PRESETS.inequivoco, ...(profile || {}) };
		const sig = JSON.stringify(p);
		let c = compiled.get(sig);
		if (!c) {
			if (compiled.size > 20) compiled.clear();
			const rules = parseUrlRules(p.urlRules);
			c = {
				...p, sig,
				ignoreSet: new Set(splitList(p.ignoreParams)),
				regexRules: rules.regex,
				domainRules: rules.domains,
				titleRegex: (p.titleRules || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => parseRegex(l) || new RegExp(l.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"), "i"))
			};
			compiled.set(sig, c);
		}
		return c;
	};

	// ---------------------------------------------------------------- análisis

	const SKIP_EXACT = new Set(["about:blank", "about:newtab", "about:home", "about:privatebrowsing", "about:welcome", ""]);

	/**
	 * Analiza una dirección según un perfil. Devuelve:
	 *   { ok:false, reason }                   → no se compara (pestaña vacía, nueva pestaña...)
	 *   { ok:true, strict, loose, site, what } → huellas para comparar
	 */
	const analyze = (rawUrl, profile) => {
		const p = compile(profile);
		const url = (rawUrl || "").trim();
		if (SKIP_EXACT.has(url)) return { ok: false, reason: "vacía" };
		if (/^(data|blob|javascript):/i.test(url)) return { ok: false, reason: "interna" };

		// Modo lectura: misma página en otra vista → dudoso respecto a la original.
		if (url.startsWith("about:reader?")) {
			const inner = new URLSearchParams(url.slice("about:reader?".length)).get("url");
			if (inner) {
				const a = analyze(inner, profile);
				if (a.ok) return { ...a, strict: "reader:" + a.strict };
			}
		}
		// Páginas internas y de otras extensiones: dirección exacta y completa.
		// (Las de pestañas suspendidas guardan la dirección real tras «#», así que no se recorta nada.)
		if (/^(about|moz-extension|chrome|resource|view-source):/i.test(url)) {
			return { ok: true, strict: url, loose: url, site: "Firefox", what: "Página interna" };
		}

		for (const re of p.regexRules) {
			const m = re.exec(url);
			if (m) {
				const k = "regla:" + re.source + ":" + (m.length > 1 ? m.slice(1).join("|") : "");
				return { ok: true, strict: k, loose: k, site: "Regla propia", what: "Regla propia", custom: true };
			}
		}

		let parsed;
		try { parsed = new URL(url); } catch { return { ok: true, strict: url, loose: url, site: "", what: "" }; }
		if (parsed.protocol === "file:") {
			const k = "file://" + safeDecode(parsed.pathname) + parsed.search;
			return { ok: true, strict: k, loose: k, site: "Archivo local", what: "Archivo local" };
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: true, strict: url, loose: url, site: parsed.protocol, what: "" };

		const origHost = parsed.hostname.toLowerCase().replace(/\.$/, "");
		const rule = p.siteRules ? findRule(origHost) : null;
		const bare = origHost.replace(/^www\d?\./, "");
		const dRule = p.domainRules.find(r => bare === r.domain || bare.endsWith("." + r.domain)) || null;

		let host;
		if (rule && rule.host) host = rule.host(origHost);
		else {
			host = p.ignoreWww ? bare : origHost;
			const mm = p.ignoreMobile && MOBILE_PREFIX.exec(host);
			if (mm) host = mm[2];
		}
		const port = parsed.port && !((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) ? ":" + parsed.port : "";
		host += port;
		const scheme = p.ignoreScheme ? "" : parsed.protocol.replace(":", "") + "://";
		const lower = p.ignoreCase || (dRule && dRule.lower);

		if (p.ignorePath) {
			const k = scheme + host;
			return { ok: true, strict: k, loose: k, site: rule ? rule.name : host, what: "Sitio completo" };
		}

		let segs = parsed.pathname.split("/").filter(Boolean).map(s => {
			const d = safeDecode(s);
			return /[/?#%]/.test(d) ? s : d;
		});
		if (rule && rule.lowerSegs) segs = segs.map((s, i) => (i < rule.lowerSegs ? s.toLowerCase() : s));
		if (dRule && dRule.depth !== null) segs = segs.slice(0, dRule.depth);
		if (lower) segs = segs.map(s => s.toLowerCase());

		const u = { host, origHost, segs, params: [], hash: "", keyParams: [], softParams: [] };
		if (p.queryMode !== "ignore" && !(dRule && dRule.noQuery)) {
			for (const [k, v] of parsed.searchParams) u.params.push(lower ? [k.toLowerCase(), v.toLowerCase()] : [k, v]);
		}
		let hash = safeDecode(parsed.hash.replace(/^#/, ""));
		if (dRule && dRule.noHash) hash = "";
		if (lower) hash = hash.toLowerCase();
		u.hash = hash;

		for (const [k, v] of u.params) {
			if (!k) continue;
			const n = k.toLowerCase();
			let cls;
			if (p.ignoreSet.has(n) || (dRule && dRule.ignore.has(n)) || (dRule && dRule.only && !dRule.only.has(n))) cls = "tracking";
			else cls = rule && rule.classify ? rule.classify(k, u) : undefined;
			if (cls === "tracking" && !p.dropTracking && !(p.ignoreSet.has(n) || dRule)) cls = "key";
			if (!cls) cls = p.dropTracking && isTracking(k) ? "tracking" : SOFT_GENERIC.has(n) ? "soft" : "key";
			if (cls === "soft") u.softParams.push([k, v]);
			else if (cls === "key") u.keyParams.push([k, v]);
		}

		const site = rule ? rule.name : host;
		let result = rule && rule.key ? rule.key(u) : null;
		if (result) {
			// Lo que va tras «#» se trata igual que en el resto de webs (salvo reglas que ya lo interpretan).
			if (hash && p.hashMode !== "ignore" && !rule.ownHash) {
				if (isRouteHash(hash) || p.hashMode === "distinct") { result.strict += "#" + hash; result.loose += "#" + hash; }
				else result.strict += "#" + hash;
			}
			return { ok: true, strict: result.strict, loose: result.loose, site, what: result.what || "" };
		}

		const path = segs.length ? "/" + segs.join("/") : "";
		let strictHash = "", looseHash = "";
		if (hash && p.hashMode !== "ignore") {
			if ((rule && rule.keepHash) || isRouteHash(hash) || p.hashMode === "distinct") strictHash = looseHash = "#" + hash;
			else strictHash = "#" + hash; // simple salto a una sección → dudoso
		}
		const strict = scheme + host + path + sortedQuery(u.keyParams.concat(u.softParams)) + strictHash;

		// Huella flexible (dudosos): sin matices, sin mayúsculas, sin index.html, AMP ni versión móvil.
		let looseHost = host.replace(/^amp\./, "").replace(/^www\d?\./, "");
		const mm = MOBILE_ANY.exec(looseHost);
		if (mm) looseHost = mm[2];
		const loosePath = path.toLowerCase().replace(/\/(index|default)\.(html?|php|aspx?)$/, "").replace(/\/amp$/, "");
		const loose = looseHost + loosePath + sortedQuery(u.keyParams.filter(([k]) => k.toLowerCase() !== "amp")) + looseHash;
		return { ok: true, strict, loose, site, what: "" };
	};

	// ---------------------------------------------------------------- títulos

	const normTitle = (t) => (t || "").trim().toLowerCase().replace(/\s+/g, " ");

	// Parecido entre títulos (0-100), por pares de letras. Rápido y sin dependencias.
	const titleSimilarity = (a, b) => {
		a = normTitle(a); b = normTitle(b);
		if (a === b) return 100;
		if (a.length < 2 || b.length < 2) return 0;
		const grams = new Map();
		for (let i = 0; i < a.length - 1; i++) { const g = a.substr(i, 2); grams.set(g, (grams.get(g) || 0) + 1); }
		let hit = 0;
		for (let i = 0; i < b.length - 1; i++) {
			const g = b.substr(i, 2), n = grams.get(g);
			if (n) { hit++; grams.set(g, n - 1); }
		}
		return Math.round((200 * hit) / (a.length + b.length - 2));
	};

	// ---------------------------------------------------------------- explicación

	const PARAM_LABELS = {
		t: "minuto del vídeo", start: "minuto del vídeo", time_continue: "minuto del vídeo",
		list: "lista de reproducción", index: "posición en la lista", tab: "pestaña del documento",
		gid: "hoja de cálculo", img_index: "foto del carrusel", context: "contexto", hl: "idioma", lang: "idioma",
		th: "variante del producto", ref: "origen (ref)", source: "origen", src: "origen", from: "origen"
	};

	// Motivos con nombre corto (para el diagnóstico) y frase (para la explicación).
	const REASONS = {
		identical: "Dirección idéntica",
		scheme: "http / https",
		www: "Con y sin www",
		mobile: "Versión móvil",
		alias: "Mismo sitio, otro nombre",
		slash: "Barra final",
		case: "Mayúsculas",
		siterule: "Regla de la web",
		order: "Orden de parámetros",
		tracking: "Parámetros de rastreo",
		soft: "Matiz (minuto, lista…)",
		anchor: "Sección #",
		route: "Vista tras #",
		queryIgnored: "Parámetros ignorados",
		pathIgnored: "Ruta ignorada",
		custom: "Regla propia",
		reader: "Modo lectura",
		title: "Mismo título",
		titleSimilar: "Título parecido",
		key: "Diferencia de contenido"
	};

	const classifyParam = (rule, name, u, p) => {
		const n = name.toLowerCase();
		if (p.ignoreSet.has(n)) return "tracking";
		let cls = rule && rule.classify ? rule.classify(name, u) : undefined;
		if (cls === "tracking" && !p.dropTracking) cls = "key";
		if (!cls) cls = p.dropTracking && isTracking(name) ? "tracking" : SOFT_GENERIC.has(n) ? "soft" : "key";
		return cls;
	};

	/**
	 * Compara dos direcciones y explica en castellano sencillo por qué son (o no) duplicadas.
	 * Devuelve { level: "exacto"|"seguro"|"dudoso"|"distinto", title, details[], codes[] }
	 */
	const explain = (a, b, profile) => {
		const p = compile(profile);
		const A = analyze(a, profile), B = analyze(b, profile);
		if (!A.ok || !B.ok) return { level: "distinto", title: "No se comparan", details: ["Las pestañas vacías, de nueva pestaña o internas no cuentan como duplicadas."], codes: [] };
		if (a === b) return { level: "exacto", title: "Direcciones idénticas", details: ["Las dos pestañas tienen exactamente la misma dirección."], codes: ["identical"] };

		const details = [], codes = [];
		const add = (code, text) => { if (!codes.includes(code)) codes.push(code); details.push(text); };
		let ua = null, ub = null;
		try { ua = new URL(a); ub = new URL(b); } catch { /* no son web */ }

		if (A.custom && A.strict === B.strict) add("custom", "Las agrupa una de tus reglas propias.");
		else if (ua && ub && /^https?:$/.test(ua.protocol) && /^https?:$/.test(ub.protocol)) {
			const ha = ua.hostname.toLowerCase(), hb = ub.hostname.toLowerCase();
			const rule = p.siteRules ? findRule(ha) : null;
			if (ua.protocol !== ub.protocol) add("scheme", p.ignoreScheme ? "Una usa http y la otra https (mismo sitio, con y sin cifrado)." : "Una usa http y la otra https, y lo tienes configurado como distinto.");
			if (ha !== hb) {
				const noW = h => h.replace(/^www\d?\./, "");
				const noM = h => noW(h).replace(/^(m|mobile|mbasic|touch|old|new|np)\./, "").replace(/\.m\./, ".");
				if (noW(ha) === noW(hb)) add("www", `Una lleva «www.» y la otra no (${ha} / ${hb}).`);
				else if (noM(ha) === noM(hb)) add("mobile", `Una es la versión móvil u otra variante del sitio (${ha} / ${hb}).`);
				else add("alias", `El sitio se escribe distinto (${ha} / ${hb}), pero ${rule ? rule.name : "es el mismo"} los trata como el mismo.`);
			}
			if (ua.pathname !== ub.pathname) {
				const pa = ua.pathname.replace(/\/$/, ""), pb = ub.pathname.replace(/\/$/, "");
				if (p.ignorePath) add("pathIgnored", "La ruta es distinta, pero tienes activado «ignorar la ruta» (solo cuenta el sitio).");
				else if (pa === pb) add("slash", "Solo cambia la barra «/» del final.");
				else if (pa.toLowerCase() === pb.toLowerCase()) add("case", p.ignoreCase ? "Solo cambian mayúsculas/minúsculas (lo tienes configurado como igual)." : "Solo cambian mayúsculas/minúsculas en la ruta.");
				else add("siterule", "La ruta se escribe distinta, pero apunta al mismo contenido (" + (A.what || A.site) + ").");
			}
			const qa = new Map(ua.searchParams), qb = new Map(ub.searchParams);
			const names = new Set([...qa.keys(), ...qb.keys()]);
			const tracking = [], soft = [], key = [];
			const uFake = { segs: ua.pathname.split("/").filter(Boolean), origHost: ha, params: [...ua.searchParams] };
			for (const n of names) {
				if (qa.get(n) === qb.get(n)) continue;
				if (p.ignoreCase && (qa.get(n) || "").toLowerCase() === (qb.get(n) || "").toLowerCase()) continue;
				const cls = classifyParam(rule, n, uFake, p);
				(cls === "tracking" ? tracking : cls === "soft" ? soft : key).push(n);
			}
			if (names.size && !tracking.length && !soft.length && !key.length && [...ua.searchParams.keys()].join() !== [...ub.searchParams.keys()].join()) add("order", "Los mismos parámetros, en distinto orden.");
			if (p.queryMode === "ignore" && (tracking.length || soft.length || key.length)) add("queryIgnored", "Lo que va tras «?» es distinto, pero tienes activado «ignorar parámetros».");
			else {
				if (tracking.length) add("tracking", `Cambian parámetros de rastreo o irrelevantes (${tracking.join(", ")}), que no alteran la página.`);
				if (soft.length) add("soft", `Cambia: ${[...new Set(soft.map(n => PARAM_LABELS[n] || n))].join(", ")}.`);
				if (key.length) add("key", `Cambia algo que sí define la página: ${key.join(", ")}.`);
			}
			if (ua.hash !== ub.hash) {
				const h = (ua.hash || ub.hash).slice(1);
				if (p.hashMode === "ignore") add("anchor", "Cambia lo que va tras «#», y lo tienes configurado para ignorarlo.");
				else if (isRouteHash(h) || (rule && rule.keepHash)) add("route", "Cambia lo que va tras «#», que en esta web indica otra vista o elemento.");
				else add("anchor", "Solo cambia el salto a una sección (#…): mismo documento, otra posición.");
			}
		}
		if (a.startsWith("about:reader?") !== b.startsWith("about:reader?")) add("reader", "Una está en modo lectura.");

		if (A.strict === B.strict) return { level: "seguro", title: "Misma página", details, codes };
		if (p.showDoubtful && A.loose === B.loose) return { level: "dudoso", title: "Dudoso: casi la misma página", details, codes };
		return { level: "distinto", title: "Páginas distintas", details, codes };
	};

	const api = { analyze, explain, compile, findRule, RULES, PRESETS, REASONS, isTracking, youtubeSeconds, titleSimilarity, normTitle };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	else root.DupNormalize = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
