/* Structured session-ledger records.  This file deliberately uses Node
 * builtins only: the shell wrapper supplies the shared per-ledger lock. */
import { readFileSync, writeFileSync, renameSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";

const PREFIX = "OMT_EVENT::";
const ESCAPE = "OMT_ESC::";
const HEADERS = ["Now", "Decisions", "User Corrections (verbatim)", "Pending", "Pointers", "Learnings"];
const MIN_BYTES = 64;
const MAX_BYTES = 200000;

const fail = (message) => { process.stderr.write(`omt-ledger: ${message}\n`); process.exitCode = 1; throw new Error(message); };
const skeleton = () => HEADERS.map((h) => `## ${h}`).join("\n") + "\n";

function sectionize(text) {
  const lines = text.split("\n");
  const starts = [];
  let expected = 0;
  for (let i = 0; i < lines.length && expected < HEADERS.length; i += 1) if (lines[i] === `## ${HEADERS[expected]}`) { starts.push({ n: expected, i }); expected += 1; }
  if (expected !== HEADERS.length) fail("ledger headers are missing or out of order");
  const sections = new Map();
  starts.forEach((s, i) => sections.set(HEADERS[s.n], lines.slice(s.i + 1, i + 1 < starts.length ? starts[i + 1].i : lines.length)));
  return { lines, starts, sections };
}

function decodeEvents(parsed) {
  const events = [];
  for (const [section, lines] of parsed.sections) for (const line of lines) {
    if (line.startsWith(PREFIX)) {
      let value;
      try { value = JSON.parse(line.slice(PREFIX.length)); } catch { fail("malformed OMT_EVENT marker"); }
      if (!value || typeof value !== "object" || typeof value.type !== "string") fail("invalid OMT_EVENT schema");
      if (value.type === "record") {
        if (!validId(value.id) || !["user", "agent", "hook"].includes(value.source) || !validString(value.scope) || typeof value.payload !== "string" || !Array.isArray(value.refs) || value.refs.some((x) => typeof x !== "string")) fail("invalid record event schema");
      } else if (value.type === "resolve") {
        if (!validString(value.target) || !["user", "agent", "hook"].includes(value.source) || typeof value.reason !== "string") fail("invalid resolve event schema");
      } else if (value.type === "supersede") {
        if (!validString(value.target) || !validString(value.replacement) || !["user", "agent", "hook"].includes(value.source)) fail("invalid supersede event schema");
      } else if (value.type === "checkpoint") {
        if (["goal", "scope", "user_updates", "done", "pending", "next"].some((k) => !validString(value[k])) || !Array.isArray(value.refs) || value.refs.some((x) => typeof x !== "string")) fail("invalid checkpoint event schema");
      } else fail(`unknown OMT_EVENT type '${value.type}'`);
      events.push({ ...value, section });
    }
  }
  const ids = new Set();
  for (const e of events) if (e.id) { if (ids.has(e.id)) fail(`duplicate id '${e.id}'`); ids.add(e.id); }
  const recordIds = new Set(events.filter((e) => e.type === "record").map((e) => e.id));
  for (const e of events) {
    if ((e.type === "resolve" || e.type === "supersede") && !recordIds.has(e.target)) fail(`lifecycle target '${e.target}' is unknown`);
    if (e.type === "supersede" && !recordIds.has(e.replacement)) fail(`lifecycle replacement '${e.replacement}' is unknown`);
  }
  return events;
}

function readLedger(file) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") text = skeleton(); else throw e; }
  const parsed = sectionize(text);
  return { text, parsed, events: decodeEvents(parsed) };
}

function validString(v) { return typeof v === "string" && v.trim() !== ""; }
function validId(v) { return validString(v) && /^[A-Za-z0-9_-]{1,200}$/.test(v); }
function readStdin() { return readFileSync(0, "utf8"); }
function eventLine(v) { return PREFIX + JSON.stringify(v);
}
function insert(file, section, line) {
  const state = readLedger(file);
  const lines = state.text.split("\n");
  const sectionIndex = HEADERS.indexOf(section); const start = state.parsed.starts.find((s) => s.n === sectionIndex)?.i ?? -1;
  if (start < 0) fail(`section '${section}' not found`);
  const next = state.parsed.starts.find((s) => s.n === sectionIndex + 1); const end = next?.i ?? lines.length;
  lines.splice(end, 0, line);
  writeAtomic(file, lines.join("\n"));
}
function replaceSection(file, section, line) {
  const state = readLedger(file); const lines = state.text.split("\n"); const sectionIndex = HEADERS.indexOf(section);
  const start = state.parsed.starts.find((s) => s.n === sectionIndex)?.i ?? -1; const next = state.parsed.starts.find((s) => s.i > start && s.n === sectionIndex + 1); const end = next?.i ?? lines.length;
  if (start < 0) fail(`section '${section}' not found`);
  lines.splice(start + 1, end - start - 1, line); writeAtomic(file, lines.join("\n"));
}
function writeAtomic(file, text) {
  const dir = mkdtempSync(join(dirname(file), ".ledger-tmp-"));
  const tmp = join(dir, "ledger");
  try { writeFileSync(tmp, text, "utf8"); renameSync(tmp, file); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function activeMap(events) {
  const records = new Map(events.filter((e) => e.type === "record" && e.id).map((e) => [e.id, { ...e, status: "active" }]));
  for (const e of events) {
    if (e.type === "resolve" && records.has(e.target)) records.get(e.target).status = "resolved";
    if (e.type === "supersede" && records.has(e.target)) { records.get(e.target).status = "superseded"; records.get(e.target).supersededBy = e.replacement; }
  }
  return records;
}
function parseOptions(args) {
  const o = { refs: [] }; const take = (i, a) => { if (i + 1 >= args.length || args[i + 1].startsWith("--")) fail(`option '${a}' requires a value`); return args[i + 1]; };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]; if (a === "--ref") { o.refs.push(take(i, a)); i += 1; } else if (a === "--id") { o.id = take(i, a); i += 1; } else if (a === "--source") { o.source = take(i, a); i += 1; } else if (a === "--scope") { o.scope = take(i, a); i += 1; } else if (a === "--by") { o.by = take(i, a); i += 1; } else if (a === "--section") { o.section = take(i, a); i += 1; } else if (a === "--active") o.active = true; else if (a === "--max-bytes") { o.maxBytes = Number(take(i, a)); i += 1; } else if (a === "--offset") { o.offset = Number(take(i, a)); i += 1; } else if (a.startsWith("--")) fail(`unknown option '${a}'`); else if (!o.positional) o.positional = a; else fail("unexpected argument");
  } return o;
}
function ensureSource(s) { if (!["user", "agent", "hook"].includes(s)) fail("source must be user, agent, or hook"); }

function renderBlocks(blocks, max, offset) {
  const canonical = Buffer.from(`${blocks.join("\n")}\n`, "utf8");
  if (!Number.isInteger(offset) || offset < 0 || offset > canonical.length || (offset < canonical.length && (canonical[offset] & 0xc0) === 0x80)) fail("--offset is not a UTF-8 boundary");
  if (offset === canonical.length) return "";
  let end = Math.min(canonical.length, offset + max);
  const boundary = (n) => n === canonical.length || n === 0 || (canonical[n] & 0xc0) !== 0x80;
  while (end > offset && (!boundary(end) || (() => { const more = end < canonical.length; const footer = more ? `${canonical[end - 1] === 10 ? "" : "\n"}continuation: offset=${end} max-bytes=${max}\n` : ""; return end - offset + Buffer.byteLength(footer, "utf8") > max; })())) end -= 1;
  if (end === offset) fail("--max-bytes is too small for pagination metadata");
  const more = end < canonical.length;
  const footer = more ? `${canonical[end - 1] === 10 ? "" : "\n"}continuation: offset=${end} max-bytes=${max}\n` : "";
  return Buffer.concat([canonical.subarray(offset, end), Buffer.from(footer, "utf8")]).toString("utf8");
}
function projection(record) {
  return [`id: ${record.id}`, `source: ${record.source}`, `scope: ${record.scope}`, `status: ${record.status}`, ...(record.supersededBy ? [`superseded-by: ${record.supersededBy}`] : []), `refs: ${(record.refs || []).join(",") || "none"}`, "payload:", record.payload].join("\n");
}
function unescapeLine(line) {
  const remainder = line.slice(ESCAPE.length);
  let ultimate = remainder;
  while (ultimate.startsWith(ESCAPE)) ultimate = ultimate.slice(ESCAPE.length);
  return line.startsWith(ESCAPE) && (ultimate.startsWith(PREFIX) || HEADERS.includes(ultimate.slice(3))) ? remainder : line;
}
function checkpointProjection(event) {
  return ["checkpoint:", `goal: ${event.goal}`, `scope: ${event.scope}`, `user_updates: ${event.user_updates}`, `done: ${event.done}`, `pending: ${event.pending}`, `next: ${event.next}`, `refs: ${(event.refs || []).join(",") || "none"}`].join("\n");
}
function sectionBlocks(state, section, records, activeOnly) {
  const blocks = [];
  for (const line of state.parsed.sections.get(section)) {
    if (!line) continue;
    if (line.startsWith(PREFIX)) {
      const raw = JSON.parse(line.slice(PREFIX.length));
      const event = state.events.find((e) => e.section === section && e.type === raw.type && (e.id === raw.id || e.target === raw.target));
      if (event?.type === "record" && records.has(event.id) && (!activeOnly || records.get(event.id).status === "active")) blocks.push(projection(records.get(event.id)));
      else if (event?.type === "checkpoint") blocks.push(checkpointProjection(event));
      else if (event?.type !== "record" && !activeOnly) blocks.push(`${event?.type || "structured event"} (lifecycle metadata)`);
    } else blocks.push(unescapeLine(line));
  }
  return blocks.length ? blocks : ["(empty section)"];
}
function command(cmd, args, file) {
  const o = parseOptions(args); const state = readLedger(file); const records = activeMap(state.events);
  if (cmd === "record") {
    if (!HEADERS.includes(o.positional) || o.positional === "Now" || !validString(o.scope)) fail("record requires a durable non-Now section and nonblank --scope"); ensureSource(o.source);
    const id = o.id || randomUUID(); if (!validId(id) || state.events.some((e) => e.id === id)) fail(`invalid or duplicate id '${id}'`);
    insert(file, o.positional, eventLine({ type: "record", id, source: o.source, scope: o.scope, refs: o.refs, payload: readStdin() })); return;
  }
  if (cmd === "resolve" || cmd === "supersede") {
    if (!validId(o.positional) || !records.has(o.positional)) fail("target ID is unknown"); ensureSource(o.source);
    const target = records.get(o.positional); if (target.status !== "active") fail("target ID is not active");
    if (cmd === "resolve") insert(file, target.section, eventLine({ type: "resolve", target: o.positional, source: o.source, reason: readStdin() }));
    else { if (!records.has(o.by) || o.by === o.positional || records.get(o.by).status !== "active") fail("replacement ID is unknown or inactive"); insert(file, target.section, eventLine({ type: "supersede", target: o.positional, replacement: o.by, source: o.source })); }
    return;
  }
  if (cmd === "checkpoint") {
    let c; try { c = JSON.parse(readStdin()); } catch { fail("checkpoint must be valid JSON"); }
    if (!c || typeof c !== "object" || Array.isArray(c)) fail("checkpoint must be a JSON object");
    const allowed = new Set(["goal", "scope", "user_updates", "done", "pending", "next", "refs"]);
    if (Object.keys(c).some((key) => !allowed.has(key))) fail("checkpoint contains unsupported fields");
    for (const k of ["goal", "scope", "user_updates", "done", "pending", "next"]) if (!validString(c[k])) fail(`checkpoint field '${k}' must be a nonblank string`);
    if (!Array.isArray(c.refs) || c.refs.some((x) => typeof x !== "string")) fail("checkpoint refs must be strings[]");
    replaceSection(file, "Now", eventLine({ ...c, type: "checkpoint" })); return;
  }
  if (cmd === "read" || cmd === "recover") {
    if (o.maxBytes !== undefined && (!Number.isInteger(o.maxBytes) || o.maxBytes < MIN_BYTES)) fail(`--max-bytes must be an integer >= ${MIN_BYTES}`);
    if (o.offset !== undefined && (!Number.isInteger(o.offset) || o.offset < 0)) fail("--offset must be a nonnegative integer");
    const max = Number.isFinite(o.maxBytes) ? Math.min(MAX_BYTES, o.maxBytes) : 7000; const offset = o.offset === undefined ? 0 : o.offset;
    if (cmd === "read" && o.id) { const r = records.get(o.id); if (!r) fail("ID is unknown"); if (o.active && r.status !== "active") return; process.stdout.write(renderBlocks([projection(r)], max, offset)); return; }
    const blocks = cmd === "read" && o.section
      ? (HEADERS.includes(o.section) ? sectionBlocks(state, o.section, records, o.active) : fail("unknown section"))
      : (() => {
        const checkpoint = [...state.events].filter((e) => e.type === "checkpoint").at(-1);
        const hasLegacy = [...state.parsed.sections.values()].some((lines) => lines.some((line) => line && !line.startsWith(PREFIX) && !line.startsWith(ESCAPE)));
        const visible = [...records.values()].filter((r) => (!(cmd === "recover" || o.active)) || r.status === "active");
        const inSections = (names) => visible.filter((r) => names.includes(r.section)).map(projection);
        const legacy = (section) => state.parsed.sections.get(section).filter((line) => line && !line.startsWith(PREFIX)).map(unescapeLine).join("\n");
        const part = (label, names) => [`${label}:`].concat(inSections(names), names.map(legacy).filter(Boolean).map((text) => `${label.toLowerCase()} (unstructured):\n${text}`));
        const result = [`Now:`].concat(checkpoint ? [checkpointProjection(checkpoint)] : ["(no structured checkpoint)"], inSections(["Now"]), legacy("Now") ? [`legacy now (unstructured):\n${legacy("Now")}`] : [], part("Corrections", ["User Corrections (verbatim)"]), part("Decisions/Pending", ["Decisions", "Pending"]), part("Pointers/Learnings", ["Pointers", "Learnings"]));
        if (hasLegacy) result.push("notice: legacy unstructured entries are preserved but omitted from structured projection");
        if (!state.events.length) result.push("notice: no structured events found");
        return result;
      })();
    process.stdout.write(renderBlocks(blocks, max, offset)); return;
  }
  fail(`unknown command '${cmd}'`);
}

const argv = process.argv.slice(2); const cmd = argv.shift(); const file = argv.pop();
try { if (!cmd || !file) fail("missing command or ledger path"); command(cmd, argv, file); } catch (e) { if (!process.exitCode) { process.stderr.write(`omt-ledger: ${e.message}\n`); process.exitCode = 1; } }
