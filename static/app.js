const $ = (s) => document.querySelector(s);
const state = { settings: null, mode: "study", active: null, selectedMusic: "focus", musicPlaying: false, eventCursor: Number(localStorage.getItem("ami-event-cursor") || 0), speakReplies: false, reminders: [], breakReady: false, breakDuration: 5, adaptive: null };
const MODE_LABELS = { study: "Study", work: "Work", reset: "Reset" };
let toastTimer, timerInterval;

const API_BASE = (window.AMI_API_BASE_URL || "").replace(/\/$/, "");
const DEMO_KEY = "ami-helper-static-v1";
const DEMO_SETTINGS = { work_minutes: 25, break_minutes: 5, long_break_minutes: 15, long_break_every: 4, mode: "study", music_mode: "focus", voice_enabled: true, nudge_style: "gentle", eye_rest_minutes: 20, stretch_minutes: 50, water_minutes: 45 };
function demoLoad() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || {}; } catch (_) { return {}; }
}
function demoState() {
  const saved = demoLoad();
  return { settings: { ...DEMO_SETTINGS, ...(saved.settings || {}) }, sessions: saved.sessions || [], active: saved.active || null, reminders: saved.reminders || [], events: saved.events || [], nextEventId: saved.nextEventId || 1 };
}
function demoSave(s) {
  localStorage.setItem(DEMO_KEY, JSON.stringify({ settings: s.settings, sessions: s.sessions, active: s.active, reminders: s.reminders, events: s.events.slice(-250), nextEventId: s.nextEventId }));
}
function demoEmit(s, kind, payload) {
  s.events.push({ id: s.nextEventId++, kind, payload, created_at: new Date().toISOString() });
}
function demoComplete(s, completed = true) {
  if (!s.active) return;
  const a = s.active, elapsed = Math.max(0, Math.floor((Date.now() - new Date(a.started_at).getTime()) / 1000));
  a.status = completed ? "completed" : "interrupted"; a.ended_at = new Date().toISOString(); a.completed_seconds = Math.min(elapsed, a.planned_minutes * 60);
  if (a.mode === "break" && completed) { demoEmit(s, "break_complete", { message: "Break done. Ready when you are." }); }
  else if (completed) {
    demoEmit(s, "focus_complete", { session_id: a.id });
    const n = s.sessions.filter(x => x.mode !== "break" && x.status === "completed").length + 1;
    const duration = n % s.settings.long_break_every === 0 ? s.settings.long_break_minutes : s.settings.break_minutes;
    demoEmit(s, "break_prompt", { minutes: duration, message: `Focus block complete. Jom rehat ${duration} minit—minum air, regangkan badan, dan rehatkan mata.` });
  }
  s.sessions.push(a); s.active = null;
}
function demoSync(s) {
  if (s.active) {
    const end = new Date(s.active.started_at).getTime() + Number(s.active.planned_minutes) * 60000;
    if (Date.now() >= end) demoComplete(s, true);
    else if (s.active.mode !== "break") {
      const elapsed = Date.now() - new Date(s.active.started_at).getTime();
      for (const [key, mins, text] of [["eyes", s.settings.eye_rest_minutes, "Rehatkan mata sekejap—pandang jauh selama 20 saat."], ["stretch", s.settings.stretch_minutes, "Turunkan bahu dan regangkan badan perlahan-lahan."], ["water", s.settings.water_minutes, "Small water check—ambil beberapa teguk kalau ada."]]) {
        const interval = Number(mins) * 60000;
        if (interval > 0 && elapsed >= interval) {
          const nudgeKey = `${s.active.id}:${key}:${Math.floor(elapsed / interval)}`;
          if (!s.events.some(e => e.kind === "nudge" && e.payload.key === nudgeKey)) demoEmit(s, "nudge", { kind: key, key: nudgeKey, text, speak: false });
        }
      }
    }
  }
  const now = Date.now();
  for (const r of s.reminders) {
    if (!r.delivered_at && r.enabled && new Date(r.due_at).getTime() <= now) {
      demoEmit(s, "reminder", { id: r.id, text: r.text, speak: false });
      if (r.repeat_minutes) r.due_at = new Date(now + r.repeat_minutes * 60000).toISOString();
      else r.delivered_at = new Date().toISOString();
    }
  }
}
function demoStats(s) {
  const focus = s.sessions.filter(x => x.mode !== "break" && x.status === "completed");
  const days = new Set(focus.map(x => new Date(x.started_at).toLocaleDateString()));
  const today = new Date().toLocaleDateString(); let streak = 0, cursor = new Date();
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toLocaleDateString())) { streak++; cursor.setDate(cursor.getDate() - 1); }
  const hours = {};
  focus.forEach(x => { const h = new Date(x.started_at).getHours(); hours[h] = (hours[h] || 0) + x.completed_seconds; });
  const best = Object.keys(hours).sort((a,b) => hours[b] - hours[a])[0];
  return { completed_sessions: focus.length, focus_minutes: Math.floor(focus.reduce((n,x) => n + x.completed_seconds, 0) / 60), streak_days: streak, breaks_taken: s.sessions.filter(x => x.mode === "break" && x.status === "completed").length, best_focus_hour: best === undefined ? null : Number(best) };
}
function demoReply(message) {
  const t = message.toLowerCase();
  if (/self.?harm|suicide|bunuh diri|nak mati/.test(t)) return "Aku risau dengar kau rasa macam ni. Tolong hubungi orang yang kau percaya atau bantuan kecemasan tempatan sekarang, jangan hadap seorang diri.";
  if (/joke|lawak/.test(t)) return "Kenapa buku matematik nampak sedih? Sebab dia penuh dengan masalah. Rehat kejap, AMI jaga tempat sini.";
  if (/riddle|teka-teki/.test(t)) return "Apa benda ada banyak keys tapi tak boleh buka pintu? Piano. Okay, teka-teki dah—rehat dulu sekejap.";
  if (/trivia|fun fact|fakta/.test(t)) return "Fun fact: sotong ada tiga jantung, and their blood is blue. Dunia memang pelik sikit—in a good way.";
  if (/story|cerita/.test(t)) return "Seekor burung kecil berhenti di tepi tingkap untuk berehat sebelum terbang lagi. Kadang-kadang pause tu sebahagian daripada perjalanan.";
  if (/tired|penat|stress|stres|overwhelmed|serabut/.test(t)) return "Nampak macam kepala tengah penuh. Jom reset sekejap: tarik nafas perlahan, minum air, kemudian pilih satu langkah kecil.";
  if (/focus|start|mula|study|belajar|kerja/.test(t)) return "Okay, kita mula kecil: pilih satu benda paling penting dan fokus 25 minit. Tak perlu perfect, cuma mula.";
  return "Aku dengar. Nak cerita sikit lagi, atau kita pilih satu langkah kecil untuk sekarang?";
}
function staticDemoApi(path, options = {}) {
  const s = demoState(); demoSync(s);
  const [route, query = ""] = path.split("?"); const params = new URLSearchParams(query);
  const method = (options.method || "GET").toUpperCase();
  let body = {}; try { body = options.body ? JSON.parse(options.body) : {}; } catch (_) {}
  const fail = (message) => { demoSave(s); throw new Error(message); };
  if (route === "/api/health") return { ok: true, service: "ami-helper-static", time: new Date().toISOString() };
  if (route === "/api/ready") return { ok: true, llm_configured: false, stt_configured: false, tts_configured: false, device_auth_enabled: false, mode: "browser-only" };
  if (route === "/api/status") { demoSave(s); return { settings: s.settings, active_session: s.active, stats: demoStats(s), reminders: s.reminders.filter(r => r.enabled && !r.delivered_at).slice(0,10), device: null, now: new Date().toISOString() }; }
  if (route === "/api/settings" && method === "GET") return s.settings;
  if (route === "/api/settings" && method === "PUT") { s.settings = { ...s.settings, ...body }; demoSave(s); return s.settings; }
  if (route === "/api/adaptive") {
    const recent = s.sessions.filter(x => x.mode !== "break" && x.status === "completed").slice(-12);
    const avg = recent.length ? recent.reduce((n,x) => n + Math.min(1, x.completed_seconds / Math.max(1, x.planned_minutes * 60)), 0) / recent.length : null;
    let suggested = Math.min(50, Math.max(15, Number(s.settings.work_minutes)));
    let style = s.settings.nudge_style;
    if (recent.length >= 3 && avg < .65) { suggested = Math.max(15, suggested - 5); style = "gentle"; }
    else if (recent.length >= 3 && avg >= .9) { suggested = Math.min(50, suggested + 5); style = "direct"; }
    return { preferred_mode: s.settings.mode, suggested_minutes: suggested, suggested_nudge_style: style, completed_samples: recent.length, average_completion_ratio: avg, break_follow_through: demoStats(s).breaks_taken, best_focus_hour_local: demoStats(s).best_focus_hour, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, recommendation: recent.length >= 3 ? `From your last ${recent.length} completed blocks, AMI suggests trying ${suggested} minutes next. It’s a suggestion, not a score.` : "AMI is learning your rhythm; finish a few focus blocks to get a personal timing suggestion." };
  }
  if (route === "/api/focus/active") return { active_session: s.active };
  if (route === "/api/focus/start" && method === "POST") {
    if (s.active) return fail("A focus session is already active");
    const id = (crypto.randomUUID ? crypto.randomUUID() : `ami-${Date.now()}`);
    s.active = { id, mode: body.mode || s.settings.mode || "study", planned_minutes: Number(body.minutes || s.settings.work_minutes), started_at: new Date().toISOString(), status: "active", completed_seconds: 0 };
    demoEmit(s, "music_mode", { mode: s.settings.music_mode }); demoSave(s); return s.active;
  }
  if (route === "/api/break/start" && method === "POST") {
    if (s.active) return fail("A timer is already active");
    const n = s.sessions.filter(x => x.mode !== "break" && x.status === "completed").length;
    const long = n > 0 && n % Number(s.settings.long_break_every) === 0;
    const id = crypto.randomUUID ? crypto.randomUUID() : `ami-${Date.now()}`;
    s.active = { id, mode: "break", planned_minutes: Number(long ? s.settings.long_break_minutes : s.settings.break_minutes), started_at: new Date().toISOString(), status: "active", completed_seconds: 0 };
    demoEmit(s, "music_mode", { mode: "relax", playing: true }); demoSave(s); return s.active;
  }
  const finishMatch = route.match(/^\/api\/focus\/([^/]+)\/finish$/);
  if (finishMatch && method === "POST") {
    if (!s.active || s.active.id !== decodeURIComponent(finishMatch[1])) return fail("Focus session not found");
    demoComplete(s, body.completed !== false); demoSave(s); return { id: finishMatch[1], status: s.sessions.at(-1).status, completed_seconds: s.sessions.at(-1).completed_seconds };
  }
  if (route === "/api/reminders" && method === "GET") return s.reminders.filter(r => r.enabled && !r.delivered_at).sort((a,b) => a.due_at.localeCompare(b.due_at));
  if (route === "/api/reminders" && method === "POST") {
    const r = { id: crypto.randomUUID ? crypto.randomUUID() : `rem-${Date.now()}`, text: body.text, due_at: new Date(body.due_at).toISOString(), repeat_minutes: body.repeat_minutes || null, enabled: true, delivered_at: null };
    s.reminders.push(r); demoSave(s); return r;
  }
  const deleteMatch = route.match(/^\/api\/reminders\/([^/]+)$/);
  if (deleteMatch && method === "DELETE") { const r = s.reminders.find(x => x.id === decodeURIComponent(deleteMatch[1])); if (!r) return fail("Reminder not found"); r.enabled = false; demoSave(s); return null; }
  if (route === "/api/music" && method === "POST") { s.settings.music_mode = body.mode || s.settings.music_mode; demoEmit(s, "music_mode", { mode: s.settings.music_mode, playing: body.playing }); demoSave(s); return { ok: true, mode: s.settings.music_mode, playing: body.playing }; }
  if (route === "/api/chat" && method === "POST") return { reply: demoReply(body.message || ""), source: "local", mood: "warm" };
  if (route === "/api/events") { demoSave(s); const events = s.events.filter(e => e.id > Number(params.get("after_id") || 0)); return { events, last_id: events.length ? events[events.length - 1].id : Number(params.get("after_id") || 0) }; }
  return fail(`This route isn't available in browser-only mode: ${route}`);
}
async function api(path, options = {}) {
  if (window.AMI_STATIC_DEMO) return staticDemoApi(path, options);
  const response = await fetch(`${API_BASE}${path}`, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try { detail = (await response.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function setOnline(online) {
  $("#api-dot").classList.toggle("online", online);
  $("#api-status").textContent = window.AMI_STATIC_DEMO ? "browser demo · saved here" : online ? "AMI is online" : "AMI is offline";
}
function setTimerRing(progress) {
  const p = Math.max(0, Math.min(100, progress));
  $("#timer-ring").style.background = `conic-gradient(var(--rose) ${p}%, #f0dcd8 ${p}% 100%)`;
}
function fmt(seconds) {
  const m = Math.max(0, Math.floor(seconds / 60)); const s = Math.max(0, seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function renderTimer() {
  const breakButton = $("#break-start");
  if (!state.active) {
    const mins = Number(state.settings?.work_minutes || 25);
    $("#timer-display").textContent = fmt(mins * 60); $("#timer-label").textContent = "READY WHEN YOU ARE";
    $("#focus-start").disabled = false; $("#focus-start").textContent = "Start focus";
    $("#focus-finish").disabled = true; $("#focus-finish").textContent = "Finish early";
    $("#focus-state").textContent = "No pressure. Just begin."; setTimerRing(0);
    breakButton.hidden = !state.breakReady; breakButton.textContent = `Start your ${state.breakDuration}-minute break`;
    if (window.setAmiExpression && !window.amiIsInteracting) window.setAmiExpression("normal");
    return;
  }
  const isBreak = state.active.mode === "break";
  if (window.setAmiExpression && !window.amiIsInteracting) window.setAmiExpression(isBreak ? "sleep" : "focus");
  const total = Number(state.active.planned_minutes) * 60;
  const start = new Date(state.active.started_at).getTime();
  const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const left = Math.max(0, total - elapsed);
  $("#timer-display").textContent = fmt(left); $("#timer-label").textContent = isBreak ? "A LITTLE REST" : `${MODE_LABELS[state.active.mode] || "FOCUS"} IN PROGRESS`;
  $("#focus-start").disabled = true; $("#focus-start").textContent = isBreak ? "Rest easy ♥" : "You’re doing it ♥";
  $("#focus-finish").disabled = false; $("#focus-finish").textContent = isBreak ? "End break" : "Finish early";
  $("#focus-state").textContent = isBreak ? "Water, stretch, look away. No screens if you can." : "One small step at a time.";
  breakButton.hidden = true;
  setTimerRing((elapsed / total) * 100);
  if (left === 0) refreshStatus();
}
function renderCycle() {
  const w = state.settings?.work_minutes || 25, b = state.settings?.break_minutes || 5;
  $("#cycle-label").textContent = `${w} min focus · ${b} min break`;
  $("#work-cycle").value = String(w); $("#break-cycle").value = String(b);
  const n = document.querySelectorAll(".nudge-time");
  if (n[0]) n[0].textContent = `${state.settings?.eye_rest_minutes || 20}m`;
  if (n[1]) n[1].textContent = `${state.settings?.stretch_minutes || 50}m`;
  if (n[2]) n[2].textContent = `${state.settings?.water_minutes || 45}m`;
}
function renderStats(status) {
  $("#stat-sessions").textContent = status.stats.completed_sessions;
  $("#stat-minutes").textContent = status.stats.focus_minutes;
  $("#stat-streak").textContent = status.stats.streak_days;
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function renderReminders(items = state.reminders) {
  state.reminders = items; const root = $("#reminder-list"); root.replaceChildren();
  if (!items.length) { root.innerHTML = '<div class="empty-state">Your reminders will show up here.</div>'; return; }
  for (const r of items) {
    const row = document.createElement("div"); row.className = "reminder-item";
    const when = new Date(r.due_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    row.innerHTML = `<span><b>${escapeHTML(r.text)}</b><small>${escapeHTML(when)}${r.repeat_minutes ? ` · repeats every ${r.repeat_minutes}m` : ""}</small></span><button class="remove-reminder" data-id="${escapeHTML(r.id)}" aria-label="Remove reminder">×</button>`;
    root.appendChild(row);
  }
  root.querySelectorAll(".remove-reminder").forEach((btn) => btn.addEventListener("click", async () => {
    try { await api(`/api/reminders/${encodeURIComponent(btn.dataset.id)}`, { method: "DELETE" }); await loadReminders(); toast("Reminder removed"); }
    catch (e) { toast(e.message); }
  }));
}
async function refreshStatus() {
  try {
    const status = await api("/api/status"); setOnline(true); state.settings = status.settings; state.active = status.active_session; state.mode = status.settings.mode || state.mode;
    document.querySelectorAll(".mode-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
    renderCycle(); renderTimer(); renderStats(status);
    $("#music-title").textContent = `AMI · ${status.settings.music_mode}`;
    state.selectedMusic = status.settings.music_mode;
    document.querySelectorAll(".music-mode").forEach((b) => b.classList.toggle("active", b.dataset.music === state.selectedMusic));
    state.adaptive = await api("/api/adaptive");
    $("#adaptive-note").textContent = state.adaptive.recommendation;
    $("#apply-adaptive").textContent = state.adaptive.completed_samples >= 3
      ? `Try ${state.adaptive.suggested_minutes} min · ${state.adaptive.suggested_nudge_style} nudges`
      : `Keep ${state.adaptive.suggested_minutes} min · collect a few sessions`;
  } catch (_) { setOnline(false); }
}
async function loadReminders() {
  try { renderReminders(await api("/api/reminders")); } catch (_) { /* offline status is shown in header */ }
}
async function startFocus() {
  try {
    const result = await api("/api/focus/start", { method: "POST", body: JSON.stringify({ mode: state.mode }) });
    state.active = result; renderTimer(); toast(`Focus started · ${result.planned_minutes} minutes`);
  } catch (e) { toast(e.message); }
}
async function finishFocus(completed = true) {
  if (!state.active) return;
  try {
    await api(`/api/focus/${encodeURIComponent(state.active.id)}/finish`, { method: "POST", body: JSON.stringify({ completed, break_taken: false }) });
    state.active = null; renderTimer(); await refreshStatus();
    if (completed && window.triggerAmiCelebration) window.triggerAmiCelebration();
    toast(completed ? "Session complete. Take a gentle break ♥" : "Session wrapped up. Every minute counts.");
  } catch (e) { toast(e.message); }
}
async function startBreak() {
  try { state.active = await api("/api/break/start", { method: "POST" }); state.breakReady = false; renderTimer(); toast("Break time. You earned a pause ♥"); }
  catch (e) { toast(e.message); }
}
async function updateSettings(patch) {
  try { state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(patch) }); renderCycle(); renderTimer(); }
  catch (e) { toast(e.message); }
}
async function chooseMusic(mode, playing = state.musicPlaying) {
  state.selectedMusic = mode; state.musicPlaying = playing;
  document.querySelectorAll(".music-mode").forEach((b) => b.classList.toggle("active", b.dataset.music === mode));
  $("#music-title").textContent = `AMI · ${mode}`; $("#music-subtitle").textContent = playing ? "Sent to your desk companion" : "Ready on the companion’s SD card";
  $("#music-play").textContent = playing ? "Ⅱ" : "▶";
  try {
    await api("/api/music", { method: "POST", body: JSON.stringify({ mode, playing }) });
    await updateSettings({ music_mode: mode });
  } catch (e) { toast(e.message); }
}
function addBubble(text, who) {
  const node = document.createElement("div"); node.className = `bubble ${who}-bubble`; node.textContent = text;
  $("#chat-log").appendChild(node); $("#chat-log").scrollTop = $("#chat-log").scrollHeight; return node;
}
function speak(text) {
  if (!state.speakReplies || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "ms-MY"; utterance.rate = 0.94; window.speechSynthesis.speak(utterance);
}
async function sendChat(text) {
  const clean = text.trim(); if (!clean) return;
  addBubble(clean, "user"); $("#chat-input").value = "";
  const pending = addBubble("AMI is thinking…", "ami"); pending.classList.add("pending");
  try {
    const result = await api("/api/chat", { method: "POST", body: JSON.stringify({ message: clean, mode: state.mode }) });
    pending.textContent = result.reply; pending.classList.remove("pending"); speak(result.reply);
  } catch (e) { pending.textContent = "I can’t reach the buddy server right now. Check that AMI is running, then try again."; pending.classList.remove("pending"); }
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
}
function setupSpeech(button, target, note) {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) { button.addEventListener("click", () => toast("Voice input isn’t available in this browser; you can type instead.")); return; }
  button.addEventListener("click", () => {
    const rec = new Speech(); rec.lang = "ms-MY"; rec.interimResults = false; rec.maxAlternatives = 1;
    note.textContent = "Listening… cakap bila ready.";
    rec.onresult = (event) => { target.value = event.results[0][0].transcript; note.textContent = "Got it—check the words, then send."; if (target.id === "chat-input") sendChat(target.value); };
    rec.onerror = () => { note.textContent = "Voice input stopped; you can type instead."; };
    rec.onend = () => { if (note.textContent.startsWith("Listening")) note.textContent = "Voice input uses your browser’s speech recognition when available."; };
    try { rec.start(); } catch (_) { note.textContent = "Microphone unavailable; check browser permission."; }
  });
}
async function pollEvents() {
  try {
    const result = await api(`/api/events?after_id=${state.eventCursor}`);
    for (const event of result.events) {
      state.eventCursor = Math.max(state.eventCursor, event.id);
      const p = event.payload || {};
      if (event.kind === "reminder") { toast(`Reminder: ${p.text}`); if (state.speakReplies) speak(p.text); }
      if (event.kind === "break_prompt") { state.breakReady = true; state.breakDuration = Number(p.minutes || state.settings?.break_minutes || 5); renderTimer(); toast(p.message || "Break time—stretch, sip water, rest your eyes."); if (state.speakReplies) speak(p.message); }
      if (event.kind === "break_complete") { state.breakReady = false; renderTimer(); toast(p.message || "Break done. Ready when you are."); }
      if (event.kind === "nudge") { toast(p.text || "A gentle little reminder from AMI."); if (state.speakReplies) speak(p.text); }
      if (event.kind === "focus_complete") { toast("Focus session complete. You did enough for this block ♥"); refreshStatus(); }
    }
    if (result.last_id > state.eventCursor) state.eventCursor = result.last_id;
    localStorage.setItem("ami-event-cursor", String(state.eventCursor));
  } catch (_) { /* server status remains visible */ }
}
function setDefaultReminderTime() {
  const d = new Date(Date.now() + 10 * 60 * 1000); d.setSeconds(0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $("#reminder-time").value = local;
}

$("#focus-start").addEventListener("click", startFocus);
$("#focus-finish").addEventListener("click", () => finishFocus(false));
$("#break-start").addEventListener("click", startBreak);
$("#apply-adaptive").addEventListener("click", async () => {
  if (!state.adaptive) return;
  await updateSettings({ work_minutes: state.adaptive.suggested_minutes, nudge_style: state.adaptive.suggested_nudge_style });
  toast(state.adaptive.completed_samples >= 3 ? "Rhythm updated from your completed blocks ♥" : "Starting with your current rhythm—AMI will learn gently.");
});
document.querySelectorAll(".mode-tab").forEach((btn) => btn.addEventListener("click", async () => {
  state.mode = btn.dataset.mode; document.querySelectorAll(".mode-tab").forEach((b) => b.classList.toggle("active", b === btn));
  await updateSettings({ mode: state.mode });
}));
$("#work-cycle").addEventListener("change", (e) => updateSettings({ work_minutes: Number(e.target.value) }));
$("#break-cycle").addEventListener("change", (e) => updateSettings({ break_minutes: Number(e.target.value) }));
document.querySelectorAll(".music-mode").forEach((btn) => btn.addEventListener("click", () => chooseMusic(btn.dataset.music, true)));
$("#music-play").addEventListener("click", () => chooseMusic(state.selectedMusic, !state.musicPlaying));
$("#reminder-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const text = $("#reminder-text").value.trim(); const due = $("#reminder-time").value;
  try {
    await api("/api/reminders", { method: "POST", body: JSON.stringify({ text, due_at: new Date(due).toISOString() }) });
    $("#reminder-text").value = ""; setDefaultReminderTime(); await loadReminders(); toast("Reminder saved ♥");
  } catch (err) { toast(err.message); }
});
$("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); sendChat($("#chat-input").value); });
document.querySelectorAll("[data-say]").forEach((btn) => btn.addEventListener("click", () => sendChat(btn.dataset.say)));
setupSpeech($("#chat-mic"), $("#chat-input"), $("#voice-note"));
setupSpeech($("#voice-reminder"), $("#reminder-text"), $("#voice-note"));
$("#speak-toggle").addEventListener("click", (e) => {
  state.speakReplies = !state.speakReplies; e.currentTarget.setAttribute("aria-pressed", String(state.speakReplies));
  e.currentTarget.textContent = `Read replies aloud: ${state.speakReplies ? "on" : "off"}`;
});
$("#settings-open").addEventListener("click", async () => {
  if (!state.settings) await refreshStatus(); const s = state.settings || {};
  $("#long-break-every").value = String(s.long_break_every || 4); $("#nudge-style").value = s.nudge_style || "gentle";
  $("#voice-enabled").checked = s.voice_enabled !== false; $("#eye-interval").value = String(s.eye_rest_minutes || 20); $("#stretch-interval").value = String(s.stretch_minutes || 50); $("#water-interval").value = String(s.water_minutes || 45);
  $("#settings-dialog").showModal();
});
$(".close-dialog").addEventListener("click", () => $("#settings-dialog").close());
$("#save-settings").addEventListener("click", async () => {
  await updateSettings({ long_break_every: Number($("#long-break-every").value), nudge_style: $("#nudge-style").value, voice_enabled: $("#voice-enabled").checked, eye_rest_minutes: Number($("#eye-interval").value), stretch_minutes: Number($("#stretch-interval").value), water_minutes: Number($("#water-interval").value) });
  $("#settings-dialog").close(); toast("Preferences saved. We’ll adjust gently.");
});
$("#settings-dialog").addEventListener("click", (e) => { if (e.target === $("#settings-dialog")) $("#settings-dialog").close(); });

const hour = new Date().getHours(); $("#greeting").textContent = hour < 12 ? "Good morning!" : hour < 18 ? "Good afternoon!" : "Good evening!";
if (window.AMI_STATIC_DEMO) {
  $(".footer span:last-child").textContent = "Standalone demo · sessions and reminders stay in this browser";
  $("#music-subtitle").textContent = "Audio hardware is not available in this browser demo";
  $("#music-state").textContent = "Sound mode is a visual demo here; the physical robot plays tracks from its SD card.";
}
setDefaultReminderTime(); refreshStatus(); loadReminders();
timerInterval = setInterval(() => { renderTimer(); }, 1000);
setInterval(refreshStatus, 20000); setInterval(loadReminders, 30000); setInterval(pollEvents, 8000);

// --- AMI Interactive Motion, Eye Tracking & Touch Engine ---
window.amiIsInteracting = false;
function initAmiMotion() {
  const stage = document.getElementById("ami-stage");
  const svg = document.querySelector(".ami-svg");
  const robot = document.getElementById("ami-bot-body");
  const antenna = document.getElementById("ami-antenna");
  const earL = document.getElementById("ami-ear-left");
  const earR = document.getElementById("ami-ear-right");
  const pupilL = document.getElementById("ami-pupil-left");
  const pupilR = document.getElementById("ami-pupil-right");
  const shineL = document.getElementById("ami-shine-left");
  const shineR = document.getElementById("ami-shine-right");
  const eyeL = document.getElementById("ami-eye-left");
  const eyeR = document.getElementById("ami-eye-right");
  const blushL = document.getElementById("ami-blush-left");
  const blushR = document.getElementById("ami-blush-right");
  const eyesNormal = document.getElementById("ami-eyes-normal");
  const eyesHappy = document.getElementById("ami-eyes-happy");
  const eyesSleep = document.getElementById("ami-eyes-sleep");
  const heartsContainer = document.getElementById("ami-hearts");
  const captionText = document.getElementById("ami-caption-text");

  if (!stage || !svg || !pupilL || !pupilR) return;

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let currentExpression = "normal";
  let blinkTimeout = null;

  const MAX_PUPIL_X = 5.2;
  const MAX_PUPIL_Y = 6.0;

  function updatePoint(x, y) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height * 0.45;
    const dx = x - centerX;
    const dy = y - centerY;
    const dist = Math.hypot(dx, dy);
    const maxRadius = Math.max(window.innerWidth, window.innerHeight) * 0.75;
    const factor = Math.min(dist / Math.max(1, maxRadius), 1);
    const angle = Math.atan2(dy, dx);
    targetX = Math.cos(angle) * factor;
    targetY = Math.sin(angle) * factor;
  }

  // Pointer & mouse tracking (Desktop)
  window.addEventListener("pointermove", (e) => {
    updatePoint(e.clientX, e.clientY);
  }, { passive: true });

  // Touch tracking (Android / Mobile)
  window.addEventListener("touchstart", (e) => {
    if (e.touches && e.touches[0]) {
      updatePoint(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches[0]) {
      updatePoint(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  window.addEventListener("pointerleave", () => {
    targetX = 0;
    targetY = 0.15;
  });

  // RAF loop for buttery 60fps tracking
  function loop() {
    currentX += (targetX - currentX) * 0.12;
    currentY += (targetY - currentY) * 0.12;

    const px = currentX * MAX_PUPIL_X;
    const py = currentY * MAX_PUPIL_Y;

    pupilL.setAttribute("cx", (119 + px).toFixed(2));
    pupilL.setAttribute("cy", (142 + py).toFixed(2));
    pupilR.setAttribute("cx", (181 + px).toFixed(2));
    pupilR.setAttribute("cy", (142 + py).toFixed(2));

    if (shineL && shineR) {
      shineL.setAttribute("cx", (117 + px * 0.65).toFixed(2));
      shineL.setAttribute("cy", (138 + py * 0.65).toFixed(2));
      shineR.setAttribute("cx", (179 + px * 0.65).toFixed(2));
      shineR.setAttribute("cy", (138 + py * 0.65).toFixed(2));
    }

    if (robot) {
      const tilt = currentX * 3.8;
      const hx = currentX * 4.5;
      const hy = currentY * 3.2;
      robot.style.transform = `translate(${hx.toFixed(2)}px, ${hy.toFixed(2)}px) rotate(${tilt.toFixed(2)}deg)`;
    }

    if (antenna) {
      const antTilt = -currentX * 7.5;
      antenna.style.transform = `rotate(${antTilt.toFixed(2)}deg)`;
    }

    if (earL && earR) {
      const earTilt = -currentX * 4.2;
      earL.style.transform = `rotate(${earTilt.toFixed(2)}deg)`;
      earR.style.transform = `rotate(${earTilt.toFixed(2)}deg)`;
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Natural Blinking
  function doBlink() {
    if (currentExpression === "happy" || currentExpression === "sleep") {
      scheduleBlink();
      return;
    }
    if (eyeL && eyeR) {
      eyeL.style.transform = "scaleY(0.08)";
      eyeR.style.transform = "scaleY(0.08)";
      setTimeout(() => {
        eyeL.style.transform = "scaleY(1)";
        eyeR.style.transform = "scaleY(1)";
        if (Math.random() < 0.22) {
          setTimeout(() => {
            eyeL.style.transform = "scaleY(0.08)";
            eyeR.style.transform = "scaleY(0.08)";
            setTimeout(() => {
              eyeL.style.transform = "scaleY(1)";
              eyeR.style.transform = "scaleY(1)";
              scheduleBlink();
            }, 100);
          }, 110);
        } else {
          scheduleBlink();
        }
      }, 120);
    } else {
      scheduleBlink();
    }
  }

  function scheduleBlink() {
    clearTimeout(blinkTimeout);
    blinkTimeout = setTimeout(doBlink, 2600 + Math.random() * 4000);
  }
  scheduleBlink();

  // Expression Control
  window.setAmiExpression = function(expr) {
    currentExpression = expr;
    if (expr === "happy") {
      if (eyesNormal) eyesNormal.style.display = "none";
      if (eyesSleep) eyesSleep.style.display = "none";
      if (eyesHappy) eyesHappy.style.display = "";
      if (blushL && blushR) { blushL.style.opacity = "0.9"; blushR.style.opacity = "0.9"; }
      if (captionText) captionText.textContent = "AMI is smiling with you ♥";
    } else if (expr === "sleep") {
      if (eyesNormal) eyesNormal.style.display = "none";
      if (eyesHappy) eyesHappy.style.display = "none";
      if (eyesSleep) eyesSleep.style.display = "";
      if (blushL && blushR) { blushL.style.opacity = "0.55"; blushR.style.opacity = "0.55"; }
      if (captionText) captionText.textContent = "AMI is resting with you ☾";
    } else if (expr === "focus") {
      if (eyesHappy) eyesHappy.style.display = "none";
      if (eyesSleep) eyesSleep.style.display = "none";
      if (eyesNormal) eyesNormal.style.display = "";
      if (blushL && blushR) { blushL.style.opacity = "0.45"; blushR.style.opacity = "0.45"; }
      if (captionText) captionText.textContent = "AMI is focusing alongside you ✿";
    } else {
      if (eyesHappy) eyesHappy.style.display = "none";
      if (eyesSleep) eyesSleep.style.display = "none";
      if (eyesNormal) eyesNormal.style.display = "";
      if (blushL && blushR) { blushL.style.opacity = "0.45"; blushR.style.opacity = "0.45"; }
      if (captionText) captionText.textContent = "AMI is here with you";
    }
  };

  // Cute Web Audio Synth Chime
  function playCuteSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1046.5, now); // C6
      osc.frequency.exponentialRampToValueAtTime(1567.98, now + 0.11); // G6
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (_) {}
  }

  // Floating Heart Particle
  function spawnHeart() {
    if (!heartsContainer) return;
    const heart = document.createElement("div");
    heart.className = "ami-floating-heart";
    heart.textContent = Math.random() < 0.35 ? "✨" : "♥";
    const offset = (Math.random() - 0.5) * 70;
    heart.style.left = `calc(50% + ${offset}px)`;
    heart.style.bottom = "85px";
    heartsContainer.appendChild(heart);
    setTimeout(() => heart.remove(), 1100);
  }

  window.triggerAmiCelebration = function() {
    playCuteSound();
    for (let i = 0; i < 4; i++) {
      setTimeout(spawnHeart, i * 180);
    }
    window.setAmiExpression("happy");
    svg.classList.add("ami-pet-bounce");
    if (antenna) antenna.classList.add("antenna-spring");
    if (earL) earL.classList.add("ear-wiggle-left");
    if (earR) earR.classList.add("ear-wiggle-right");
    setTimeout(() => {
      svg.classList.remove("ami-pet-bounce");
      if (antenna) antenna.classList.remove("antenna-spring");
      if (earL) earL.classList.remove("ear-wiggle-left");
      if (earR) earR.classList.remove("ear-wiggle-right");
      if (state.active && state.active.mode === "break") {
        window.setAmiExpression("sleep");
      } else {
        window.setAmiExpression("normal");
      }
    }, 1200);
  };

  // Tap & Pet Responses
  const petLines = [
    "*peep!* AMI is cheering for you! ♥",
    "pat pat received! Kita lock in sama-sama.",
    "One small step at a time, you got this! ✨",
    "Tarik nafas... okay, jom sambung!",
    "AMI is right here with you! ✿"
  ];

  function handlePet(e) {
    if (window.amiIsInteracting) return;
    window.amiIsInteracting = true;
    playCuteSound();
    spawnHeart();
    window.setAmiExpression("happy");
    svg.classList.add("ami-pet-bounce");
    if (antenna) antenna.classList.add("antenna-spring");
    if (earL) earL.classList.add("ear-wiggle-left");
    if (earR) earR.classList.add("ear-wiggle-right");

    const line = petLines[Math.floor(Math.random() * petLines.length)];
    toast(line);

    setTimeout(() => {
      svg.classList.remove("ami-pet-bounce");
      if (antenna) antenna.classList.remove("antenna-spring");
      if (earL) earL.classList.remove("ear-wiggle-left");
      if (earR) earR.classList.remove("ear-wiggle-right");
      window.amiIsInteracting = false;
      if (state.active && state.active.mode === "break") {
        window.setAmiExpression("sleep");
      } else if (state.active) {
        window.setAmiExpression("focus");
      } else {
        window.setAmiExpression("normal");
      }
    }, 900);
  }

  stage.addEventListener("click", handlePet);
}

initAmiMotion();
