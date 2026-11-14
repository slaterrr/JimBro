const STORAGE_KEY = 'jimbro-prototype-v1';
const initial = { tone: 'Direct', sessions: [], active: null, plan: null };
let state;
try { state = { ...initial, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { state = { ...initial }; }
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const allSessions = () => [...state.sessions, ...(state.active ? [state.active] : [])];
const allSets = () => allSessions().flatMap((session) => session.sets || []);
const formatDate = (date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const tones = ['Direct', 'Friendly', 'Silly', 'Hard'];
const lines = {
  Direct: ['Set logged. Stay focused and make the next one count.', 'You put in the work. Keep your next set controlled.'],
  Friendly: ['Nice work! Take a breath and get ready for the next set.', 'You showed up for yourself today. Keep going!'],
  Silly: ['That set just got a one-way ticket to Gainsville.', 'Jim approves. Your dumbbells may be nervous.'],
  Hard: ['Set complete. Recover, reset, and attack the next one.', 'Good. Now bring the same intent to every rep.']
};
function showPage(page) {
  $$('.page').forEach((el) => el.classList.toggle('active', el.id === page));
  $$('.nav-link').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
  window.location.hash = page;
  window.scrollTo(0, 0);
  render();
}
function renderTones() {
  ['#home-tones', '#workout-tones'].forEach((selector) => {
    $(selector).innerHTML = tones.map((tone) => `<button class="tone ${state.tone === tone ? 'active' : ''}" data-tone="${tone}">${tone}</button>`).join('');
  });
}
function render() {
  renderTones();
  const sessions = allSessions();
  const sets = allSets();
  const volume = sets.reduce((sum, set) => sum + Number(set.weight) * Number(set.reps), 0);
  $('#total-workouts').textContent = sessions.length;
  $('#total-sets').textContent = sets.length;
  $('#total-volume').innerHTML = `${Math.round(volume).toLocaleString()} <b>lb</b>`;
  $('#progress-workouts').textContent = sessions.length;
  $('#progress-sets').textContent = sets.length;
  $('#progress-volume').innerHTML = `${Math.round(volume).toLocaleString()} <b>lb</b>`;
  $('#leaderboard-score').textContent = `${sessions.length} workout${sessions.length === 1 ? '' : 's'}`;
  $('#recent-activity').innerHTML = sessions.length ? sessions.slice().reverse().slice(0, 3).map((session) => `<div class="history-item"><span><strong>${escapeHtml(session.name)}</strong><br><small>${formatDate(session.startedAt)}</small></span><span>${session.sets.length} sets</span></div>`).join('') : 'No workouts yet. Your first session starts here.';
  $('#history').innerHTML = state.sessions.length ? state.sessions.slice().reverse().map((session) => `<div class="history-item"><span><strong>${escapeHtml(session.name)}</strong><br><small>${formatDate(session.startedAt)}</small></span><span>${session.sets.length} sets</span></div>`).join('') : 'Your finished workouts will appear here.';
  $('#session-start').hidden = Boolean(state.active);
  $('#session-active').hidden = !state.active;
  $('#session-title').textContent = state.active ? state.active.name : 'Start a session';
  $('#session-status').textContent = state.active ? 'IN PROGRESS' : 'READY';
  if (state.active) {
    $('#session-time').textContent = `Started ${new Date(state.active.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    $('#session-count').textContent = `${state.active.sets.length} sets logged`;
    $('#set-list').innerHTML = state.active.sets.slice().reverse().map((set) => `<div class="set-item"><span><strong>${escapeHtml(set.exercise)}</strong><br><small>${set.reps} reps × ${set.weight} lb${set.rpe ? ` · RPE ${set.rpe}` : ''}</small></span><small>${new Date(set.loggedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div>`).join('');
  }
  const names = [...new Set(sets.map((set) => set.exercise))];
  const select = $('#compare-exercise');
  const selected = select.value;
  select.innerHTML = names.length ? names.map((name) => `<option>${escapeHtml(name)}</option>`).join('') : '<option>No exercises logged</option>';
  if (names.includes(selected)) select.value = selected;
  renderComparison();
  renderPlan();
}
function renderComparison() {
  const exercise = $('#compare-exercise').value;
  const sets = allSets().filter((set) => set.exercise === exercise).sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt));
  if (sets.length < 2) { $('#comparison').innerHTML = 'Log two sets of an exercise to see a comparison.'; return; }
  const first = sets[0], latest = sets[sets.length - 1];
  const firstVolume = first.weight * first.reps, latestVolume = latest.weight * latest.reps;
  const change = firstVolume ? ((latestVolume - firstVolume) / firstVolume * 100) : null;
  $('#comparison').innerHTML = `<div class="comparison-stat">${change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</div><div class="comparison-detail">Change in set volume · ${firstVolume} lb → ${latestVolume} lb</div><div class="comparison-detail">${formatDate(first.loggedAt)} vs ${formatDate(latest.loggedAt)}</div>`;
}
function renderPlan() {
  if (!state.plan) return;
  const { goal, days, minutes, equipment } = state.plan;
  const splits = days <= 3 ? ['Full body A', 'Full body B', 'Full body C'] : days === 4 ? ['Upper A', 'Lower A', 'Upper B', 'Lower B'] : ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full body'];
  const movements = equipment === 'Bodyweight' ? 'Squat · push-up · row variation · core' : equipment === 'Dumbbells' ? 'Goblet squat · DB press · DB row · hinge' : 'Squat · press · hinge · pull';
  $('#plan-output').innerHTML = Array.from({ length: days }, (_, i) => `<div class="plan-day"><strong>Day ${i + 1} · ${splits[i]}</strong><small>${movements} · about ${minutes} min</small></div>`).join('') + `<small class="hint">${escapeHtml(goal)} · ${escapeHtml(equipment)}</small>`;
}
function say(message) { $('#jim-message').textContent = message; }
$$('[data-page]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
$$('[data-go]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.go)));
document.addEventListener('click', (event) => { const button = event.target.closest('[data-tone]'); if (!button) return; state.tone = button.dataset.tone; save(); renderTones(); say(`${state.tone} mode selected. ${lines[state.tone][0]}`); });
$('#start-session').addEventListener('click', () => { state.active = { id: crypto.randomUUID(), name: $('#workout-name').value.trim() || 'Strength session', startedAt: new Date().toISOString(), sets: [] }; save(); render(); say('Session started. Choose an exercise and log your first set.'); });
$('#log-set').addEventListener('click', () => {
  if (!state.active) return;
  const reps = Number($('#reps').value), weight = Number($('#weight').value);
  if (!Number.isInteger(reps) || reps < 1 || !Number.isFinite(weight) || weight < 0) { alert('Enter at least one rep and a weight of zero or more.'); return; }
  state.active.sets.push({ id: crypto.randomUUID(), exercise: $('#exercise').value, weight, reps, rpe: $('#rpe').value, notes: $('#set-notes').value.trim(), loggedAt: new Date().toISOString() });
  $('#set-notes').value = ''; save(); render(); say(lines[state.tone][state.active.sets.length % 2]);
});
$('#finish-session').addEventListener('click', () => { if (!state.active) return; state.active.finishedAt = new Date().toISOString(); state.sessions.push(state.active); state.active = null; save(); render(); say('Workout complete. You showed up and put in the work.'); });
$('#generate-plan').addEventListener('click', () => { state.plan = { goal: $('#plan-goal').value, days: Number($('#plan-days').value), minutes: Number($('#plan-minutes').value), equipment: $('#plan-equipment').value }; save(); renderPlan(); });
$('#compare-exercise').addEventListener('change', renderComparison);
$('#send-jim').addEventListener('click', () => { const input = $('#jim-input'); if (!input.value.trim()) return; say(lines[state.tone][Math.floor(Math.random() * 2)] + ' I heard: “' + input.value.trim() + '”'); input.value = ''; });
$('#jim-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('#send-jim').click(); });
$('#voice-input').addEventListener('click', () => { const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SpeechRecognition) { say('Voice input is not available in this browser. You can type to Jim instead.'); return; } const recognition = new SpeechRecognition(); recognition.lang = 'en-US'; recognition.onresult = (event) => { $('#jim-input').value = event.results[0][0].transcript; $('#send-jim').click(); }; recognition.onerror = () => say('I could not hear that. Try typing your note.'); recognition.start(); });
let cameraStream = null;
$('#camera-toggle').addEventListener('click', async () => {
  if (cameraStream) { cameraStream.getTracks().forEach((track) => track.stop()); cameraStream = null; $('#camera').srcObject = null; $('#camera').hidden = true; $('#camera-placeholder').hidden = false; $('#camera-toggle').textContent = 'Enable camera'; return; }
  try { cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }); $('#camera').srcObject = cameraStream; $('#camera').hidden = false; $('#camera-placeholder').hidden = true; $('#camera-toggle').textContent = 'Turn off camera'; } catch { say('Camera access was unavailable. Check your browser permissions and try again.'); }
});
window.addEventListener('pagehide', () => cameraStream?.getTracks().forEach((track) => track.stop()));
$('#today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
render(); showPage(['home', 'workout', 'plans', 'progress', 'leaderboard'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home');

