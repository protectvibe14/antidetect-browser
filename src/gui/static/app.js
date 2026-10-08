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
  body.innerHTML = rows.map(p => {
    const name = esc(p.name);
    const starting = p.status === "starting" || p.status === "downloading";
    const running = p.status === "running";
    const dl = p.status === "downloading";
    const launchBtn = starting
      ? `<button class="ps-btn ghost sm" disabled>${dl ? "Downloading browser&hellip;" : "Starting&hellip;"}</button>`
      : running
        ? `<button class="ps-btn ghost sm" data-act="stop">&#9632; Stop</button>`
        : `<button class="ps-btn primary sm" data-act="launch">&#9654; Launch</button>`;
    const tag = p.client_tag
      ? `<span class="ps-tag">${esc(p.client_tag)}</span>`
      : `<span class="ps-tag none">&mdash;</span>`;
    const proxy = p.proxy_label
      ? `<span class="ps-proxy"><span class="ps-proxy-ic">&#8646;</span>${esc(p.proxy_label)}</span>`
      : `<span class="ps-proxy off">Direct</span>`;
    const group = p.group_name
      ? `<span class="ps-tag group">${esc(p.group_name)}</span>`
      : `<span class="ps-tag none">&mdash;</span>`;
    return `<tr data-name="${name}">
      <td><input type="checkbox" class="row-select" data-name="${name}"${state.selected.has(name) ? " checked" : ""}></td>
      <td>${statusCell(p)}</td>
      <td><div class="ps-name-row"><span class="ps-name">${name}</span></div></td>
      <td>${group}</td>
      <td>${tag}</td>
      <td><span class="ps-os">${esc(p.os || "?")}</span></td>
      <td>${proxy}</td>
      <td><span class="ps-mono dim">${esc(relTime(p.last_used))}</span></td>
      <td><div class="ps-actions">
        ${launchBtn}
        <button class="ps-btn ghost sm" data-act="health">&#10003; Health</button>
        <button class="ps-btn ghost sm" data-act="warmup">&#9728; Warm up</button>
        <button class="ps-btn ghost sm" data-act="edit">&#9998; Edit</button>
        <button class="ps-btn ghost sm" data-act="cookies">&#127850; Cookies</button>
        <button class="ps-btn danger sm" data-act="delete">&#10005;</button>
      </div></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("tr[data-name]").forEach(tr => {
    const name = tr.dataset.name;
    tr.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", () => onAction(name, btn.dataset.act));
    });
    const cb = tr.querySelector(".row-select");
    if (cb) cb.addEventListener("change", () => {
      if (cb.checked) state.selected.add(name);
      else state.selected.delete(name);
      renderBulkBar();
    });
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

/* ---------------- Extensions (per-profile) ---------------- */
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
  e.preventDefault();
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
$("btn-sync").addEventListener("click", () => {
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
$("btn-rpa").addEventListener("click", () => {
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
$("btn-activity").addEventListener("click", () => {
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
async function onAction(name, act) {
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
    }
    await refreshProfiles();
  } catch (e) {
    toast(actionError(act, name, e), "error");
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
  if (!file) { toast("Choose a CSV file first.", "error"); return; }
  const tag = $("bulk-tag").value.trim();
  const box = $("bulk-result");
  box.hidden = false;
  box.innerHTML = "Importing&hellip;";
  try {
    const res = await api.bulkImport(file, tag);
    const created = res.created || 0, skipped = res.skipped || 0;
    const errors = Array.isArray(res.errors) ? res.errors : [];
    box.innerHTML =
      `<span class="ok">Created: ${created}</span> &middot; ` +
      `<span class="warn">Skipped: ${skipped}</span> &middot; ` +
      `<span class="${errors.length ? "err" : ""}">Errors: ${errors.length}</span>` +
      (errors.length
        ? `<ul>${errors.slice(0, 12).map(x => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}` +
          (errors.length > 12 ? `<li>&hellip;and ${errors.length - 12} more</li>` : "") + `</ul>`
        : "");
    toast(`Import done: ${created} created, ${skipped} skipped, ${errors.length} errors.`,
      errors.length ? "info" : "success");
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
async function openEdit(name) {
  $("edit-title").textContent = name;
  $("edit-name").value = name;
  // reset tabs to General
  document.querySelectorAll("#edit-tabs .ps-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === "general"));
  document.querySelectorAll("#form-edit .ps-tabpane").forEach(pn =>
    pn.classList.toggle("active", pn.dataset.pane === "general"));
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
  $("edit-os").value = fp.os || prof.os || "windows";
  $("edit-engine").value = prof.engine || "camoufox";
  $("edit-tag").value = prof.client_tag || "";
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
  // fingerprint
  $("edit-tz").value = fp.timezone || "";
  $("edit-locale").value = fp.locale || "";
  $("edit-ua").value = fp.user_agent || "";
  $("edit-platform").value = fp.platform || "";
  $("edit-hw").value = fp.hardware_concurrency ?? "";
  $("edit-mem").value = fp.device_memory ?? "";
  $("edit-sw").value = fp.screen_width ?? "";
  $("edit-sh").value = fp.screen_height ?? "";
  $("edit-webgl-vendor").value = fp.webgl_vendor || "";
  $("edit-webgl-renderer").value = fp.webgl_renderer || "";
  // overview (read-only fingerprint panel, AdsPower-style)
  const rows = [
    ["Name", prof.name], ["Status", prof.status], ["Engine", prof.engine],
    ["OS", fp.os], ["Platform", fp.platform],
    ["User-Agent", fp.user_agent], ["Timezone", fp.timezone],
    ["Locale", fp.locale],
    ["Screen", fp.screen_width && fp.screen_height ? fp.screen_width + "x" + fp.screen_height : ""],
    ["Viewport", fp.viewport_width && fp.viewport_height ? fp.viewport_width + "x" + fp.viewport_height : ""],
    ["WebGL vendor", fp.webgl_vendor], ["WebGL renderer", fp.webgl_renderer],
    ["CPU cores", fp.hardware_concurrency], ["Device memory", fp.device_memory ? fp.device_memory + " GB" : ""],
    ["Color depth", fp.color_depth], ["Touch points", fp.touch_points],
    ["Proxy", fp.proxy ? (fp.proxy.name || (fp.proxy.host + ":" + fp.proxy.port)) : "Direct"],
    ["Client tag", prof.client_tag || ""],
    ["Last used", prof.last_used || "never"],
  ];
  $("edit-overview").innerHTML = '<div class="ps-kv">' + rows.map(([k, v]) =>
    `<div class="ps-kv-row"><div class="ps-kv-k">${esc(k)}</div><div class="ps-kv-v">${esc(v == null || v === "" ? "\u2014" : String(v))}</div></div>`).join("") + "</div>";
}

async function submitEdit(e) {
  e.preventDefault();
  const name = $("edit-name").value;
  const num = id => { const v = $(id).value.trim(); return v === "" ? null : parseInt(v, 10); };
  const payload = {
    client_tag: $("edit-tag").value.trim(),
    os: $("edit-os").value,
    engine: $("edit-engine").value,
    proxy_name: $("edit-proxy").value,
    group_name: $("edit-group").value || null,
    timezone: $("edit-tz").value.trim() || null,
    locale: $("edit-locale").value.trim() || null,
    user_agent: $("edit-ua").value.trim() || null,
    platform: $("edit-platform").value.trim() || null,
    webgl_vendor: $("edit-webgl-vendor").value.trim() || null,
    webgl_renderer: $("edit-webgl-renderer").value.trim() || null,
    hardware_concurrency: num("edit-hw"),
    device_memory: num("edit-mem"),
    screen_width: num("edit-sw"),
    screen_height: num("edit-sh"),
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
  try {
    await api.updateProfile(name, { regenerate_fingerprint: true });
    toast("Fingerprint regenerated.", "success");
    const prof = await api.getProfile(name);
    fillEditForm(prof);
    await refreshProfiles();
  } catch (e) {
    toast(`Regeneration failed: ${e.message || e}`, "error");
  }
}

// tab switching + form wiring (bound once)
document.querySelectorAll("#edit-tabs .ps-tab").forEach(t =>
  t.addEventListener("click", () => {
    document.querySelectorAll("#edit-tabs .ps-tab").forEach(x =>
      x.classList.toggle("active", x === t));
    document.querySelectorAll("#form-edit .ps-tabpane").forEach(pn =>
      pn.classList.toggle("active", pn.dataset.pane === t.dataset.tab));
  }));
$("form-edit").addEventListener("submit", submitEdit);
$("edit-regen").addEventListener("click", regenFingerprint);

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
$("btn-new").addEventListener("click", () => openModal("modal-new"));
$("btn-sync").addEventListener("click", () => openSync());
$("btn-bulk").addEventListener("click", () => {
  $("bulk-result").hidden = true;
  $("bulk-result").innerHTML = "";
  openModal("modal-bulk");
});
$("btn-import").addEventListener("click", () => {
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
$("btn-proxies").addEventListener("click", () => {
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

$("btn-rpa").addEventListener("click", async () => {
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
  $("bulk-delete").addEventListener("click", bulkDelete);
  $("bulk-clear").addEventListener("click", () => {
    state.selected.clear();
    renderTable();
  });
  const bef = $("form-bulk-edit");
  if (bef) bef.addEventListener("submit", submitBulkEdit);
  const euf = $("form-ext-upload");
  if (euf) euf.addEventListener("submit", onExtensionUpload);
  const sf = $("form-sync-start");
  if (sf) sf.addEventListener("submit", onSyncStart);
  const rf = $("form-rpa-run");
  if (rf) rf.addEventListener("submit", onRpaRun);
})();
