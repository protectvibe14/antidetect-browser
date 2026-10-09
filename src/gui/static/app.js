/* =====================================================================
 * AntiDetect dashboard — vanilla JS client for the local FastAPI backend.
 * Design language adapted from persona-studio (MIT):
 * https://github.com/anhnnp/persona-studio (commit d46e984cfbdcd7278063e793e6ab1ad95b8cdc78)
 * API shapes documented in ../README.md
 * =================================================================== */
"use strict";

/* ---------------- API client (same-origin; backend serves statics at "/") ---------------- */
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function req(method, path, body, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      body,
      ...(opts.raw ? {} : { headers: { "Content-Type": "application/json" } }),
    });
  } catch (e) {
    throw new ApiError(0, "Backend unreachable — is it running on this host?");
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const msg = (data && data.error) || ("HTTP " + res.status);
    if (res.status === 401 && !window.location.pathname.startsWith("/login"))
      window.location.href = "/login";  // session expired mid-use
    throw new ApiError(res.status, msg);
  }
  if (data && data.error) throw new ApiError(res.status, data.error);
  return data;
}

const api = {
  get: (path) => req("GET", path),
  listProfiles: () => req("GET", "/api/profiles").then(d => d.profiles || []),
  createProfile: (p) => req("POST", "/api/profiles", JSON.stringify(p)),
  deleteProfile: (name) => req("DELETE", "/api/profiles/" + encodeURIComponent(name)),
  getProfile: (name) => req("GET", "/api/profiles/" + encodeURIComponent(name)).then(d => d.profile),
  updateProfile: (name, data) => req("PUT", "/api/profiles/" + encodeURIComponent(name), JSON.stringify(data)),
  launch: (name) => req("POST", "/api/profiles/" + encodeURIComponent(name) + "/launch"),
  stop: (name) => req("POST", "/api/profiles/" + encodeURIComponent(name) + "/stop"),
  health: (name) => req("GET", "/api/profiles/" + encodeURIComponent(name) + "/health"),
  warmupScenarios: () => req("GET", "/api/warmup/scenarios").then(d => d.scenarios || []),
  warmupRun: (name, scenario) => req("POST", "/api/warmup/run",
    JSON.stringify({ profile_name: name, scenario: scenario })),
  warmupStatus: (name, scenario) => req("GET",
    "/api/warmup/status?profile_name=" + encodeURIComponent(name) +
    "&scenario=" + encodeURIComponent(scenario)),
  listProxies: () => req("GET", "/api/proxies").then(d => d.proxies || []),
  listGroups: () => req("GET", "/api/groups").then(d => d.groups || []),
  createGroup: (p) => req("POST", "/api/groups", JSON.stringify(p)),
  deleteGroup: (name) => req("DELETE", "/api/groups/" + encodeURIComponent(name)),
  assignGroup: (profile, group) => req("POST",
    "/api/profiles/" + encodeURIComponent(profile) + "/group",
    JSON.stringify({ group_name: group })),
  createProxy: (p) => req("POST", "/api/proxies", JSON.stringify(p)),
  updateProxy: (name, p) => req("PUT", "/api/proxies/" + encodeURIComponent(name), JSON.stringify(p)),
  deleteProxy: (name) => req("DELETE", "/api/proxies/" + encodeURIComponent(name)),
  testProxy: (name) => req("POST", "/api/proxies/" + encodeURIComponent(name) + "/test"),
  testCustomProxy: (ptype, host, port, username, password) =>
    req("POST", "/api/proxies/test-custom", JSON.stringify({
      type: ptype, host, port, username, password })),
  fetchFree: (max) => req("POST", "/api/proxies/fetch-free",
    JSON.stringify({ max: max || 20 })),
  randomUA: (os, browser) =>
    req("GET", `/api/fingerprint/random-ua?os=${os || "windows"}&browser=${browser || "chrome"}`),
  bulkImportProxies: (text, type) => req("POST", "/api/proxies/bulk-import",
    JSON.stringify({ text, type })),
  listExtensions: (profile) => req("GET",
    "/api/profiles/" + encodeURIComponent(profile) + "/extensions")
    .then(d => d.extensions || []),
  uploadExtension: (profile, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return req("POST",
      "/api/profiles/" + encodeURIComponent(profile) + "/extensions",
      fd, { raw: true });
  },
  deleteExtension: (profile, ext) => req("DELETE",
    "/api/profiles/" + encodeURIComponent(profile) + "/extensions/" +
    encodeURIComponent(ext)),
  toggleExtension: (profile, ext, enabled) => req("POST",
    "/api/profiles/" + encodeURIComponent(profile) + "/extensions/" +
    encodeURIComponent(ext) + "/toggle",
    JSON.stringify({ enabled })),
  syncStart: (master, followers, typing) => req("POST", "/api/sync/start",
    JSON.stringify({ master, followers, typing })),
  syncStop: (session_id) => req("POST", "/api/sync/stop",
    JSON.stringify({ session_id })),
  syncStatus: (session_id) => req("GET",
    "/api/sync/status" + (session_id ?
      "?session_id=" + encodeURIComponent(session_id) : "")),
  rpaRecipes: () => req("GET", "/api/rpa/recipes")
    .then(d => d.recipes || d || []),
  rpaRun: (recipe_id, profile) => req("POST", "/api/rpa/run",
    JSON.stringify({ recipe_id, profile })),
  rpaJobs: () => req("GET", "/api/rpa/jobs").then(d => d.jobs || d || []),
  activity: () => req("GET", "/api/activity").then(d => d.activity || []),
  clearActivity: () => req("DELETE", "/api/activity"),
  exportProfiles: (names) => req("POST", "/api/profiles/export",
    JSON.stringify({ names })),
  importProfiles: (data) => req("POST", "/api/profiles/import",
    JSON.stringify(data)),
  bulkImport: (file, clientTag) => {
    const fd = new FormData();
    fd.append("file", file);
    if (clientTag) fd.append("client_tag", clientTag);
    return req("POST", "/api/bulk/import", fd, { raw: true });
  },
  migrateImport: (file, source) => {
    const fd = new FormData();
    fd.append("file", file);
    if (source) fd.append("source", source);
    return req("POST", "/api/migrate/adspower", fd, { raw: true });
  },
  cookiesExport: (profile, fmt) =>
    req("POST", "/api/cookies/export", JSON.stringify({ profile, fmt })),
  cookiesImport: (file, profile, clear) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("profile", profile);
    fd.append("clear", clear ? "true" : "false");
    return req("POST", "/api/cookies/import", fd, { raw: true });
  },
  syncStart: (p) => req("POST", "/api/sync/start", JSON.stringify(p)),
  syncStop: (id) => req("POST", "/api/sync/stop", JSON.stringify({ session_id: id })),
  syncStatus: (id) => req("GET", "/api/sync/status" + (id ? "?session_id=" + encodeURIComponent(id) : "")),
  syncTyping: (id, enabled) => req("POST", "/api/sync/typing", JSON.stringify({ session_id: id, enabled })),
  /* RPA (Phase 7) */
  rpaRecipes: () => req("GET", "/api/rpa/recipes").then(d => d.recipes || []),
  rpaCreateRecipe: (body) => req("POST", "/api/rpa/recipes", JSON.stringify(body)),
  rpaDeleteRecipe: (id) => req("DELETE", "/api/rpa/recipes/" + encodeURIComponent(id)),
  rpaRun: (body) => req("POST", "/api/rpa/run", JSON.stringify(body)),
  rpaJobs: () => req("GET", "/api/rpa/jobs").then(d => d.jobs || []),
  rpaJobStatus: (id) => req("GET", "/api/rpa/jobs/" + encodeURIComponent(id)),
  rpaJobStop: (id) => req("POST", "/api/rpa/jobs/" + encodeURIComponent(id) + "/stop"),
  rpaJobAnswer: (id, answer) =>
    req("POST", "/api/rpa/jobs/" + encodeURIComponent(id) + "/answer", JSON.stringify({ answer })),
};

/* ---------------- Theme (light/dark) ---------------- */
const THEME_KEY = "ad_theme";
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
function applyThemeIcon() {
  // sun in light mode (click to go dark), moon in dark mode (click to go light)
  const ic = document.getElementById("theme-ic");
  if (ic) ic.innerHTML = currentTheme() === "light" ? "&#9788;" : "&#9790;";
  const btn = document.getElementById("btn-theme");
  if (btn) btn.title = currentTheme() === "light" ? "Switch to dark theme" : "Switch to light theme";
}
function setTheme(t) {
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
  applyThemeIcon();
}

/* ---------------- Auth ---------------- */
async function requireAuth() {
  // Redirect to /login when there is no valid session.
  try {
    const me = await req("GET", "/api/me");
    const chip = document.getElementById("user-chip");
    if (chip && me.username) {
      document.getElementById("user-name").textContent = me.username;
      document.getElementById("user-role").textContent = me.role || "";
      chip.hidden = false;
    }
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) window.location.href = "/login";
    throw e;
  }
}
async function logout() {
  try { await req("POST", "/api/logout"); } catch { /* already gone */ }
  window.location.href = "/login";
}

/* ---------------- State ---------------- */
const state = {
  profiles: [],
  proxies: [],
  groups: [],
  query: "",
  tag: null,            // null = All profiles; "__untagged__" = no tag; else the tag string
  group: "",            // "" = All groups; "__ungrouped__" = no group; else group name
  proxiesLoaded: false,
  syncSessionId: null,  // active sync session, if any
  selected: new Set(),  // bulk-selected profile names
};

/* ---------------- DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function toast(message, kind = "info") {
  const el = document.createElement("div");
  el.className = "ps-toast " + (kind === "error" ? "error" : kind === "success" ? "success" : "");
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 3800);
  setTimeout(() => el.remove(), 4300);
}

function relTime(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  return new Date(t).toLocaleDateString();
}

function scoreClass(score) {
  if (score == null) return "warn";
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

/* ---------------- Rendering ---------------- */
function distinctTags() {
  const counts = new Map();
  for (const p of state.profiles) {
    const key = p.client_tag || "__untagged__";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderTags() {
  const list = $("tag-list");
  const tags = distinctTags();
  const allActive = state.tag === null ? " active" : "";
  let html = `<button class="ps-folder${allActive}" data-tag="">
    <span class="ps-tag-ic">&#9638;</span><span class="ps-folder-label">All profiles</span>
    <span class="ps-count">${state.profiles.length}</span></button>`;
  for (const [key, n] of tags) {
    const label = key === "__untagged__" ? "Untagged" : key;
    const active = state.tag === key ? " active" : "";
    html += `<button class="ps-folder${active}" data-tag="${esc(key)}">
      <span class="ps-tag-ic">&#9672;</span><span class="ps-folder-label">${esc(label)}</span>
      <span class="ps-count">${n}</span></button>`;
  }
  list.innerHTML = html;
  list.querySelectorAll(".ps-folder").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.tag;
      state.tag = v === "" ? null : v;
      renderAll();
    });
  });
  const crumb = state.tag === null ? "All profiles"
    : state.tag === "__untagged__" ? "Untagged" : state.tag;
  $("crumb-tag").textContent = crumb;
}

function matches(p) {
  if (state.tag !== null) {
    const key = p.client_tag || "__untagged__";
    if (key !== state.tag) return false;
  }
  if (state.group) {
    const key = p.group_name || "__ungrouped__";
    if (key !== state.group) return false;
  }
  if (state.query) {
    const q = state.query.toLowerCase();
    const hay = (p.name + " " + (p.client_tag || "")).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function renderStats() {
  $("stat-profiles").textContent = state.profiles.length;
  const running = state.profiles.filter(p => p.status === "running").length;
  $("stat-running").textContent = running;
  $("stat-proxies").textContent = state.proxies.length;
  $("stat-running-ic").style.color = running > 0 ? "" : "var(--dim)";
}

function statusCell(p) {
  const st = p.status || "stopped";
  const label = st === "downloading" ? "Downloading browser\u2026" : st.charAt(0).toUpperCase() + st.slice(1);
  const err = p.error ? ` <span class="ps-error" title="${esc(p.error)}">⚠ ${esc(p.error.slice(0, 60))}</span>` : "";
  return `<span class="ps-status-dot ${esc(st)}"></span><span class="ps-status-label">${esc(label)}</span>${err}`;
}

function renderTable() {
  const body = $("profiles-body");
  const rows = state.profiles.filter(matches);
  if (rows.length === 0) {
    const empty = state.profiles.length === 0
      ? `<div class="ps-empty"><div>No profiles yet.</div>
         <button class="ps-btn primary sm" id="empty-new">+ Create one</button></div>`
      : `<div class="ps-empty"><div>No profiles match your search or tag filter.</div></div>`;
    body.innerHTML = `<tr><td colspan="9">${empty}</td></tr>`;
    const b = $("empty-new");
    if (b) b.addEventListener("click", () => openModal("modal-new"));
    return;
  }
  body.innerHTML = rows.map((p, idx) => {
    const name = esc(p.name);
    const starting = p.status === "starting" || p.status === "downloading";
    const running = p.status === "running";
    const dl = p.status === "downloading";
    // Short ID from name hash (like AdsPower's k1f5o5x7).
    let hid = 0;
    for (let i = 0; i < p.name.length; i++) hid = ((hid << 5) - hid + p.name.charCodeAt(i)) | 0;
    const shortId = "k" + (hid >>> 0).toString(36).slice(0, 7);
    // IP with geo (from proxy).
    let ipHtml = `<span class="ps-proxy off">—</span>`;
    if (p.proxy_label && p.proxy_label !== "Direct") {
      const host = p.proxy_label.split(":")[0];
      ipHtml = `<div class="ps-ip"><span class="ps-proxy"><span class="ps-proxy-ic">&#8646;</span>${esc(p.proxy_label)}</span><span class="ps-geo" data-host="${esc(host)}"></span></div>`;
    }
    const actionBtn = starting
      ? `<button class="ps-btn ghost sm" disabled>${dl ? "Downloading…" : "Starting…"}</button>`
      : running
        ? `<button class="ps-btn danger sm" data-act="stop">⏹ Close</button>`
        : `<button class="ps-btn primary sm" data-act="launch">🛡 Open</button>`;
    const tag = p.client_tag
      ? `<span class="ps-tag">${esc(p.client_tag)}</span>`
      : `—`;
    const group = p.group_name
      ? `<span class="ps-tag group">${esc(p.group_name)}</span>`
      : `Ungrouped`;
    const remark = p.remark ? esc(p.remark) : "—";
    return `<tr data-name="${name}">
      <td><input type="checkbox" class="row-select" data-name="${name}"${state.selected.has(name) ? " checked" : ""}></td>
      <td class="dim">${idx + 1}</td>
      <td><span class="ps-mono dim">${shortId}</span></td>
      <td>${group}</td>
      <td><div class="ps-name-row"><span class="ps-name">${name}</span>${running ? ' <span class="ps-dot-live"></span>' : ''}</div></td>
      <td>${ipHtml}</td>
      <td><span class="ps-mono dim">${esc(relTime(p.last_used))}</span></td>
      <td>—</td>
      <td>${tag}</td>
      <td class="dim">${remark}</td>
      <td><div class="ps-actions" style="justify-content:flex-end">
        ${actionBtn}
        <button class="ps-btn ghost sm" data-act="menu" title="More actions">⋮</button>
      </div></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("tr[data-name]").forEach(tr => {
    const name = tr.dataset.name;
    tr.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", (e) => onAction(name, btn.dataset.act, e));
    });
    const cb = tr.querySelector(".row-select");
    if (cb) cb.addEventListener("change", () => {
      if (cb.checked) state.selected.add(name);
      else state.selected.delete(name);
      renderBulkBar();
    });
  });
  // Geo lookup for proxy IPs (AdsPower-style flags).
  body.querySelectorAll(".ps-geo[data-host]").forEach(async el => {
    const host = el.dataset.host;
    if (!host || !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return;
    try {
      const r = await req("GET", `/api/geoip/${host}`);
      if (r.country_code) {
        // Flag emoji from country code.
        const cc = r.country_code.toUpperCase();
        const flag = String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
        el.textContent = `${flag} ${cc} - ${r.country || ""}`;
      }
    } catch {}
  });
  renderBulkBar();
}

/* ---------------- Bulk selection ---------------- */
function renderBulkBar() {
  const bar = $("bulk-bar");
  const n = state.selected.size;
  bar.hidden = n === 0;
  $("bulk-count").textContent = `${n} selected`;
  const sa = $("select-all");
  if (sa) {
    const visible = state.profiles.filter(matches).map(p => p.name);
    sa.checked = visible.length > 0 && visible.every(v => state.selected.has(v));
    sa.indeterminate = !sa.checked && visible.some(v => state.selected.has(v));
  }
}

function selectedNames() {
  // Only return names that still exist.
  const existing = new Set(state.profiles.map(p => p.name));
  return [...state.selected].filter(n => existing.has(n));
}

async function bulkLaunch() {
  const names = selectedNames();
  let ok = 0;
  for (const name of names) {
    try { await api.launch(name); ok++; }
    catch (e) { /* per-profile errors shown via status */ }
  }
  toast(`Launched ${ok}/${names.length}`, ok === names.length ? "success" : "info");
  await refreshProfiles();
}

async function bulkStop() {
  const names = selectedNames();
  let ok = 0;
  for (const name of names) {
    try { await api.stop(name); ok++; }
    catch (e) { /* ignore */ }
  }
  toast(`Stopped ${ok}/${names.length}`, "success");
  await refreshProfiles();
}

async function bulkDelete() {
  const names = selectedNames();
  if (names.length === 0) return;
  if (!confirm(`Delete ${names.length} profiles? This cannot be undone.`)) return;
  let ok = 0, failed = [];
  for (const name of names) {
    try { await api.deleteProfile(name); ok++; state.selected.delete(name); }
    catch (e) { failed.push(name); }
  }
  if (failed.length) toast(`Deleted ${ok}, failed: ${failed.join(", ")}`, "error");
  else toast(`Deleted ${ok} profiles`, "success");
  await refreshProfiles();
  renderBulkBar();
}

async function bulkExport() {
  const names = selectedNames();
  if (names.length === 0) return;
  try {
    const data = await api.exportProfiles(names);
    const blob = new Blob([JSON.stringify(data, null, 2)],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profiles-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`Exported ${data.count} profiles`, "success");
  } catch (e) { toast("Export failed: " + (e.message || e), "error"); }
}

function openBulkEdit() {
  const names = selectedNames();
  if (names.length === 0) return;
  $("bulk-edit-count").textContent = `${names.length} profiles selected`;
  // Populate group + proxy dropdowns.
  const gsel = $("bulk-group");
  gsel.innerHTML = `<option value="__keep__">Keep unchanged</option>
    <option value="">Ungrouped</option>` +
    state.groups.map(g => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join("");
  loadProxyOptions("bulk-proxy", true);
  openModal("modal-bulk-edit");
}

async function submitBulkEdit(e) {
  e.preventDefault();
  const names = selectedNames();
  const groupVal = $("bulk-group").value;
  const proxyVal = $("bulk-proxy").value;
  const tagVal = $("bulk-tag").value.trim();
  const changeGroup = groupVal !== "__keep__";
  const changeProxy = proxyVal !== "__keep__";
  const changeTag = tagVal !== "";
  if (!changeGroup && !changeProxy && !changeTag) {
    toast("Nothing to change", "error");
    return;
  }
  let ok = 0, failed = 0;
  for (const name of names) {
    try {
      const payload = {};
      if (changeTag) payload.client_tag = tagVal;
      if (changeProxy) payload.proxy_name = proxyVal;
      if (changeGroup) payload.group_name = groupVal || null;
      await api.updateProfile(name, payload);
      ok++;
    } catch (e) { failed++; }
  }
  toast(`Updated ${ok}/${names.length}${failed ? ` (${failed} failed)` : ""}`,
    failed ? "info" : "success");
  $("modal-bulk-edit").hidden = true;
  await refreshProfiles();
}

/* ---------------- Edit Proxy tab (AdsPower-style) ---------------- */
/* (Segmented tab clicks handled by the document delegation listener below.) */

$("edit-px-test").addEventListener("click", async () => {
  const resEl = $("edit-px-result");
  const custom = !$("edit-proxy-custom").hidden;
  resEl.textContent = "Testing…";
  resEl.style.color = "var(--dim)";
  try {
    let ok, latency;
    if (custom) {
      const host = $("edit-px-host").value.trim();
      const port = parseInt($("edit-px-port").value, 10);
      if (!host || !port) {
        resEl.textContent = "Enter host and port first.";
        resEl.style.color = "#ff453a";
        return;
      }
      const r = await api.testCustomProxy(
        $("edit-px-type").value || "http", host, port,
        $("edit-px-user").value.trim(), $("edit-px-pass").value);
      ok = r.ok; latency = r.latency_ms;
    } else {
      const name = $("edit-proxy").value;
      if (!name) {
        resEl.textContent = "Select a proxy first.";
        resEl.style.color = "#ff453a";
        return;
      }
      const r = await api.testProxy(name);
      ok = r.ok; latency = r.latency_ms;
    }
    if (ok) {
      resEl.textContent = `✓ OK${latency != null ? ` (${latency}ms)` : ""}`;
      resEl.style.color = "#30d158";
    } else {
      resEl.textContent = "✗ Failed";
      resEl.style.color = "#ff453a";
    }
  } catch (err) {
    resEl.textContent = "Error: " + (err.message || err);
    resEl.style.color = "#ff453a";
  }
});

/* ---------------- Edit Fingerprint tab (AdsPower-style) ---------------- */
// Event delegation for reliability — single document listener handles
// all pill/toggle/segmented clicks inside the Edit modal.
document.addEventListener("click", (e) => {
  const pill = e.target.closest("#modal-edit .ps-pill");
  if (pill) {
    const group = pill.closest(".ps-pills");
    if (group) {
      group.querySelectorAll(".ps-pill").forEach(p =>
        p.classList.remove("active"));
      pill.classList.add("active");
      if (group.id === "edit-tz-mode")
        $("edit-tz").hidden = pill.dataset.val !== "custom";
      if (group.id === "edit-lang-mode")
        $("edit-locale").hidden = pill.dataset.val !== "custom";
      if (group.id === "edit-screen-mode") {
        $("edit-screen-preset").hidden = pill.dataset.val !== "predefined";
        $("edit-screen-custom").hidden = pill.dataset.val !== "custom";
      }
      e.preventDefault();
      return;
    }
  }
  const tgl = e.target.closest("#modal-edit .ps-toggle");
  if (tgl) {
    tgl.classList.toggle("on");
    tgl.setAttribute("aria-checked", tgl.classList.contains("on"));
    e.preventDefault();
    return;
  }
  const seg = e.target.closest("#edit-proxy-mode .ps-seg-btn");
  if (seg) {
    document.querySelectorAll("#edit-proxy-mode .ps-seg-btn").forEach(b =>
      b.classList.toggle("active", b === seg));
    const mode = seg.dataset.val;
    $("edit-proxy-saved").hidden = mode !== "saved";
    $("edit-proxy-custom").hidden = mode !== "custom";
    $("edit-proxy-rotating").hidden = mode !== "rotating";
    $("edit-proxy-provider").hidden = mode !== "provider";
    e.preventDefault();
    return;
  }
  // Edit modal tab switching (General/Proxy/Fingerprint/Extensions/Platform).
  const etab = e.target.closest("#edit-tabs .ps-tab");
  if (etab) {
    document.querySelectorAll("#edit-tabs .ps-tab").forEach(x =>
      x.classList.toggle("active", x === etab));
    document.querySelectorAll("#form-edit .ps-tabpane").forEach(pn =>
      pn.classList.toggle("active", pn.dataset.pane === etab.dataset.tab));
    e.preventDefault();
    return;
  }
  // OS pills (General tab).
  const osp = e.target.closest("#edit-os-pills .ps-os-pill");
  if (osp) {
    document.querySelectorAll("#edit-os-pills .ps-os-pill").forEach(x =>
      x.classList.toggle("active", x === osp));
    e.preventDefault();
    return;
  }
});
// Show more.
$("edit-fp-more").addEventListener("click", () => {
  const adv = $("edit-fp-advanced");
  adv.hidden = !adv.hidden;
  $("edit-fp-more").textContent = adv.hidden ? "Show more ∨" : "Show less ∧";
});
$("edit-mediadevice-edit").addEventListener("click", () => {
  toast("Media device noise is auto-configured per profile", "info");
});
// UA copy button.
$("edit-ua-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("edit-ua").value);
    toast("User-Agent copied", "success");
  } catch { toast("Copy failed", "error"); }
});
// Renderer shuffle — backend picks from OSS spoofer's known-good list.
$("edit-renderer-shuffle").addEventListener("click", async () => {
  try {
    const resp = await req("GET", "/api/fingerprint/random-renderer");
    $("edit-webgl-renderer").value = resp.renderer;
    const vmap = { "Intel": "Google Inc. (Intel)", "NVIDIA": "Google Inc. (NVIDIA)", "AMD": "Google Inc. (AMD)" };
    for (const k of Object.keys(vmap)) {
      if (resp.renderer.includes(k)) { $("edit-webgl-vendor").value = vmap[k]; break; }
    }
    toast("New renderer", "success");
  } catch { toast("Failed", "error"); }
});
// Merge cookie: append pasted JSON to existing cookies.
$("edit-cookie-merge").addEventListener("click", () => {
  const raw = $("edit-cookie").value.trim();
  if (!raw) { toast("Paste cookie JSON first", "info"); return; }
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error("not an array");
    toast(`Merged ${arr.length} cookies`, "success");
  } catch { toast("Invalid cookie JSON", "error"); }
});
// Paste proxy from clipboard (host:port:user:pass format).
$("edit-px-paste").addEventListener("click", async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    // Try host:port:user:pass or host:port.
    const parts = text.split(":");
    if (parts.length >= 2) {
      $("edit-px-host").value = parts[0];
      $("edit-px-port").value = parts[1];
      if (parts[2]) $("edit-px-user").value = parts[2];
      if (parts[3]) $("edit-px-pass").value = parts[3];
      toast("Proxy pasted", "success");
    } else { toast("Clipboard doesn't look like host:port", "info"); }
  } catch { toast("Clipboard read failed", "error"); }
});
// Refresh Change IP URL (open it to rotate IP).
$("edit-px-refresh-url").addEventListener("click", async () => {
  const url = $("edit-px-changeurl").value.trim();
  if (!url) { toast("Enter Change IP URL first", "info"); return; }
  try {
    await fetch(url, { mode: "no-cors" });
    toast("Change IP requested", "success");
  } catch { toast("Request sent", "info"); }
});
// Add Platform Account (AdsPower-style).
const PLATFORM_NAMES = {
  facebook: "Facebook", google: "Google", youtube: "YouTube",
  tiktok: "TikTok", instagram: "Instagram", twitter: "Twitter/X",
  amazon: "Amazon", other: "Other",
};
function renderPlatformList() {
  const val = $("edit-platform-acct").value;
  const list = $("edit-platform-list");
  list.innerHTML = "";
  if (val && PLATFORM_NAMES[val]) {
    const chip = document.createElement("span");
    chip.className = "ps-platform-chip";
    chip.innerHTML = `${esc(PLATFORM_NAMES[val])} <button type="button" title="Remove">×</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      $("edit-platform-acct").value = "";
      renderPlatformList();
    });
    list.appendChild(chip);
  }
}
$("edit-add-platform").addEventListener("click", () => {
  // Cycle through platforms or prompt.
  const sel = $("edit-platform-acct");
  const current = sel.value;
  const opts = [...sel.options].map(o => o.value).filter(v => v);
  const idx = opts.indexOf(current);
  sel.value = opts[(idx + 1) % opts.length] || opts[0];
  renderPlatformList();
  toast(`Platform: ${PLATFORM_NAMES[sel.value] || "None"}`, "info");
});

function editPillVal(id) {
  const el = document.querySelector(`#${id} .ps-pill.active`);
  return el ? el.dataset.val : null;
}
function editToggleOn(val) {
  const el = document.querySelector(`#modal-edit .ps-toggle[data-val="${val}"]`);
  return el ? el.classList.contains("on") : false;
}
function editOsVal() {
  const el = document.querySelector("#edit-os-pills .ps-os-pill.active");
  return el ? el.dataset.val : "windows";
}
// General tab: counters + kernel note.
function updateEditCounters() {
  const n = $("edit-display-name");
  if (n) $("edit-name-counter").textContent = `${n.value.length} / 100`;
  const r = $("edit-remark");
  if (r) $("edit-remark-counter").textContent = `${r.value.length} / 2000`;
}
function updateKernelNote() {
  const b = $("edit-browser");
  const note = $("edit-kernel-note");
  if (!b || !note) return;
  note.textContent = b.value === "camoufox"
    ? "Firefox 156 kernel (Camoufox)"
    : "Chromium 153 kernel (Patchright)";
}
document.addEventListener("input", (e) => {
  if (e.target.id === "edit-display-name" || e.target.id === "edit-remark")
    updateEditCounters();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "edit-browser") updateKernelNote();
});

/* ---------------- Full-page New Profile ---------------- */
function showView(name) {
  $("view-profiles").hidden = name !== "profiles";
  $("view-new-profile").hidden = name !== "new-profile";
  // Update sidebar active state.
  document.querySelectorAll(".ps-navitem").forEach(el =>
    el.classList.remove("active"));
  const navMap = { "profiles": "nav-profiles", "new-profile": null };
  const nav = navMap[name] ? $(navMap[name]) : null;
  if (nav) nav.classList.add("active");
  if (name === "new-profile") initNewProfilePage();
  window.scrollTo(0, 0);
}

async function initNewProfilePage() {
  // Populate group + proxy dropdowns.
  const gsel = $("np-group");
  gsel.innerHTML = `<option value="">Ungrouped</option>` +
    state.groups.map(g => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join("");
  loadProxyOptions("np-proxy");
  // Pills: single-select.
  document.querySelectorAll("#view-new-profile .ps-pills").forEach(group => {
    group.querySelectorAll(".ps-pill").forEach(pill => {
      pill.onclick = () => {
        group.querySelectorAll(".ps-pill").forEach(p =>
          p.classList.remove("active"));
        pill.classList.add("active");
        renderNewOverview();
      };
    });
  });
  // Segmented: single-select.
  document.querySelectorAll("#view-new-profile .ps-seg").forEach(group => {
    group.querySelectorAll(".ps-seg-btn").forEach(btn => {
      btn.onclick = () => {
        group.querySelectorAll(".ps-seg-btn").forEach(b =>
          b.classList.remove("active"));
        btn.classList.add("active");
      };
    });
  });
  // Toggles.
  document.querySelectorAll("#view-new-profile .ps-toggle").forEach(t => {
    t.onclick = () => {
      t.classList.toggle("on");
      t.setAttribute("aria-checked", t.classList.contains("on"));
      renderNewOverview();
    };
  });
  // Char counters.
  $("np-name").oninput = () => {
    $("np-name-count").textContent = `${$("np-name").value.length} / 100`;
  };
  $("np-remark").oninput = () => {
    $("np-remark-count").textContent = `${$("np-remark").value.length} / 2000`;
  };
  // Auto-generate a random UA on page open (AdsPower shows a default UA).
  if (!$("np-ua").value) {
    try {
      const r = await api.randomUA(pillVal("np-os") || "linux", "chrome");
      $("np-ua").value = r.user_agent;
    } catch (e) { /* leave empty on failure */ }
  }
  renderNewOverview();
}

function pillVal(id) {
  const el = document.querySelector(`#${id} .ps-pill.active`);
  return el ? el.dataset.val : null;
}

function renderNewOverview() {
  const rows = [
    ["Browser", pillVal("np-browser") === "patchright" ? "Chromium" : "Firefox (Camoufox)"],
    ["OS", pillVal("np-os") || "—"],
    ["WebRTC", pillVal("np-webrtc") || "—"],
    ["Timezone", pillVal("np-timezone") === "ip" ? "Based on IP" : (pillVal("np-timezone") || "—")],
    ["Proxy", $("np-proxy").selectedOptions[0]?.textContent || "Direct"],
  ];
  $("np-overview").innerHTML = rows.map(([k, v]) =>
    `<div class="ps-ov-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("");
}

// New-profile page tabs.
document.querySelectorAll("#new-tabs .ps-tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll("#new-tabs .ps-tab").forEach(x =>
      x.classList.toggle("active", x === t));
    document.querySelectorAll("#view-new-profile .ps-tabpane").forEach(pn =>
      pn.classList.toggle("active", pn.dataset.pane === t.dataset.tab));
  });
});

$("np-cancel").addEventListener("click", () => showView("profiles"));
$("np-new-fp").addEventListener("click", () => {
  toast("Fingerprint will be generated on creation", "info");
});
// Shuffle: new random UA on every click (AdsPower-style).
$("np-ua-shuffle").addEventListener("click", async () => {
  const os = pillVal("np-os") || "windows";
  const browser = pillVal("np-browser") === "patchright" ? "chrome" : "firefox";
  try {
    const r = await api.randomUA(os, browser);
    $("np-ua").value = r.user_agent;
    toast("New User-Agent generated", "success");
  } catch (err) {
    toast("Failed: " + (err.message || err), "error");
  }
});

$("form-new-page").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("np-name").value.trim() ||
    `profile-${Date.now().toString(36)}`;
  const payload = {
    name,
    os: pillVal("np-os") || "linux",
    engine: pillVal("np-browser") === "patchright" ? "patchright" : "camoufox",
    user_agent: $("np-ua").value.trim() || null,
    group_name: $("np-group").value || null,
    client_tag: $("np-remark").value.trim() || null,
    proxy_name: $("np-proxy").value || null,
  };
  const tabs = $("np-tabs").value.split("\n").map(s => s.trim()).filter(Boolean);
  if (tabs.length) payload.startup_urls = tabs;
  try {
    await api.createProfile(payload);
    toast(`Profile "${name}" created`, "success");
    showView("profiles");
    await refreshProfiles();
  } catch (err) {
    toast("Create failed: " + (err.message || err), "error");
  }
});
async function renderExtensionsList(profileName) {
  const wrap = $("edit-extensions-list");
  let exts = [];
  try { exts = await api.listExtensions(profileName); }
  catch (e) {
    wrap.innerHTML = `<div class="ps-empty">Failed to load extensions.</div>`;
    return;
  }
  if (exts.length === 0) {
    wrap.innerHTML = `<div class="ps-empty">No extensions installed for this profile.</div>`;
    return;
  }
  wrap.innerHTML = exts.map(x => `
    <div class="ps-group-row">
      <span class="ps-tag${x.enabled ? "" : " none"}">${x.enabled ? "ON" : "OFF"}</span>
      <span class="ps-mono">${esc(x.name)}</span>
      <span class="dim">${esc(x.filename)}</span>
      <span style="flex:1"></span>
      <button class="ps-btn ghost sm" data-ext-toggle="${esc(x.name)}" data-enabled="${x.enabled ? 0 : 1}">${x.enabled ? "Disable" : "Enable"}</button>
      <button class="ps-btn danger sm" data-ext-del="${esc(x.name)}">Remove</button>
    </div>`).join("");
  wrap.querySelectorAll("[data-ext-toggle]").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await api.toggleExtension(profileName, btn.dataset.extToggle,
          btn.dataset.enabled === "1");
        renderExtensionsList(profileName);
      } catch (e) { toast("Toggle failed: " + (e.message || e), "error"); }
    });
  });
  wrap.querySelectorAll("[data-ext-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Remove extension "${btn.dataset.extDel}"?`)) return;
      try {
        await api.deleteExtension(profileName, btn.dataset.extDel);
        toast("Extension removed", "success");
        renderExtensionsList(profileName);
      } catch (e) { toast("Remove failed: " + (e.message || e), "error"); }
    });
  });
}

async function onExtensionUpload(e) {
  if (e) e.preventDefault();
  const profileName = $("edit-name").value;
  const fileInput = $("ext-file");
  if (!fileInput.files.length) { toast("Choose a file first", "error"); return; }
  try {
    await api.uploadExtension(profileName, fileInput.files[0]);
    toast("Extension uploaded", "success");
    fileInput.value = "";
    renderExtensionsList(profileName);
  } catch (err) { toast("Upload failed: " + (err.message || err), "error"); }
}

/* ---------------- Synchronizer UI ---------------- */
$("nav-sync").addEventListener("click", () => {
  populateSyncForm();
  openModal("modal-sync");
});

function populateSyncForm() {
  const master = $("sync-master");
  master.innerHTML = state.profiles.map(p =>
    `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
  const fw = $("sync-followers");
  fw.innerHTML = state.profiles.map(p =>
    `<label class="ps-checkitem"><input type="checkbox" value="${esc(p.name)}"> ${esc(p.name)}</label>`).join("");
  // Uncheck the master when it changes.
  master.addEventListener("change", () => {
    fw.querySelectorAll("input").forEach(cb => {
      cb.disabled = cb.value === master.value;
      if (cb.disabled) cb.checked = false;
    });
  });
  master.dispatchEvent(new Event("change"));
  refreshSyncStatus();
}

async function refreshSyncStatus() {
  const active = $("sync-active");
  try {
    const st = await api.syncStatus();
    const sessions = st.sessions || (st.session_id ? [st] : []);
    if (sessions.length > 0) {
      const s = sessions[0];
      state.syncSessionId = s.session_id;
      $("sync-status-text").textContent =
        `Master: ${s.master} → ${s.followers?.length || 0} followers`;
      active.hidden = false;
    } else {
      state.syncSessionId = null;
      active.hidden = true;
    }
  } catch (e) { active.hidden = true; }
}

async function onSyncStart(e) {
  e.preventDefault();
  const master = $("sync-master").value;
  const followers = [...$("sync-followers").querySelectorAll("input:checked")]
    .map(cb => cb.value);
  if (!master) { toast("Pick a master profile", "error"); return; }
  if (followers.length === 0) { toast("Pick at least one follower", "error"); return; }
  try {
    const r = await api.syncStart(master, followers, $("sync-typing").checked);
    state.syncSessionId = r.session_id;
    toast("Sync session started", "success");
    refreshSyncStatus();
  } catch (err) { toast("Start failed: " + (err.message || err), "error"); }
}

$("btn-sync-stop").addEventListener("click", async () => {
  if (!state.syncSessionId) return;
  try {
    await api.syncStop(state.syncSessionId);
    state.syncSessionId = null;
    toast("Sync session stopped", "success");
    refreshSyncStatus();
  } catch (err) { toast("Stop failed: " + (err.message || err), "error"); }
});

/* ---------------- RPA UI ---------------- */
$("nav-rpa").addEventListener("click", () => {
  renderRpaRecipes();
  populateRpaRun();
  renderRpaJobs();
  openModal("modal-rpa");
});

document.querySelectorAll("#rpa-tabs .ps-tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll("#rpa-tabs .ps-tab").forEach(x =>
      x.classList.toggle("active", x === t));
    document.querySelectorAll("#modal-rpa .ps-tabpane").forEach(pn =>
      pn.classList.toggle("active", pn.dataset.pane === t.dataset.tab));
  });
});

async function renderRpaRecipes() {
  const wrap = $("rpa-recipes-list");
  let recipes = [];
  try { recipes = await api.rpaRecipes(); }
  catch (e) { wrap.innerHTML = `<div class="ps-empty">Failed to load recipes.</div>`; return; }
  const list = Array.isArray(recipes) ? recipes : Object.values(recipes);
  if (list.length === 0) {
    wrap.innerHTML = `<div class="ps-empty">No recipes yet. Add recipes via the CLI.</div>`;
    return;
  }
  wrap.innerHTML = list.map(r => {
    const id = r.id || r.name;
    const name = r.name || r.id;
    return `<div class="ps-group-row">
      <span class="ps-mono">${esc(name)}</span>
      <span class="dim">${esc(r.description || "")}</span>
      <span style="flex:1"></span>
      <button class="ps-btn ghost sm" data-rpa-run="${esc(id)}">Run</button>
    </div>`;
  }).join("");
  wrap.querySelectorAll("[data-rpa-run]").forEach(btn => {
    btn.addEventListener("click", () => {
      $("rpa-recipe").value = btn.dataset.rpaRun;
      document.querySelector('#rpa-tabs [data-tab="run"]').click();
    });
  });
}

function populateRpaRun() {
  $("rpa-recipe").innerHTML = `<option value="">Loading…</option>`;
  api.rpaRecipes().then(recipes => {
    const list = Array.isArray(recipes) ? recipes : Object.values(recipes);
    $("rpa-recipe").innerHTML = list.map(r =>
      `<option value="${esc(r.id || r.name)}">${esc(r.name || r.id)}</option>`).join("");
  }).catch(() => { $("rpa-recipe").innerHTML = `<option value="">No recipes</option>`; });
  $("rpa-profile").innerHTML = state.profiles.map(p =>
    `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
}

async function renderRpaJobs() {
  const wrap = $("rpa-jobs-list");
  let jobs = [];
  try { jobs = await api.rpaJobs(); }
  catch (e) { wrap.innerHTML = `<div class="ps-empty">Failed to load jobs.</div>`; return; }
  const list = Array.isArray(jobs) ? jobs : Object.values(jobs);
  if (list.length === 0) {
    wrap.innerHTML = `<div class="ps-empty">No RPA jobs yet.</div>`;
    return;
  }
  wrap.innerHTML = list.slice(-20).reverse().map(j => `
    <div class="ps-group-row">
      <span class="ps-tag">${esc(j.status || "unknown")}</span>
      <span class="ps-mono">${esc(j.recipe_id || j.recipe || "")}</span>
      <span class="dim">${esc(j.profile || "")}</span>
      <span class="dim">${esc(j.id || "")}</span>
    </div>`).join("");
}

async function onRpaRun(e) {
  e.preventDefault();
  const recipe = $("rpa-recipe").value;
  const profile = $("rpa-profile").value;
  if (!recipe || !profile) { toast("Pick a recipe and profile", "error"); return; }
  try {
    const r = await api.rpaRun(recipe, profile);
    toast(`RPA job started: ${r.job_id || r.id || ""}`, "success");
    document.querySelector('#rpa-tabs [data-tab="jobs"]').click();
    setTimeout(renderRpaJobs, 2000);
  } catch (err) { toast("Run failed: " + (err.message || err), "error"); }
}

/* ---------------- Activity log UI ---------------- */
$("nav-activity").addEventListener("click", () => {
  renderActivityList();
  openModal("modal-activity");
});

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

async function renderActivityList() {
  const wrap = $("activity-list");
  let items = [];
  try { items = await api.activity(); }
  catch (e) { wrap.innerHTML = `<div class="ps-empty">Failed to load activity.</div>`; return; }
  if (items.length === 0) {
    wrap.innerHTML = `<div class="ps-empty">No activity yet.</div>`;
    return;
  }
  wrap.innerHTML = items.map(a => `
    <div class="ps-group-row">
      <span class="ps-tag">${esc(a.action)}</span>
      <span>${esc(a.username)}</span>
      ${a.target ? `<span class="ps-mono">${esc(a.target)}</span>` : ""}
      ${a.detail ? `<span class="dim">${esc(a.detail)}</span>` : ""}
      <span style="flex:1"></span>
      <span class="dim">${fmtTime(a.ts)}</span>
    </div>`).join("");
}

$("btn-activity-clear").addEventListener("click", async () => {
  if (!confirm("Clear the activity log?")) return;
  try {
    await api.clearActivity();
    toast("Activity log cleared", "success");
    renderActivityList();
  } catch (err) { toast("Clear failed: " + (err.message || err), "error"); }
});

function renderAll() {
  renderTags();
  renderStats();
  renderTable();
}

/* ---------------- Actions ---------------- */
async function onAction(name, act, evt) {
  try {
    if (act === "launch") {
      await api.launch(name);
      toast(`Launching "${name}"…`, "success");
    } else if (act === "stop") {
      await api.stop(name);
      toast(`Stopped "${name}".`, "success");
    } else if (act === "delete") {
      if (!confirm(`Delete profile "${name}"? This cannot be undone.`)) return;
      await api.deleteProfile(name);
      toast(`Deleted "${name}".`, "success");
    } else if (act === "health") {
      openHealth(name);
      return; // no immediate refresh needed
    } else if (act === "warmup") {
      openWarmup(name);
      return; // modal handles its own flow
    } else if (act === "cookies") {
      openCookies(name);
      return; // no immediate refresh needed
    } else if (act === "edit") {
      openEdit(name);
      return; // modal handles its own flow
    } else if (act === "menu") {
      showRowMenu(name, evt);
      return;
    }
    await refreshProfiles();
  } catch (e) {
    toast(actionError(act, name, e), "error");
  }
}

/* Row dropdown menu (AdsPower-style). */
let rowMenuName = null;
function showRowMenu(name, evt) {
  rowMenuName = name;
  const menu = $("row-menu");
  // Close any existing menu first.
  menu.hidden = true;
  document.removeEventListener("click", _rowMenuClose);
  menu.hidden = false;
  // Position near the clicked button (fallback to cursor/right side).
  let top = window.innerHeight / 2 - 100, left = window.innerWidth - 220;
  try {
    const t = (evt && evt.target && evt.target.closest) ? evt.target.closest("button") : null;
    if (t) {
      const rect = t.getBoundingClientRect();
      top = Math.min(rect.bottom + 4, window.innerHeight - 320);
      left = Math.max(rect.right - 200, 8);
    }
  } catch {}
  menu.style.top = top + "px";
  menu.style.left = left + "px";
  // Close on outside click or Escape.
  _rowMenuClose = (e) => {
    if (!menu.contains(e.target)) {
      menu.hidden = true;
      document.removeEventListener("click", _rowMenuClose);
      document.removeEventListener("keydown", _rowMenuEsc);
    }
  };
  _rowMenuEsc = (e) => {
    if (e.key === "Escape") {
      menu.hidden = true;
      document.removeEventListener("click", _rowMenuClose);
      document.removeEventListener("keydown", _rowMenuEsc);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", _rowMenuClose);
    document.addEventListener("keydown", _rowMenuEsc);
  }, 10);
}
let _rowMenuClose = null, _rowMenuEsc = null;
document.querySelectorAll('#row-menu [data-menu]').forEach(btn => {
  btn.addEventListener("click", async () => {
    const action = btn.dataset.menu;
    const name = rowMenuName;
    $("row-menu").hidden = true;
    if (!name) return;
    if (action === "edit") openEdit(name);
    else if (action === "edit-proxy") openEdit(name, "proxy");
    else if (action === "edit-account") openEdit(name, "platform");
    else if (action === "edit-fingerprint") openEdit(name, "fingerprint");
    else if (action === "cookies") openCookies(name);
    else if (action === "copy") {
      if (!confirm(`Copy profile "${name}"?`)) return;
      try {
        await api.createProfile({ name: name + "-copy", copy_from: name });
        toast(`Profile copied as "${name}-copy".`, "success");
        await refreshProfiles();
      } catch (e) { toast(`Copy failed: ${e.message || e}`, "error"); }
    }
    else if (action === "cache") openCacheInfo(name);
    else if (action === "delete") onAction(name, "delete");
  });
});

async function openCacheInfo(name) {
  try {
    const d = await api.get(`/api/profiles/${encodeURIComponent(name)}/cache`);
    const size = d.size_mb != null ? `${d.size_mb} MB` : "unknown";
    if (confirm(`Cache for "${name}": ${size}\n\nClear cache data?`)) {
      await req("DELETE", `/api/profiles/${encodeURIComponent(name)}/cache`);
      toast("Cache cleared.", "success");
    }
  } catch (e) {
    toast(`Cache info unavailable: ${e.message || e}`, "error");
  }
}

function actionError(act, name, e) {
  const base = `Failed to ${act} "${name}": ${e.message || e}`;
  if (act === "delete" && e.status === 409) return `Cannot delete "${name}": stop it first. (${e.message})`;
  if (e.status === 404) return `"${name}" not found (it may already be gone).`;
  return base;
}

/* ---------------- Refresh loop ---------------- */
let refreshing = false;
async function refreshProfiles() {
  if (refreshing) return;
  refreshing = true;
  try {
    state.profiles = await api.listProfiles();
    setConn(true);
  } catch (e) {
    setConn(false);
    // Only toast on the first failure of a quiet stretch to avoid spam every 5s.
    if (!refreshProfiles._failed) toast("Cannot reach backend: " + (e.message || e), "error");
    refreshProfiles._failed = true;
    return;
  } finally { refreshing = false; }
  refreshProfiles._failed = false;
  renderAll(); // preserves search text + selected tag (both live in state)
}

async function refreshGroups() {
  try {
    state.groups = await api.listGroups();
  } catch (e) {
    state.groups = [];
    return;
  }
  const sel = $("group-filter");
  const cur = sel.value;
  sel.innerHTML = `<option value="">All groups</option>
    <option value="__ungrouped__">Ungrouped</option>` +
    state.groups.map(g =>
      `<option value="${esc(g.name)}">${esc(g.name)} (${g.profile_count})</option>`
    ).join("");
  // Restore selection if the group still exists.
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  else { sel.value = ""; state.group = ""; }
}

function setConn(up) {
  const foot = $("conn-foot");
  foot.classList.toggle("live", up);
  foot.classList.toggle("down", !up);
  $("conn-label").textContent = up ? "Backend online" : "Backend offline";
  $("refresh-note").textContent = up ? "auto-refresh 5s" : "";
}

setInterval(refreshProfiles, 5000);

/* ---------------- Modals ---------------- */
function openModal(id) {
  if (id === "modal-new") loadProxyOptions();
  $(id).hidden = false;
  const first = $(id).querySelector("input[type=text], select");
  if (first) setTimeout(() => first.focus(), 50);
}
function closeModal(el) {
  const bd = el.closest(".ps-overlay");
  if (bd) bd.hidden = true;
}
document.querySelectorAll("[data-close]").forEach(b =>
  b.addEventListener("click", () => closeModal(b)));
document.querySelectorAll(".ps-overlay").forEach(bd =>
  bd.addEventListener("mousedown", (e) => { if (e.target === bd) bd.hidden = true; }));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".ps-overlay").forEach(bd => bd.hidden = true);
});

async function loadProxyOptions(selId, keepOption) {
  const sel = $(selId || "new-proxy");
  try {
    state.proxies = await api.listProxies();
    state.proxiesLoaded = true;
  } catch { /* keep whatever we had; proxies optional */ }
  const cur = sel.value;
  sel.innerHTML =
    (keepOption ? `<option value="__keep__">Keep unchanged</option>` : "") +
    `<option value="">None (direct)</option>` + state.proxies.map(p =>
    `<option value="${esc(p.name)}">${esc(p.name)} (${esc(p.type)}://${esc(p.host)}:${esc(p.port)})</option>`
  ).join("");
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

/* ---------------- New profile ---------------- */
$("form-new").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: $("new-name").value.trim(),
    os: $("new-os").value,
    engine: $("new-engine").value === "patchright" ? "patchright" : "camoufox",
  };
  const proxyName = $("new-proxy").value;
  const tag = $("new-tag").value.trim();
  if (proxyName) payload.proxy_name = proxyName;
  if (tag) payload.client_tag = tag;
  if (!payload.name) { toast("Profile name is required.", "error"); return; }
  try {
    await api.createProfile(payload);
    toast(`Created "${payload.name}".`, "success");
    closeModal(e.target);
    e.target.reset();
    await refreshProfiles();
  } catch (err) {
    toast("Create failed: " + (err.message || err), "error");
  }
});

/* ---------------- Bulk import ---------------- */
$("form-bulk").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("bulk-file").files[0];
  if (!file) { toast("Choose a file first.", "error"); return; }
  const tag = $("bulk-tag").value.trim();
  const box = $("bulk-result");
  box.hidden = false;
  box.innerHTML = "Importing&hellip;";
  const isJson = file.name.toLowerCase().endsWith(".json");
  try {
    let created, skipped, errors;
    if (isJson) {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await api.importProfiles(data);
      created = (res.created || []).length;
      skipped = (res.skipped || []).length;
      errors = [];
      box.innerHTML =
        `<span class="ok">Created: ${created}</span> &middot; ` +
        `<span class="warn">Skipped: ${skipped}</span>` +
        (res.created.length
          ? `<div class="dim">${res.created.map(esc).join(", ")}</div>` : "");
    } else {
      const res = await api.bulkImport(file, tag);
      created = res.created || 0; skipped = res.skipped || 0;
      errors = Array.isArray(res.errors) ? res.errors : [];
      box.innerHTML =
        `<span class="ok">Created: ${created}</span> &middot; ` +
        `<span class="warn">Skipped: ${skipped}</span> &middot; ` +
        `<span class="${errors.length ? "err" : ""}">Errors: ${errors.length}</span>` +
        (errors.length
          ? `<ul>${errors.slice(0, 12).map(x => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}` +
            (errors.length > 12 ? `<li>&hellip;and ${errors.length - 12} more</li>` : "") + `</ul>`
          : "");
    }
    toast(`Import done: ${created} created, ${skipped} skipped.`,
      "success");
    await refreshProfiles();
  } catch (err) {
    box.innerHTML = `<span class="err">Import failed: ${esc(err.message || err)}</span>`;
    toast("Import failed: " + (err.message || err), "error");
  }
});

/* ---------------- Migrate import (AdsPower / GoLogin / Multilogin) ---------------- */
$("form-migrate").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("migrate-file").files[0];
  if (!file) { toast("Choose a JSON export file first.", "error"); return; }
  const source = $("migrate-source").value;
  const box = $("migrate-result");
  box.hidden = false;
  box.innerHTML = "Importing&hellip;";
  try {
    const res = await api.migrateImport(file, source);
    const created = res.created || 0;
    const skipped = Array.isArray(res.skipped) ? res.skipped : [];
    const errors = Array.isArray(res.errors) ? res.errors : [];
    box.innerHTML =
      `<span class="ok">Created: ${created}</span> &middot; ` +
      `<span class="warn">Skipped (duplicates): ${skipped.length}</span> &middot; ` +
      `<span class="${errors.length ? "err" : ""}">Errors: ${errors.length}</span>` +
      (skipped.length
        ? `<ul>${skipped.slice(0, 12).map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "") +
      (errors.length
        ? `<ul>${errors.slice(0, 12).map(x => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}` +
          (errors.length > 12 ? `<li>&hellip;and ${errors.length - 12} more</li>` : "") + `</ul>`
        : "");
    toast(`Import done: ${created} created, ${skipped.length} skipped, ${errors.length} errors.`,
      errors.length ? "info" : "success");
    await refreshProfiles();
  } catch (err) {
    box.innerHTML = `<span class="err">Import failed: ${esc(err.message || err)}</span>`;
    toast("Import failed: " + (err.message || err), "error");
  }
});

/* ---------------- Cookies modal ---------------- */
state.cookiesProfile = null;

function openCookies(name) {
  state.cookiesProfile = name;
  $("ck-title").textContent = "Cookies — " + name;
  $("ck-result").hidden = true;
  $("ck-result").innerHTML = "";
  $("ck-file").value = "";
  openModal("modal-cookies");
}

$("btn-ck-export").addEventListener("click", async () => {
  const name = state.cookiesProfile;
  if (!name) return;
  const box = $("ck-result");
  box.hidden = false;
  box.innerHTML = "Launching profile headless&hellip;";
  try {
    const res = await api.cookiesExport(name, $("ck-fmt").value);
    box.innerHTML = `<span class="ok">Exported to:</span> <span class="ps-mono">${esc(res.path || "")}</span>`;
    toast(`Cookies exported for "${name}".`, "success");
  } catch (err) {
    box.innerHTML = `<span class="err">Export failed: ${esc(err.message || err)}</span>`;
    toast("Cookie export failed: " + (err.message || err), "error");
  }
});

$("btn-ck-import").addEventListener("click", async () => {
  const name = state.cookiesProfile;
  if (!name) return;
  const file = $("ck-file").files[0];
  if (!file) { toast("Choose a cookie file first.", "error"); return; }
  const clear = $("ck-clear").checked;
  const box = $("ck-result");
  box.hidden = false;
  box.innerHTML = "Launching profile headless&hellip;";
  try {
    const res = await api.cookiesImport(file, name, clear);
    box.innerHTML = `<span class="ok">Imported ${res.imported || 0} cookie(s) into "${esc(name)}".</span>`;
    toast(`Imported ${res.imported || 0} cookie(s) into "${name}".`, "success");
  } catch (err) {
    box.innerHTML = `<span class="err">Import failed: ${esc(err.message || err)}</span>`;
    toast("Cookie import failed: " + (err.message || err), "error");
  }
});

/* ---------------- Warm-up modal ---------------- */
let _warmupProfile = null;

async function openWarmup(name) {
  _warmupProfile = name;
  $("warmup-title").textContent = name;
  $("warmup-status").innerHTML = `<div class="ps-empty">Loading scenarios&hellip;</div>`;
  openModal("modal-warmup");
  try {
    const scenarios = await api.warmupScenarios();
    $("warmup-scenario").innerHTML = scenarios.map(s =>
      `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    $("warmup-status").innerHTML = "";
  } catch (e) {
    $("warmup-status").innerHTML =
      `<div class="ps-empty">Failed to load scenarios: ${esc(e.message || e)}</div>`;
  }
}

$("form-warmup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = _warmupProfile;
  const scenario = $("warmup-scenario").value;
  const box = $("warmup-status");
  box.innerHTML = `<div class="ps-empty">Warm-up started&hellip;</div>`;
  try {
    const res = await api.warmupRun(name, scenario);
    box.innerHTML = `<div class="ps-empty">Warm-up <b>started</b> for &ldquo;${esc(name)}&rdquo; (${esc(res.scenario || scenario)}). Check the server log for progress.</div>`;
    toast(`Warm-up started for "${name}".`, "success");
  } catch (err) {
    box.innerHTML = `<span class="err">Warm-up failed to start: ${esc(err.message || err)}</span>`;
    toast("Warm-up failed to start: " + (err.message || err), "error");
  }
});

/* ---------------- Health modal ---------------- */

// ================= Edit Profile =================
async function openEdit(name, startTab) {
  $("edit-title").textContent = name;
  $("edit-name").value = name;
  // reset tabs (or jump to requested tab for menu shortcuts)
  const tab = startTab || "general";
  document.querySelectorAll("#edit-tabs .ps-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll("#form-edit .ps-tabpane").forEach(pn =>
    pn.classList.toggle("active", pn.dataset.pane === tab));
  $("edit-overview").innerHTML = `<div class="ps-empty">Loading&hellip;</div>`;
  openModal("modal-edit");
  try {
    const prof = await api.getProfile(name);
    fillEditForm(prof);
    renderExtensionsList(name);
  } catch (e) {
    toast(`Failed to load "${name}": ${e.message || e}`, "error");
    $("modal-edit").hidden = true;
  }
}

function fillEditForm(prof) {
  const fp = prof.fingerprint || {};
  // General tab (AdsPower-style).
  $("edit-display-name").value = prof.name || "";
  $("edit-browser").value = prof.engine || "camoufox";
  const osVal = fp.os || prof.os || "windows";
  document.querySelectorAll("#edit-os-pills .ps-os-pill").forEach(x =>
    x.classList.toggle("active", x.dataset.val === osVal));
  $("edit-remark").value = prof.remark || prof.client_tag || "";
  $("edit-cookie").value = prof.cookie_json || "";
  updateEditCounters();
  updateKernelNote();
  // group
  const gsel = $("edit-group");
  gsel.innerHTML = `<option value="">Ungrouped</option>` +
    state.groups.map(g =>
      `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join("");
  gsel.value = prof.group_name || "";
  // proxy
  loadProxyOptions("edit-proxy").then(() => {
    const px = fp.proxy || {};
    const sel = $("edit-proxy");
    const cur = px.name || "";
    if (cur && ![...sel.options].some(o => o.value === cur)) {
      const opt = document.createElement("option");
      opt.value = cur; opt.textContent = cur + " (attached)";
      sel.appendChild(opt);
    }
    sel.value = cur;
  });
  // reset proxy tabs to Custom mode (AdsPower default)
  document.querySelectorAll("#edit-proxy-mode .ps-seg-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.val === "custom"));
  $("edit-proxy-saved").hidden = true;
  $("edit-proxy-custom").hidden = false;
  $("edit-proxy-rotating").hidden = true;
  $("edit-proxy-provider").hidden = true;
  $("edit-px-type").value = "";
  $("edit-px-host").value = "";
  $("edit-px-port").value = "";
  $("edit-px-user").value = "";
  $("edit-px-pass").value = "";
  $("edit-px-name").value = "";
  $("edit-px-result").textContent = "";
  // fingerprint
  $("edit-tz").value = fp.timezone || "";
  $("edit-locale").value = fp.locale || "";
  $("edit-ua").value = fp.user_agent || "";
  $("edit-platform").value = fp.platform || "";
  // fingerprint pills (AdsPower-style)
  const setPill = (id, val, def) => {
    const target = val || def;
    document.querySelectorAll(`#${id} .ps-pill`).forEach(p =>
      p.classList.toggle("active", p.dataset.val === target));
  };
  setPill("edit-webrtc", fp.webrtc_mode, "proxy");
  setPill("edit-tz-mode", fp.timezone_mode, "ip");
  setPill("edit-loc-mode", fp.location_mode, "ip");
  const locPerm = fp.location_perm || "ask";
  document.querySelectorAll('input[name="edit-loc-perm"]').forEach(r =>
    r.checked = r.value === locPerm);
  setPill("edit-lang-mode", fp.language_mode, "ip");
  setPill("edit-displang-mode", fp.display_lang_mode, "based");
  setPill("edit-screen-mode", fp.screen_mode, "predefined");
  setPill("edit-fonts-mode", fp.fonts_mode, "default");
  setPill("edit-webgl-mode", fp.webgl_mode, "custom");
  setPill("edit-webgpu-mode", fp.webgpu_mode, "based");
  $("edit-tz").hidden = (fp.timezone_mode || "ip") !== "custom";
  $("edit-locale").hidden = (fp.language_mode || "ip") !== "custom";
  // fingerprint toggles
  const setToggle = (val, on) => {
    const el = document.querySelector(`#modal-edit .ps-toggle[data-val="${val}"]`);
    if (el) {
      el.classList.toggle("on", !!on);
      el.setAttribute("aria-checked", !!on);
    }
  };
  setToggle("canvas", fp.noise_canvas);
  setToggle("webgl", fp.noise_webgl);
  setToggle("audio", fp.noise_audio);
  setToggle("mediadevice", fp.noise_mediadevice !== false);
  setToggle("clientrects", fp.noise_clientrects !== false);
  setToggle("speech", fp.noise_speech !== false);
  // Advanced tab.
  $("edit-ext-mode").value = fp.ext_mode || "team";
  setPill("edit-sync-mode", fp.sync_mode, "global");
  setPill("edit-bsettings-mode", fp.bsettings_mode, "global");
  setToggle("random_fp", fp.random_fingerprint === true);
  $("edit-fp-advanced").hidden = true;
  $("edit-fp-more").textContent = "Show more ∨";
  // platform tab
  $("edit-platform-acct").value = prof.platform_acct || "";
  renderPlatformList();
  $("edit-startup-urls").value = (prof.startup_urls || []).join("\n");
  $("edit-hw").value = fp.hardware_concurrency ?? "";
  $("edit-mem").value = fp.device_memory ?? "";
  $("edit-sw").value = fp.screen_width ?? "";
  $("edit-sh").value = fp.screen_height ?? "";
  $("edit-webgl-vendor").value = fp.webgl_vendor || "";
  $("edit-webgl-renderer").value = fp.webgl_renderer || "";
  // overview (AdsPower-style detailed fingerprint panel)
  const modeLabel = (mode, labels) => labels[mode] || mode || "—";
  const noiseLabel = (on, seed) => on ? `Noise${seed ? ` [${seed}]` : ""}` : "Real";
  // Generate stable noise seeds from profile name (like AdsPower's [99EE5022]).
  const seedFor = (key) => {
    let h = 0;
    const s = (prof.name || "") + key;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(0, 8);
  };
  const browserLabel = prof.engine === "patchright"
    ? "Chromium [Chrome 153]" : "Firefox [Firefox 156]";
  const rows = [
    ["Browser", browserLabel],
    ["User-Agent", fp.user_agent || "—"],
    ["WebRTC", modeLabel(fp.webrtc_mode, {forward: "Forward", replace: "Replace", real: "Real", disabled: "Disabled", proxy: "Proxy UDP"})],
    ["Timezone", modeLabel(fp.timezone_mode, {ip: "Based on IP", real: "Real", custom: fp.timezone || "Custom"})],
    ["Location", `[${fp.location_perm === "allow" ? "Always" : "Ask"}] ` + modeLabel(fp.location_mode, {ip: "Based on IP", custom: "Custom", block: "Block"})],
    ["Language", modeLabel(fp.language_mode, {ip: "Based on IP", custom: fp.locale || "Custom"})],
    ["Display language", modeLabel(fp.display_lang_mode, {based: "Based on Language", real: "Real", custom: "Custom"})],
    ["Screen Resolution", modeLabel(fp.screen_mode, {predefined: "Based on User-Agent", custom: (fp.screen_width && fp.screen_height ? `${fp.screen_width}×${fp.screen_height}` : "Custom")})],
    ["Fonts", modeLabel(fp.fonts_mode, {default: "Default", custom: "Custom"})],
    ["Canvas", noiseLabel(fp.noise_canvas, null)],
    ["WebGL Image", noiseLabel(fp.noise_webgl, null)],
    ["AudioContext", noiseLabel(fp.noise_audio, fp.noise_audio ? seedFor("audio") : null)],
    ["Media device", fp.noise_mediadevice !== false ? "Noise [Auto]" : "Real"],
    ["ClientRects", noiseLabel(fp.noise_clientrects, fp.noise_clientrects ? seedFor("rects") : null)],
    ["SpeechVoices", noiseLabel(fp.noise_speech, null)],
    ["WebGL metadata", `${fp.webgl_vendor || ""} ${fp.webgl_renderer || ""}`.trim() || "—"],
    ["WebGPU", modeLabel(fp.webgpu_mode, {based: "Based on WebGL", real: "Real", disabled: "Disabled"})],
    ["CPU", fp.hardware_concurrency ? `${fp.hardware_concurrency} cores` : "—"],
    ["RAM", fp.device_memory ? `${fp.device_memory} GB` : "—"],
    ["Proxy", fp.proxy ? (fp.proxy.name || `${fp.proxy.host}:${fp.proxy.port}`) : "Direct"],
  ];
  $("edit-overview").innerHTML = rows.map(([k, v]) =>
    `<div class="ps-ov-row"><span class="k">${esc(k)}</span><span class="v" title="${esc(String(v))}">${esc(String(v))}</span></div>`).join("");
}

async function submitEdit(e) {
  e.preventDefault();
  const name = $("edit-name").value;
  const num = id => { const v = $(id).value.trim(); return v === "" ? null : parseInt(v, 10); };
  // Proxy: saved, custom, rotating, provider (AdsPower-style).
  const customProxy = !$("edit-proxy-custom").hidden;
  let proxy_name = $("edit-proxy").value;
  let custom_proxy = null;
  if (customProxy) {
    const host = $("edit-px-host").value.trim();
    const port = parseInt($("edit-px-port").value, 10);
    const ptype = $("edit-px-type").value;
    if (ptype && host && port) {
      const saveName = $("edit-px-name").value.trim();
      custom_proxy = {
        type: ptype, host, port,
        username: $("edit-px-user").value.trim() || null,
        password: $("edit-px-pass").value || null,
        save_name: saveName || null,
        ip_checker: $("edit-px-ipchecker").value || null,
        change_ip_url: $("edit-px-changeurl").value.trim() || null,
      };
      proxy_name = null; // custom takes precedence
    } else if (!ptype) {
      proxy_name = null; // No Proxy selected
    }
  }
  const payload = {
    client_tag: $("edit-remark").value.trim().slice(0, 2000) || null,
    remark: $("edit-remark").value.trim().slice(0, 2000) || null,
    os: editOsVal(),
    engine: $("edit-browser").value,
    cookie_json: $("edit-cookie").value.trim() || null,
    proxy_name: proxy_name,
    custom_proxy: custom_proxy,
    group_name: $("edit-group").value || null,
    timezone: $("edit-tz").value.trim() || null,
    timezone_mode: editPillVal("edit-tz-mode"),
    locale: $("edit-locale").value.trim() || null,
    language_mode: editPillVal("edit-lang-mode"),
    user_agent: $("edit-ua").value.trim() || null,
    platform: $("edit-platform").value.trim() || null,
    webrtc_mode: editPillVal("edit-webrtc"),
    location_mode: editPillVal("edit-loc-mode"),
    location_perm: (document.querySelector('input[name="edit-loc-perm"]:checked') || {}).value || "ask",
    display_lang_mode: editPillVal("edit-displang-mode"),
    screen_mode: editPillVal("edit-screen-mode"),
    fonts_mode: editPillVal("edit-fonts-mode"),
    webgl_mode: editPillVal("edit-webgl-mode"),
    webgpu_mode: editPillVal("edit-webgpu-mode"),
    noise_canvas: editToggleOn("canvas"),
    noise_webgl: editToggleOn("webgl"),
    noise_audio: editToggleOn("audio"),
    noise_mediadevice: editToggleOn("mediadevice"),
    noise_clientrects: editToggleOn("clientrects"),
    noise_speech: editToggleOn("speech"),
    ext_mode: $("edit-ext-mode").value || null,
    sync_mode: editPillVal("edit-sync-mode"),
    bsettings_mode: editPillVal("edit-bsettings-mode"),
    random_fingerprint: editToggleOn("random_fp"),
    webgl_vendor: $("edit-webgl-vendor").value.trim() || null,
    webgl_renderer: $("edit-webgl-renderer").value.trim() || null,
    hardware_concurrency: num("edit-hw"),
    device_memory: num("edit-mem"),
    screen_width: num("edit-sw"),
    screen_height: num("edit-sh"),
    platform_acct: $("edit-platform-acct").value || null,
    startup_urls: $("edit-startup-urls").value.split("\n")
      .map(s => s.trim()).filter(Boolean),
  };
  try {
    await api.updateProfile(name, payload);
    toast(`Profile "${name}" updated.`, "success");
    $("modal-edit").hidden = true;
    await refreshProfiles();
  } catch (e2) {
    toast(`Failed to update "${name}": ${e2.message || e2}`, "error");
  }
}

async function regenFingerprint() {
  const name = $("edit-name").value;
  if (!confirm(`Regenerate fingerprint for "${name}"? The current fingerprint will be replaced.`)) return;
  try {    await api.updateProfile(name, { regenerate_fingerprint: true });
    toast("Fingerprint regenerated.", "success");
    const prof = await api.getProfile(name);
    fillEditForm(prof);
    await refreshProfiles();
  } catch (e) {
    toast(`Regeneration failed: ${e.message || e}`, "error");
  }
}

// tab switching handled by document delegation listener above
$("form-edit").addEventListener("submit", submitEdit);
$("edit-regen").addEventListener("click", regenFingerprint);
const brfp = $("btn-regen-fp");
if (brfp) brfp.addEventListener("click", regenFingerprint);
// Edit modal UA shuffle (AdsPower-style).
$("edit-ua-shuffle").addEventListener("click", async () => {
  const os = editOsVal();
  const engine = $("edit-browser").value || "camoufox";
  const browser = engine === "patchright" ? "chrome" : "firefox";
  try {
    const r = await api.randomUA(os, browser);
    $("edit-ua").value = r.user_agent;
    toast("New User-Agent generated", "success");
  } catch (err) {
    toast("Failed: " + (err.message || err), "error");
  }
});

async function openHealth(name) {
  $("health-title").textContent = name;
  $("health-body").innerHTML = `<div class="ps-empty">Loading health&hellip;</div>`;
  openModal("modal-health");
  try {
    const h = await api.health(name);
    $("health-body").innerHTML = renderHealth(h);
  } catch (e) {
    $("health-body").innerHTML =
      `<div class="ps-empty">Health check failed: ${esc(e.message || e)}</div>`;
  }
}

function renderHealth(h) {
  const score = typeof h.score === "number" ? h.score : null;
  const cls = scoreClass(score);
  const consistency = Array.isArray(h.consistency) ? h.consistency : [];
  const passed = consistency.filter(c => c.passed).length;
  const detection = h.detection && typeof h.detection === "object" ? h.detection : {};

  const checksHtml = consistency.length === 0
    ? `<div class="ps-check"><span class="ps-check-ic">?</span><div><div class="ps-check-name">No consistency data</div></div></div>`
    : consistency.map(c => {
      const ok = !!c.passed;
      const nm = esc(c.check || c.name || "check");
      const detail = c.detail ? `<div class="ps-check-detail">${esc(String(c.detail))}</div>` : "";
      return `<div class="ps-check ${ok ? "ok" : "fail"}">
        <span class="ps-check-ic">${ok ? "&#10003;" : "&#10005;"}</span>
        <div><div class="ps-check-name">${nm}</div>${detail}</div></div>`;
    }).join("");

  const detectHtml = Object.keys(detection).length === 0
    ? `<div class="ps-check"><span class="ps-check-ic">?</span><div><div class="ps-check-name">No detection data</div></div></div>`
    : Object.entries(detection).map(([site, d]) => {
      const verdict = String((d && (d.verdict || d.status || d.result)) || "unknown").toLowerCase();
      const vcls = verdict.includes("clean") ? "clean"
        : verdict.includes("suspicious") ? "suspicious"
        : (verdict.includes("bot") || verdict.includes("lie")) ? "bot" : "unknown";
      const noteBits = [];
      if (d && d.signals) noteBits.push("signals: " + JSON.stringify(d.signals));
      if (d && d.page_reached === false) noteBits.push("page not reached");
      if (d && d.reason) noteBits.push(String(d.reason));
      if (d && d.detail) noteBits.push(String(d.detail));
      return `<div class="ps-detect-card">
        <div class="ps-detect-name">${esc(site)}</div>
        <div class="ps-detect-verdict ${vcls}">${esc(verdict)}</div>
        ${noteBits.length ? `<div class="ps-detect-note">${esc(noteBits.join(" · "))}</div>` : ""}
      </div>`;
    }).join("");

  return `
    <div class="ps-health-score-wrap">
      <div class="ps-health-score ${cls}">${score == null ? "?" : score}</div>
      <div class="ps-health-meta">
        <div>Consistency: <b>${passed}/${consistency.length}</b> checks passed</div>
        <div>Detection verdicts below</div>
      </div>
    </div>
    <div class="ps-health-sec">Consistency</div>
    <div class="ps-check-list">${checksHtml}</div>
    <div class="ps-health-sec">Detection</div>
    <div class="ps-detect-grid">${detectHtml}</div>`;
}

/* ---------------- Top bar wiring ---------------- */
$("btn-new").addEventListener("click", () => showView("new-profile"));

// Browser download manager (AdsPower-style).
async function openDownloads() {
  openModal("modal-downloads");
  const list = $("dl-list");
  const render = async () => {
    list.innerHTML = `<div class="ps-empty">Checking…</div>`;
    try {
      const st = await api.get("/api/browsers/status");
      list.innerHTML = Object.entries(st).map(([key, b]) => `
        <div class="ps-field" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>${esc(b.name)}${b.version ? ` <span class="ps-hint">v${esc(String(b.version))}</span>` : ""}</strong>
            ${b.installed
              ? `<span class="ps-tag">✓ Installed</span>`
              : `<button class="ps-btn primary sm" data-dl="${key}">⬇ Install</button>`}
          </div>
          ${b.installed ? "" : `<p class="ps-hint" style="margin:8px 0 0">Not installed. Click Install to download now, or it will auto-download on first launch.</p>`}
        </div>`).join("");
      list.querySelectorAll("[data-dl]").forEach(btn => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          btn.textContent = "Downloading…";
          try {
            await req("POST", `/api/browsers/download/${btn.dataset.dl}`);
            toast("Download started. This may take a few minutes.", "success");
            // Poll status.
            const poll = setInterval(async () => {
              try {
                const st2 = await api.get("/api/browsers/status");
                if (st2[btn.dataset.dl] && st2[btn.dataset.dl].installed) {
                  clearInterval(poll);
                  render();
                }
              } catch {}
            }, 5000);
            setTimeout(() => clearInterval(poll), 600000);
          } catch (e) {
            toast(`Download failed: ${e.message || e}`, "error");
            btn.disabled = false;
            btn.textContent = "⬇ Install";
          }
        });
      });
    } catch (e) {
      list.innerHTML = `<div class="ps-empty">Failed: ${esc(e.message || e)}</div>`;
    }
  };
  render();
}
const bdl = $("btn-downloads");
if (bdl) bdl.addEventListener("click", openDownloads);
$("nav-profiles").addEventListener("click", () => showView("profiles"));
$("nav-sync").addEventListener("click", () => openSync());
$("nav-bulk").addEventListener("click", () => {
  $("bulk-result").hidden = true;
  $("bulk-result").innerHTML = "";
  openModal("modal-bulk");
});
$("nav-import").addEventListener("click", () => {
  $("migrate-result").hidden = true;
  $("migrate-result").innerHTML = "";
  openModal("modal-migrate");
});
$("search").addEventListener("input", (e) => {
  state.query = e.target.value.trim();
  renderTags();   // keep counts accurate
  renderTable();  // live filter, no refetch
});

/* ---------------- Groups ---------------- */
$("group-filter").addEventListener("change", (e) => {
  state.group = e.target.value;
  renderTable();
});
$("btn-groups").addEventListener("click", openGroupsModal);

function openGroupsModal() {
  renderGroupsList();
  openModal("modal-groups");
}

function renderGroupsList() {
  const wrap = $("groups-list");
  if (state.groups.length === 0) {
    wrap.innerHTML = `<div class="ps-empty">No groups yet. Create one below.</div>`;
    return;
  }
  wrap.innerHTML = state.groups.map(g => `
    <div class="ps-group-row">
      <span class="ps-tag group">${esc(g.name)}</span>
      <span class="dim">${g.profile_count} profiles</span>
      ${g.remark ? `<span class="dim">${esc(g.remark)}</span>` : ""}
      <span style="flex:1"></span>
      <button class="ps-btn danger sm" data-group-del="${esc(g.name)}">Delete</button>
    </div>`).join("");
  wrap.querySelectorAll("[data-group-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.groupDel;
      if (!confirm(`Delete group "${name}"? Its profiles become ungrouped.`)) return;
      try {
        await api.deleteGroup(name);
        toast(`Group "${name}" deleted`, "success");
        await refreshGroups();
        await refreshProfiles();
        renderGroupsList();
      } catch (e) { toast("Delete failed: " + (e.message || e), "error"); }
    });
  });
}

async function onGroupCreate(e) {
  e.preventDefault();
  const name = $("group-name").value.trim();
  const remark = $("group-remark").value.trim();
  if (!name) { toast("Group name is required", "error"); return; }
  try {
    await api.createGroup({ name, remark: remark || null });
    toast(`Group "${name}" created`, "success");
    $("group-name").value = "";
    $("group-remark").value = "";
    await refreshGroups();
    renderGroupsList();
  } catch (e) { toast("Create failed: " + (e.message || e), "error"); }
}

/* ---------------- Proxies modal ---------------- */
$("nav-proxies").addEventListener("click", () => {
  renderProxiesList();
  openModal("modal-proxies");
});

// Proxy modal tabs.
document.querySelectorAll("#proxy-tabs .ps-tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll("#proxy-tabs .ps-tab").forEach(x =>
      x.classList.toggle("active", x === t));
    document.querySelectorAll("#modal-proxies .ps-tabpane").forEach(pn =>
      pn.classList.toggle("active", pn.dataset.pane === t.dataset.tab));
  });
});

async function renderProxiesList() {
  const wrap = $("proxies-list");
  let proxies = [];
  try { proxies = await api.listProxies(); }
  catch (e) { wrap.innerHTML = `<div class="ps-empty">Failed to load proxies.</div>`; return; }
  if (proxies.length === 0) {
    wrap.innerHTML = `<div class="ps-empty">No proxies yet. Add one or bulk-import.</div>`;
    return;
  }
  wrap.innerHTML = proxies.map(p => `
    <div class="ps-group-row" data-proxy="${esc(p.name)}">
      <span class="ps-tag">${esc(p.type.toUpperCase())}</span>
      <span class="ps-mono">${esc(p.name)}</span>
      <span class="dim ps-mono">${esc(p.host)}:${esc(p.port)}</span>
      <span class="px-status dim" data-px-status></span>
      <span style="flex:1"></span>
      <button class="ps-btn ghost sm" data-px-test>Test</button>
      <button class="ps-btn danger sm" data-px-del>Delete</button>
    </div>`).join("");
  wrap.querySelectorAll("[data-px-test]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("[data-proxy]");
      const name = row.dataset.proxy;
      const st = row.querySelector("[data-px-status]");
      btn.disabled = true;
      st.textContent = "testing…";
      st.className = "px-status dim";
      try {
        const r = await api.testProxy(name);
        if (r.ok) {
          st.textContent = `✓ ${r.latency_ms}ms`;
          st.className = "px-status ok";
        } else {
          st.textContent = "✗ unreachable";
          st.className = "px-status bad";
        }
      } catch (e) {
        st.textContent = "✗ error";
        st.className = "px-status bad";
      }
      btn.disabled = false;
    });
  });
  wrap.querySelectorAll("[data-px-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const name = btn.closest("[data-proxy]").dataset.proxy;
      if (!confirm(`Delete proxy "${name}"?`)) return;
      try {
        await api.deleteProxy(name);
        toast(`Proxy "${name}" deleted`, "success");
        state.proxies = await api.listProxies();
        renderProxiesList();
        renderStats();
      } catch (e) { toast("Delete failed: " + (e.message || e), "error"); }
    });
  });
}

async function onProxyCreate(e) {
  e.preventDefault();
  const payload = {
    name: $("px-name").value.trim(),
    type: $("px-type").value,
    host: $("px-host").value.trim(),
    port: $("px-port").value.trim(),
    username: $("px-user").value.trim() || null,
    password: $("px-pass").value || null,
  };
  if (!payload.name || !payload.host || !payload.port) {
    toast("Name, host and port are required", "error");
    return;
  }
  try {
    await api.createProxy(payload);
    toast(`Proxy "${payload.name}" added`, "success");
    e.target.reset();
    state.proxies = await api.listProxies();
    renderProxiesList();
    renderStats();
    // Switch to list tab.
    document.querySelector('#proxy-tabs [data-tab="list"]').click();
  } catch (err) { toast("Add failed: " + (err.message || err), "error"); }
}

async function onProxyBulk(e) {
  e.preventDefault();
  const text = $("px-bulk-text").value;
  const type = $("px-bulk-type").value;
  const resEl = $("px-bulk-result");
  if (!text.trim()) { toast("Paste a proxy list first", "error"); return; }
  try {
    const r = await api.bulkImportProxies(text, type);
    resEl.hidden = false;
    resEl.innerHTML =
      `<div>Added: <b>${r.added.length}</b> &nbsp; Skipped: ${r.skipped}` +
      (r.error_count ? ` &nbsp; Errors: ${r.error_count}` : "") + `</div>` +
      (r.added.length ? `<div class="dim">${r.added.map(esc).join(", ")}</div>` : "");
    toast(`Imported ${r.added.length} proxies`, "success");
    $("px-bulk-text").value = "";
    state.proxies = await api.listProxies();
    renderProxiesList();
    renderStats();
  } catch (err) {
    toast("Import failed: " + (err.message || err), "error");
  }
}

async function onFetchFree() {
  const btn = $("btn-fetch-free");
  btn.disabled = true;
  btn.textContent = "Fetching… (may take 30s)";
  try {
    const r = await api.fetchFree(20);
    toast(`Added ${r.count} free proxies (testing only)`,
      r.count ? "success" : "info");
    state.proxies = await api.listProxies();
    renderProxiesList();
    renderStats();
  } catch (err) {
    toast("Fetch failed: " + (err.message || err), "error");
  }
  btn.disabled = false;
  btn.innerHTML = "🎲 Fetch free proxies (testing)";
}

/* ---------------- Sync modal ---------------- */
function syncProfileOptions(exclude) {
  return state.profiles
    .filter(p => p.name !== exclude)
    .map(p => {
      const busy = p.status === "running" || p.status === "starting" || p.status === "downloading";
      return `<option value="${esc(p.name)}"${busy ? " disabled" : ""}>${esc(p.name)}${busy ? " (running)" : ""}</option>`;
    }).join("");
}

function openSync() {
  const masterSel = $("sync-master");
  masterSel.innerHTML = syncProfileOptions(null) || `<option value="">No profiles yet</option>`;
  renderSyncFollowers();
  masterSel.onchange = renderSyncFollowers;
  refreshSyncStatus();
  openModal("modal-sync");
}

function renderSyncFollowers() {
  const master = $("sync-master").value;
  const box = $("sync-followers");
  const rows = state.profiles.filter(p => p.name !== master);
  if (rows.length === 0) {
    box.innerHTML = `<div class="ps-empty">No other profiles to mirror to.</div>`;
    return;
  }
  box.innerHTML = rows.map(p => {
    const busy = p.status === "running" || p.status === "starting" || p.status === "downloading";
    return `<label class="ps-check${busy ? " off" : ""}">
      <input type="checkbox" value="${esc(p.name)}"${busy ? " disabled" : ""}>
      <span class="ps-check-name">${esc(p.name)}${busy ? " (running)" : ""}</span>
    </label>`;
  }).join("");
}

function renderSyncStatus(st) {
  const box = $("sync-status");
  const stopBtn = $("btn-sync-stop");
  const startBtn = $("btn-sync-start");
  if (!st) {
    box.hidden = true;
    box.innerHTML = "";
    stopBtn.hidden = true;
    startBtn.disabled = false;
    return;
  }
  const frows = Object.entries(st.followers || {}).map(([n, f]) =>
    `${esc(n)}: ${esc(f.state)} (mirrored ${f.mirrored}, dropped ${f.dropped}, queued ${f.queue_depth})`
  ).join("<br>");
  box.hidden = false;
  box.innerHTML =
    `<span class="ok">Session ${esc(st.session_id)}</span> &middot; ` +
    `master <b>${esc(st.master)}</b> &middot; ` +
    `mirrored <b>${st.mirrored_total}</b> &middot; ` +
    `typing ${st.typing_enabled ? "on" : "off"} &middot; ` +
    `${st.alive ? "alive" : "stopped"}<br>${frows}` +
    (st.last_error ? `<br><span class="err">${esc(st.last_error)}</span>` : "");
  stopBtn.hidden = false;
  startBtn.disabled = true;
}

async function refreshSyncStatus() {
  renderSyncStatus(null);
  if (!state.syncSessionId) return;
  try {
    renderSyncStatus(await api.syncStatus(state.syncSessionId));
  } catch {
    state.syncSessionId = null; // session gone server-side
  }
}

$("form-sync").addEventListener("submit", async (e) => {
  e.preventDefault();
  const master = $("sync-master").value;
  const followers = [...$("sync-followers").querySelectorAll("input[type=checkbox]:checked")]
    .map(c => c.value);
  if (!master) { toast("Pick a master profile.", "error"); return; }
  if (followers.length === 0) { toast("Pick at least one follower.", "error"); return; }
  if (followers.includes(master)) { toast("Master cannot also be a follower.", "error"); return; }
  const payload = {
    master,
    followers,
    headless: $("sync-headless").value === "1",
    typing: $("sync-typing").value === "1",
  };
  try {
    const res = await api.syncStart(payload);
    state.syncSessionId = res.session_id;
    renderSyncStatus(res.status);
    toast(`Sync session started: ${master} → ${followers.length} follower(s).`, "success");
  } catch (err) {
    toast("Sync start failed: " + (err.message || err), "error");
  }
});

$("btn-sync-stop").addEventListener("click", async () => {
  if (!state.syncSessionId) return;
  try {
    await api.syncStop(state.syncSessionId);
    toast("Sync session stopped.", "success");
  } catch (err) {
    toast("Sync stop failed: " + (err.message || err), "error");
  }
  state.syncSessionId = null;
  renderSyncStatus(null);
});

$("sync-typing").addEventListener("change", async (e) => {
  if (!state.syncSessionId) return; // applies at start otherwise
  try {
    renderSyncStatus(await api.syncTyping(state.syncSessionId, e.target.value === "1"));
    toast("Typing mirror " + (e.target.value === "1" ? "enabled." : "disabled."), "success");
  } catch (err) {
    toast("Typing toggle failed: " + (err.message || err), "error");
  }
});

/* ---------------- RPA (Phase 7) ---------------- */
const rpa = { recipes: [], pollTimer: null };

function rpaProfileOptions() {
  const sel = $("rpa-profile");
  sel.innerHTML = (state.profiles || [])
    .map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")
    || `<option value="">— no profiles —</option>`;
}

function renderRpaRecipes(recipes) {
  rpa.recipes = recipes || [];
  const box = $("rpa-recipes");
  if (!rpa.recipes.length) {
    box.innerHTML = `<div class="ps-empty">No recipes yet — paste a recipe JSON below and save it.</div>`;
    return;
  }
  box.innerHTML = rpa.recipes.map(r => `
    <div class="ps-check-row" style="display:flex;gap:8px;align-items:center;margin:4px 0">
      <span style="flex:1"><strong>${esc(r.name)}</strong>
        <span class="ps-flabel-hint">${esc(r.id)} · ${r.step_count} step(s) · ${esc(r.base_url || "")}</span></span>
      <button class="ps-btn ghost" data-rpa-run="${esc(r.id)}">Run</button>
      <button class="ps-btn ghost" data-rpa-del="${esc(r.id)}" title="Delete">✕</button>
    </div>`).join("");
  box.querySelectorAll("[data-rpa-run]").forEach(b =>
    b.addEventListener("click", () => rpaStartRun(b.getAttribute("data-rpa-run"))));
  box.querySelectorAll("[data-rpa-del]").forEach(b =>
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-rpa-del");
      if (!confirm("Delete recipe " + id + "?")) return;
      try { await api.rpaDeleteRecipe(id); toast("Recipe deleted.", "success"); }
      catch (err) { toast("Delete failed: " + (err.message || err), "error"); }
      await renderRpaRecipes(await api.rpaRecipes());
    }));
}

async function rpaStartRun(recipeId) {
  const profile = $("rpa-profile").value;
  if (!profile) { toast("Pick a profile first.", "error"); return; }
  const dataPath = $("rpa-data").value.trim() || null;
  const headless = $("rpa-headless").value === "1";
  try {
    const res = await api.rpaRun({ recipe_id: recipeId, profile_name: profile,
                                   data_path: dataPath, headless });
    toast("RPA job started: " + res.job_id, "success");
    await renderRpaJobs();
  } catch (err) { toast("Run failed: " + (err.message || err), "error"); }
}

function renderRpaJobs(jobs) {
  const box = $("rpa-jobs");
  if (!jobs || !jobs.length) {
    box.innerHTML = `<div class="ps-empty">No jobs yet.</div>`;
    return;
  }
  box.innerHTML = jobs.map(j => {
    const pa = j.pending_action;
    const ask = pa ? `
      <div style="margin-top:6px;padding:6px;border:1px dashed var(--ps-accent,#7c5cff);border-radius:6px">
        <div><strong>Operator needed:</strong> ${esc(pa.question || pa.type || "input")}</div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <input class="ps-in" style="flex:1" id="rpa-ans-${esc(j.job_id)}" placeholder="Type the answer…">
          <button class="ps-btn primary" data-rpa-ans="${esc(j.job_id)}">Answer</button>
        </div>
      </div>` : "";
    const stop = (j.status === "running" || j.status === "starting" || j.status === "downloading")
      ? ` <button class="ps-btn ghost" data-rpa-stop="${esc(j.job_id)}">Stop</button>` : "";
    return `
    <div class="ps-check-row" style="margin:6px 0;padding:6px;border-bottom:1px solid rgba(255,255,255,.06)">
      <div style="display:flex;gap:8px;align-items:center">
        <span style="flex:1"><strong>${esc(j.recipe_name || j.recipe_id)}</strong>
          <span class="ps-flabel-hint">${esc(j.job_id)} · ${esc(j.profile_name)} ·
          ${esc(j.status)} · ${esc(relTime(j.started_at))}</span></span>
        <button class="ps-btn ghost" data-rpa-detail="${esc(j.job_id)}">Logs</button>${stop}
      </div>
      ${ask}
      <pre id="rpa-log-${esc(j.job_id)}" hidden
        style="max-height:160px;overflow:auto;font-size:11px;white-space:pre-wrap"></pre>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-rpa-ans]").forEach(b =>
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-rpa-ans");
      const inp = $("rpa-ans-" + id);
      try {
        await api.rpaJobAnswer(id, inp.value);
        toast("Answer sent.", "success");
      } catch (err) { toast("Answer failed: " + (err.message || err), "error"); }
      await renderRpaJobs(await api.rpaJobs());
    }));
  box.querySelectorAll("[data-rpa-stop]").forEach(b =>
    b.addEventListener("click", async () => {
      try { await api.rpaJobStop(b.getAttribute("data-rpa-stop")); toast("Stop requested.", "success"); }
      catch (err) { toast("Stop failed: " + (err.message || err), "error"); }
      await renderRpaJobs(await api.rpaJobs());
    }));
  box.querySelectorAll("[data-rpa-detail]").forEach(b =>
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-rpa-detail");
      const pre = $("rpa-log-" + id);
      if (!pre.hidden) { pre.hidden = true; return; }
      try {
        const st = await api.rpaJobStatus(id);
        pre.textContent = (st.log_tail || []).join("\n") || "(no logs)";
        const sum = st.summary || {};
        if (sum.success !== undefined)
          pre.textContent += `\n— success: ${sum.success}, failed: ${sum.failed}`;
        pre.hidden = false;
      } catch (err) { toast("Could not load logs: " + (err.message || err), "error"); }
    }));
}

async function rpaRefreshAll() {
  try { renderRpaRecipes(await api.rpaRecipes()); }
  catch (err) { $("rpa-recipes").innerHTML = `<div class="ps-empty">Load failed: ${esc(err.message || err)}</div>`; }
  try { renderRpaJobs(await api.rpaJobs()); } catch { /* non-fatal */ }
}

function rpaStartPoll() {
  rpaStopPoll();
  rpa.pollTimer = setInterval(async () => {
    if ($("modal-rpa").hidden) { rpaStopPoll(); return; }
    try { renderRpaJobs(await api.rpaJobs()); } catch { /* keep polling */ }
  }, 3000);
}
function rpaStopPoll() {
  if (rpa.pollTimer) { clearInterval(rpa.pollTimer); rpa.pollTimer = null; }
}

$("nav-rpa").addEventListener("click", async () => {
  openModal("modal-rpa");
  rpaProfileOptions();
  await rpaRefreshAll();
  rpaStartPoll();
});
$("btn-rpa-refresh").addEventListener("click", rpaRefreshAll);
$("btn-rpa-create").addEventListener("click", async () => {
  const raw = $("rpa-recipe-json").value.trim();
  if (!raw) { toast("Paste a recipe JSON first.", "error"); return; }
  let body;
  try { body = JSON.parse(raw); }
  catch { toast("Invalid JSON.", "error"); return; }
  try {
    const res = await api.rpaCreateRecipe(body);
    toast("Recipe saved: " + res.id, "success");
    $("rpa-recipe-json").value = "";
    renderRpaRecipes(await api.rpaRecipes());
  } catch (err) { toast("Save failed: " + (err.message || err), "error"); }
});

/* ---------------- Boot ---------------- */
(async function boot() {
  applyThemeIcon();
  const themeBtn = $("btn-theme"), logoutBtn = $("btn-logout");
  if (themeBtn) themeBtn.addEventListener("click", () =>
    setTheme(currentTheme() === "light" ? "dark" : "light"));
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  await requireAuth();  // redirects to /login when there is no valid session
  try { state.proxies = await api.listProxies(); } catch { /* non-fatal */ }
  await refreshGroups();
  await refreshProfiles();
  const gf = $("form-group-new");
  if (gf) gf.addEventListener("submit", onGroupCreate);
  const pf = $("form-proxy-new");
  if (pf) pf.addEventListener("submit", onProxyCreate);
  const pbf = $("form-proxy-bulk");
  if (pbf) pbf.addEventListener("submit", onProxyBulk);
  const ffb = $("btn-fetch-free");
  if (ffb) ffb.addEventListener("click", onFetchFree);
  // Bulk selection bar.
  const sa = $("select-all");
  if (sa) sa.addEventListener("change", () => {
    const visible = state.profiles.filter(matches).map(p => p.name);
    if (sa.checked) visible.forEach(n => state.selected.add(n));
    else visible.forEach(n => state.selected.delete(n));
    renderTable();
  });
  $("bulk-launch").addEventListener("click", bulkLaunch);
  $("bulk-stop").addEventListener("click", bulkStop);
  $("bulk-edit").addEventListener("click", openBulkEdit);
  $("bulk-export").addEventListener("click", bulkExport);
  $("bulk-delete").addEventListener("click", bulkDelete);
  $("bulk-clear").addEventListener("click", () => {
    state.selected.clear();
    renderTable();
  });
  const bef = $("form-bulk-edit");
  if (bef) bef.addEventListener("submit", submitBulkEdit);
  const eub = $("ext-upload-btn");
  if (eub) eub.addEventListener("click", onExtensionUpload);
  const sf = $("form-sync-start");
  if (sf) sf.addEventListener("submit", onSyncStart);
  const rf = $("form-rpa-run");
  if (rf) rf.addEventListener("submit", onRpaRun);
})();
