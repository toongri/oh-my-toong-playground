// In-page layout lint for hand-authored HTML reports with inline SVG.
// lint.sh appends a call: __hrLint({ checks: [...], theme: "light", sourceText: "..."|null }).
// Returns { viewport, theme, scrollWidth, innerWidth, totals: { check: { severity: n } }, findings: [...] }.
// findings lists at most 100 per check per run; totals counts all of them.
// Each finding: { check, severity: "error"|"warn"|"info", viewport, theme, where, text, detail }.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- lint.sh가 이 파일 뒤에 호출문을 이어붙여 평가하므로 파일 안에서는 호출되지 않는다
async function __hrLint(opts) {
  opts = opts || {};
  const checks = new Set(opts.checks || ["overflow", "svg", "clip", "contrast"]); // also "svgsize", "graph", "prose", "source"
  const theme = opts.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const vp = innerWidth;
  const findings = [];
  const MAX_PER_CHECK = 100; // findings listed per check per run; totals always count every finding
  const counts = {};
  const totals = {}; // { check: { error|warn|info: n } }

  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // let transitions started by --state settle so dimmed elements are measured at their resting opacity
  const running = document.getAnimations ? document.getAnimations().filter((a) => a.effect && a.effect.getTiming().iterations !== Infinity) : [];
  await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 3000))]);
  const startY = scrollY;

  // ---------- helpers ----------
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
  const snippet = (el) => ((el && el.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 60);
  function where(el) {
    if (!el || !el.closest) return "";
    const parts = [];
    const fig = el.closest("figure");
    if (fig) parts.push("figure#" + (Array.prototype.indexOf.call(document.querySelectorAll("figure"), fig) + 1));
    const path = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 4; i++, n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) { s += "#" + n.id; path.unshift(s); break; }
      const c = n.getAttribute("class");
      if (c && c.trim()) s += "." + c.trim().split(/\s+/).slice(0, 2).join(".");
      path.unshift(s);
    }
    parts.push(path.join(" > "));
    return parts.join(" ");
  }
  function add(check, severity, el, detail) {
    counts[check] = (counts[check] || 0) + 1;
    totals[check] = totals[check] || {};
    totals[check][severity] = (totals[check][severity] || 0) + 1;
    if (counts[check] > MAX_PER_CHECK) return;
    const top = el === document.documentElement || el === document.body;
    findings.push({ check, severity, viewport: vp, theme, where: top ? "page" : where(el), text: top ? "" : snippet(el), detail });
  }
  function rendered(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  function inSvgResource(el) {
    return !!el.closest("defs, marker, clipPath, mask, pattern, symbol");
  }
  function scrollAncestor(el) {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll") return p;
    }
    return null;
  }
  function opacityChain(el) {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || "1");
    return o;
  }
  // Text "ink box": horizontal extent from layout, vertical extent = 0.9em around the box centre,
  // so line boxes of stacked lines do not count as overlapping when the glyphs do not.
  function inkBox(t) {
    const r = t.getBoundingClientRect();
    const px = fontPx(t);
    const cy = r.top + r.height / 2;
    const h = Math.min(r.height, px * 0.9);
    return { left: r.left, right: r.right, top: cy - h / 2, bottom: cy + h / 2 };
  }
  function fontPx(t) {
    const fs = parseFloat(getComputedStyle(t).fontSize) || 0;
    const m = t.getScreenCTM ? t.getScreenCTM() : null;
    const s = m ? Math.hypot(m.a, m.b) : 1;
    return fs * s;
  }
  const inter = (a, b, tol) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > tol &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tol;

  // colour parsing through canvas so any CSS colour syntax resolves to sRGB
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  function parse(c) {
    if (!c || c === "none" || c === "transparent" || c.indexOf("url(") === 0) return null;
    cx.fillStyle = "#010203";
    cx.fillStyle = c;
    if (cx.fillStyle === "#010203" && c.replace(/\s/g, "") !== "#010203") return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  // background behind an HTML element: composite ancestor background colours bottom-up
  function htmlBackground(el) {
    const layers = [];
    let image = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") image = true;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = layers[i].a >= 1 ? layers[i] : over(layers[i], base);
    return { color: base, image };
  }
  // background behind an SVG text: its halo stroke, else the shapes painted before it under its centre
  function svgBackground(t) {
    const cs = getComputedStyle(t);
    const halo = parse(cs.stroke);
    if ((cs.paintOrder || "").indexOf("stroke") === 0 && halo && halo.a > 0 && parseFloat(cs.strokeWidth) >= 2.5) {
      return { color: halo.a >= 1 ? halo : over(halo, htmlBackground(t.ownerSVGElement).color), image: false, halo: true };
    }
    t.scrollIntoView({ block: "center", inline: "center" });
    const r = t.getBoundingClientRect();
    const px = r.left + r.width / 2, py = r.top + r.height / 2;
    const stack = document.elementsFromPoint(px, py);
    const layers = [];
    for (const c of stack) {
      if (c === t || t.contains(c)) continue;
      const tag = c.tagName.toLowerCase();
      if (!(c instanceof SVGElement) || tag === "svg") {
        if (!c.contains(t)) continue; // an unrelated HTML box: ignore
        const hb = htmlBackground(c);
        let base = hb.color;
        for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
        return { color: base, image: hb.image };
      }
      if (c.contains(t)) continue; // a <g> around the text paints nothing itself
      if (!(t.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING)) continue; // painted above the text
      if (tag === "text" || tag === "tspan" || inSvgResource(c)) continue;
      // only a filled area counts as background; a stroke that crosses the label is reported by the stroke check
      const cm = c.getScreenCTM ? c.getScreenCTM() : null;
      if (typeof c.isPointInFill !== "function" || !cm) continue;
      if (!c.isPointInFill(new DOMPoint(px, py).matrixTransform(cm.inverse()))) continue;
      const ccs = getComputedStyle(c);
      const f = parse(ccs.fill);
      if (!f || f.a === 0) continue;
      f.a *= parseFloat(ccs.fillOpacity || "1") * parseFloat(ccs.opacity || "1");
      if (f.a <= 0) continue;
      layers.push(f);
      if (f.a >= 1) break;
    }
    let base = htmlBackground(t.ownerSVGElement).color;
    for (let i = layers.length - 1; i >= 0; i--) base = layers[i].a >= 1 ? layers[i] : over(layers[i], base);
    return { color: base, image: false };
  }

  // ---------- (a) page-level horizontal overflow ----------
  if (checks.has("overflow")) {
    const sw = document.documentElement.scrollWidth;
    if (sw > innerWidth + 1) {
      add("page-overflow", "error", document.documentElement, `page scrollWidth ${sw} > innerWidth ${innerWidth}`);
      const offenders = [];
      document.body.querySelectorAll("*").forEach((el) => {
        if (el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") return;
        if (!rendered(el)) return;
        const r = el.getBoundingClientRect();
        if (r.right <= innerWidth + 1 && r.left >= -1) return;
        if (scrollAncestor(el)) return;
        let p = el.parentElement, clipped = false;
        for (; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "hidden" || o === "clip") { clipped = true; break; }
        }
        if (clipped) return;
        if (offenders.some((o) => o.contains(el))) return;
        offenders.push(el);
      });
      offenders.slice(0, 15).forEach((el) => {
        const r = el.getBoundingClientRect();
        add("page-overflow-source", "error", el, `element spans x ${Math.round(r.left)}..${Math.round(r.right)} outside the ${innerWidth}px viewport and has no scroll container`);
      });
    }
  }

  // ---------- (b)(c) SVG text overlap / outside figure / on strokes / size ----------
  // "svg" runs every SVG check; "svgsize" runs only the rendered-size check (used at phone width)
  if (checks.has("svg") || checks.has("svgsize")) {
    const full = checks.has("svg");
    const svgs = Array.from(document.querySelectorAll("svg")).filter((s) => !s.parentElement.closest("svg") && rendered(s));
    for (const svg of svgs) {
      const sr = svg.getBoundingClientRect();
      if (sr.width < 24 || sr.height < 24) continue; // icons / hidden marker holders
      const texts = Array.from(svg.querySelectorAll("text")).filter((t) => !inSvgResource(t) && rendered(t) && t.textContent.trim());
      const boxes = texts.map(inkBox);
      // size
      texts.forEach((t) => {
        const px = fontPx(t);
        if (px < 11) add("svg-text-small", "error", t, `renders at ${px.toFixed(1)}px (< 11px floor)`);
        else if (px < 12 && HANGUL.test(t.textContent)) add("svg-text-small-korean", "warn", t, `Korean text renders at ${px.toFixed(1)}px (< 12px floor for Hangul)`);
      });
      if (!full) continue;
      // outside the drawing
      texts.forEach((t, i) => {
        const b = boxes[i];
        if (b.left < sr.left - 1 || b.right > sr.right + 1 || b.top < sr.top - 1 || b.bottom > sr.bottom + 1)
          add("svg-text-outside", "error", t, "text extends beyond its <svg> viewport (clipped or touching the frame)");
      });
      // overlap between labels
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        if (inter(boxes[i], boxes[j], 1)) add("svg-text-overlap", "error", texts[i], `overlaps text "${snippet(texts[j])}"`);
      }
      // labels sitting on a stroke (lines, arrows, box outlines)
      const shapes = Array.from(svg.querySelectorAll("line, path, polyline, polygon, rect, circle, ellipse")).filter((g) => {
        if (inSvgResource(g) || !rendered(g)) return false;
        const cs = getComputedStyle(g);
        const st = parse(cs.stroke);
        return st && st.a > 0 && parseFloat(cs.strokeWidth) > 0 && parseFloat(cs.strokeOpacity || "1") > 0 && typeof g.getTotalLength === "function";
      });
      // filled shapes, in paint order, that can hide a stroke drawn before them (badges, masks, chips)
      const allShapes = Array.from(svg.querySelectorAll("line, path, polyline, polygon, rect, circle, ellipse")).filter((g) => !inSvgResource(g) && rendered(g));
      const fillers = allShapes.filter((g) => { const f = parse(getComputedStyle(g).fill); return f && f.a >= 0.9 && parseFloat(getComputedStyle(g).fillOpacity || "1") >= 0.9; });
      const occluded = (g, q) => {
        const gi = allShapes.indexOf(g);
        for (const o of fillers) {
          if (allShapes.indexOf(o) <= gi) continue;
          const r = o.getBoundingClientRect();
          if (q.x < r.left || q.x > r.right || q.y < r.top || q.y > r.bottom) continue;
          const om = o.getScreenCTM();
          if (om && o.isPointInFill(new DOMPoint(q.x, q.y).matrixTransform(om.inverse()))) return true;
        }
        return false;
      };
      const hitPairs = new Set();
      for (const g of shapes) {
        const gr = g.getBoundingClientRect();
        const pad = 4;
        const cand = [];
        boxes.forEach((b, i) => {
          if (b.right < gr.left - pad || b.left > gr.right + pad || b.bottom < gr.top - pad || b.top > gr.bottom + pad) return;
          cand.push(i);
        });
        if (!cand.length) continue;
        let len;
        try { len = g.getTotalLength(); } catch { continue; }
        const m = g.getScreenCTM();
        if (!m || !len) continue;
        const step = Math.max(1.5, len / 1500);
        const sp = svg.createSVGPoint();
        for (let d = 0; d <= len; d += step) {
          const p = g.getPointAtLength(d);
          sp.x = p.x; sp.y = p.y;
          const q = sp.matrixTransform(m);
          for (const i of cand) {
            const b = boxes[i];
            if (q.x > b.left + 1 && q.x < b.right - 1 && q.y > b.top + 1 && q.y < b.bottom - 1) {
              const key = i + ":" + shapes.indexOf(g);
              if (hitPairs.has(key) || occluded(g, q)) continue;
              hitPairs.add(key);
              const tcs = getComputedStyle(texts[i]);
              const halo = (tcs.paintOrder || "").indexOf("stroke") === 0 && tcs.stroke !== "none" && parseFloat(tcs.strokeWidth) >= 2.5;
              add(halo ? "svg-text-on-stroke-halo" : "svg-text-on-stroke", halo ? "warn" : "error", texts[i],
                `a <${g.tagName.toLowerCase()}> stroke passes through this label${halo ? " (label has a halo; check it reads cleanly)" : ""}`);
            }
          }
        }
      }
    }
  }

  // ---------- (d) clipped / spilling HTML, and figures that scroll sideways ----------
  if (checks.has("clip")) {
    document.body.querySelectorAll("*").forEach((el) => {
      if (el instanceof SVGElement) return;
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") return;
      if (!rendered(el) || el.clientWidth <= 4) return;
      const cs = getComputedStyle(el);
      const xOver = el.scrollWidth - el.clientWidth > 2;
      const yOver = el.scrollHeight - el.clientHeight > 2 && el.clientHeight > 4;
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") {
        if (xOver && el.querySelector("svg, table, pre")) {
          const frac = el.clientWidth / el.scrollWidth;
          add("figure-scrolls", frac < 0.6 ? "warn" : "info", el,
            `scrolls sideways: ${Math.round(frac * 100)}% of the content (${el.clientWidth}/${el.scrollWidth}px) is visible at rest; if this is a key figure, give it a narrow layout`);
        }
        return;
      }
      if (xOver) {
        if (cs.overflowX === "hidden" || cs.overflowX === "clip") add("html-clipped", "error", el, `content ${el.scrollWidth}px wide is cut to ${el.clientWidth}px (overflow-x: ${cs.overflowX})`);
        else if (!scrollAncestor(el) && cs.display !== "inline") add("html-overflow", "error", el, `content ${el.scrollWidth}px wide spills out of its ${el.clientWidth}px box with no scroll container`);
      }
      if (yOver && (cs.overflowY === "hidden" || cs.overflowY === "clip")) add("html-clipped", "error", el, `content ${el.scrollHeight}px tall is cut to ${el.clientHeight}px (overflow-y: ${cs.overflowY})`);
      if (cs.textOverflow === "ellipsis" && xOver) add("html-clipped", "error", el, "text is truncated with an ellipsis");
    });
  }

  // ---------- (f) directed graphs built from HTML, SVG graphs without edges ----------
  if (checks.has("graph")) {
    const ARROW = /[↓→←↑⇒⇐⇓⇑↔]/g;
    const TABLE_PART = /^(table|thead|tbody|tfoot|tr|td|th|caption|colgroup|figcaption|svg)$/;
    const isBox = (el) => {
      if (TABLE_PART.test(el.tagName.toLowerCase()) || !rendered(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) return false;
      const cs = getComputedStyle(el);
      const border = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs["border" + s + "Width"]) > 0 && cs["border" + s + "Style"] !== "none");
      const bg = parse(cs.backgroundColor);
      return border || (bg && bg.a > 0);
    };
    const bodyText = (root) => {
      let s = "";
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) if (!n.parentElement.closest("figcaption, script, style")) s += n.nodeValue + " ";
      return s;
    };
    const graphLike = (root, needArrowAndBoxes) => {
      const arrows = (bodyText(root).match(ARROW) || []).length;
      const parents = new Set([root]);
      root.querySelectorAll("*").forEach((e) => { if (!e.closest("figcaption, svg")) parents.add(e); });
      let maxBoxes = 0;
      parents.forEach((p) => { const n = Array.from(p.children).filter(isBox).length; if (n > maxBoxes) maxBoxes = n; });
      if (needArrowAndBoxes) return arrows >= 1 && maxBoxes >= 2 ? `${arrows} arrow glyph(s) between ${maxBoxes} sibling boxes` : "";
      if (maxBoxes >= 3) return `${maxBoxes} sibling boxes laid out as nodes`;
      if (arrows >= 2) return `${arrows} arrow glyphs in the text`;
      if (arrows >= 1 && maxBoxes >= 2) return `${arrows} arrow glyph(s) between ${maxBoxes} sibling boxes`;
      return "";
    };
    document.querySelectorAll("figure").forEach((fig) => {
      if (!rendered(fig) || fig.querySelector("svg, img, canvas, video")) return;
      const why = graphLike(fig, false);
      if (why) add("figure-graph-nosvg", "error", fig, `<figure> without <svg> draws a graph from HTML (${why}); HTML boxes reflow on a phone and change the diagram. Redraw it as inline SVG with drawn edges`);
    });
    document.querySelectorAll('[role="img"]').forEach((el) => {
      if (el instanceof SVGElement || el.closest("figure") || !rendered(el) || el.querySelector("svg")) return;
      const why = graphLike(el, true);
      if (why) add("figure-graph-nosvg", "error", el, `role="img" HTML block draws a graph (${why}); redraw it as inline SVG with drawn edges`);
    });
    Array.from(document.querySelectorAll("svg")).filter((s) => !s.parentElement.closest("svg") && rendered(s)).forEach((svg) => {
      const sr = svg.getBoundingClientRect();
      if (sr.width < 24 || sr.height < 24) return;
      const live = (g) => !inSvgResource(g) && rendered(g);
      const boxes = Array.from(svg.querySelectorAll("rect, polygon, ellipse")).filter((g) => {
        if (!live(g)) return false;
        const r = g.getBoundingClientRect();
        if (r.width < 40 || r.height < 20 || (r.width >= sr.width - 2 && r.height >= sr.height - 2)) return false;
        const cs = getComputedStyle(g);
        return !!(parse(cs.fill) || parse(cs.stroke));
      });
      const edges = Array.from(svg.querySelectorAll("path, line, polyline")).filter((g) => {
        if (!live(g)) return false;
        const cs = getComputedStyle(g);
        const st = parse(cs.stroke);
        return st && st.a > 0 && parseFloat(cs.strokeWidth) > 0;
      });
      if (boxes.length >= 3 && edges.length === 0) add("svg-no-edges", "warn", svg, `${boxes.length} box shapes and no path/line/polyline edge: boxes alone do not show how they relate`);
    });
  }

  // ---------- (g) prose that is not the source's: author first person, authoring notes ----------
  const proseNodes = [];
  if (checks.has("prose") || checks.has("source")) {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement;
      if (!n.nodeValue.trim() || !el || el.closest("script, style, noscript, template, title")) continue;
      proseNodes.push({ el, text: n.nodeValue });
    }
  }
  if (checks.has("prose")) {
    const FIRST = /(?<![가-힣])(저는|제가|저의|나는|내가)(?![가-힣])|\bI (?:decided|chose|think|believe|recommend|suggest|found)\b/;
    const NOTES = /NOTES\.md|SKILL\.md|authoring notes?|작성 노트|저작 노트/i;
    for (const { el, text } of proseNodes) {
      const f = text.match(FIRST);
      if (f) add("author-first-person", "warn", el, `author first person "${f[0]}": the page speaks as the source, not as its author`);
      const m = text.match(NOTES);
      if (m) add("authoring-notes-mention", "warn", el, `mentions "${m[0]}": authoring notes do not belong on the page`);
    }
  }

  // ---------- (h) numbers and dates that the source does not contain ----------
  if (checks.has("source") && typeof opts.sourceText === "string") {
    // canonical tokens: d = full date, md = month-day, t = time, n = number (commas and leading zeros dropped)
    const tokens = (s, isSource) => {
      const out = [];
      s = s.replace(/(?<!\d)(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?(?!\d)/g, (m, y, mo, d) => {
        out.push({ k: "d", v: `${+y}-${+mo}-${+d}`, raw: m.trim() });
        if (isSource) out.push({ k: "md", v: `${+mo}-${+d}` });
        return " ";
      });
      s = s.replace(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (m, mo, d) => { out.push({ k: "md", v: `${+mo}-${+d}`, raw: m.trim() }); return " "; });
      s = s.replace(/(?<![\d:])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/g, (m, h, mi) => {
        out.push({ k: "t", v: `${+h}:${mi}`, raw: m });
        return " ";
      });
      const re = /(?<![A-Za-z_\d])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
      for (const m of s.match(re) || []) {
        const v = m.replace(/,/g, "").replace(/^0+(?=\d)/, "");
        out.push({ k: "n", v, raw: m });
      }
      return out;
    };
    const known = new Set(tokens(opts.sourceText, true).map((t) => t.k + ":" + t.v));
    const IGNORE = /(?:그림|표|Figure|Fig\.?|Table|Step|Section|§|#)\s*\d+(?:[.-]\d+)*/gi;
    const mast = (el) => !!el.closest("header, .mast, .masthead, .kicker");
    const reported = new Set();
    for (const { el, text } of proseNodes) {
      const t0 = text.trim();
      if (/^\(?\d{1,2}\)?\.?$/.test(t0)) continue; // badge or list number
      const cleaned = t0.replace(IGNORE, " ").replace(/^\(?\d{1,2}(?:\.\d+)*[.)]\s/, " ");
      for (const t of tokens(cleaned, false)) {
        if (known.has(t.k + ":" + t.v)) continue;
        const isDate = t.k === "d" || t.k === "md";
        const check = isDate && mast(el) ? "masthead-date-not-in-source" : "number-not-in-source";
        const key = check + "|" + t.k + ":" + t.v;
        if (reported.has(key)) continue;
        reported.add(key);
        add(check, "warn", el, `${isDate ? "date" : t.k === "t" ? "time" : "number"} "${t.raw}" does not occur in the source; ${check === "masthead-date-not-in-source" ? "show only dates the source gives" : "quote the source's number, or state that you computed it"}`);
      }
    }
  }

  // ---------- (e) text contrast ----------
  if (checks.has("contrast")) {
    const seen = new Set();
    const els = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      let el = n.parentElement;
      if (!el || el.closest("script, style, noscript, template, title, desc")) continue;
      if (el instanceof SVGElement && el.tagName.toLowerCase() === "tspan") el = el.closest("text") || el;
      if (seen.has(el)) continue;
      seen.add(el);
      els.push(el);
    }
    const max = opts.maxContrast || 800;
    let sampled = 0, dimmed = 0, unknown = 0;
    for (const el of els.slice(0, max)) {
      if (!rendered(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      const op = opacityChain(el);
      if (op < 0.5) { dimmed++; continue; }
      const isSvg = el instanceof SVGElement;
      const cs = getComputedStyle(el);
      const fg = parse(isSvg ? cs.fill : cs.color);
      if (!fg) continue;
      const bg = isSvg ? svgBackground(el) : htmlBackground(el);
      if (bg.image) unknown++;
      const fgc = Object.assign({}, fg, { a: fg.a * op * (isSvg ? parseFloat(cs.fillOpacity || "1") : 1) });
      const eff = fgc.a >= 1 ? fgc : over(fgc, bg.color);
      const cr = ratio(eff, bg.color);
      const px = isSvg ? fontPx(el) : parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = px >= 24 || (px >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      sampled++;
      if (cr < need) add("contrast", "error", el, `contrast ${cr.toFixed(2)}:1 < ${need}:1 (text ${hex(eff)} on ${hex(bg.color)}${bg.image ? ", background image present" : ""}, ${px.toFixed(1)}px/${weight})`);
    }
    findings.push({ check: "contrast-sample", severity: "info", viewport: vp, theme, where: "", text: "",
      detail: `sampled ${sampled} text elements; skipped ${dimmed} intentionally dimmed (opacity < 0.5); ${unknown} sat on a background image (ratio uses the colour only)` });
    window.scrollTo(0, startY);
  }

  for (const k in counts) if (counts[k] > MAX_PER_CHECK)
    findings.push({ check: k, severity: "info", viewport: vp, theme, where: "", text: "", detail: `${counts[k] - MAX_PER_CHECK} more ${k} findings not listed` });

  return { viewport: vp, theme, scrollWidth: document.documentElement.scrollWidth, innerWidth, totals, findings };
}
