// ── Plan Loading ─────────────────────────────────────
let planData;

function loadPlan() {
  try {
    const stored = localStorage.getItem(PLAN_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.schedule && parsed.schedule.length) {
        planData = parsed;
        return;
      }
    }
  } catch(e) {}
  planData = DEFAULT_PLAN;
}

loadPlan();

// ── Schedule Merge Helper ────────────────────────────
function mergeScheduleUpdates(schedule, updates) {
  const idxMap = new Map();
  schedule.forEach((item, i) => idxMap.set(item.id, i));
  const notFound = [];
  updates.forEach(update => {
    if (!update.id) return;
    const idx = idxMap.get(update.id);
    if (idx !== undefined) {
      schedule[idx] = { ...schedule[idx], ...update };
    } else {
      notFound.push(update.id);
    }
  });
  return notFound;
}

// ── Live Wait Times ──────────────────────────────────
async function fetchWithCorsRetry(url) {
  // Try direct first
  try {
    const r = await fetch(url);
    if (r.ok) return r.json();
  } catch(e) {}
  // Try each proxy
  for (const proxy of CORS_PROXIES) {
    try {
      const r = await fetch(proxy(url));
      if (r.ok) return r.json();
    } catch(e) {}
  }
  return null;
}
let liveWaits = {};
let lastFetchTime = null;

function normalizeRideName(name) {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function similarityScore(a, b) {
  const na = normalizeRideName(a);
  const nb = normalizeRideName(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wordsA = new Set(na.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(nb.split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  wordsA.forEach(w => { if (wordsB.has(w)) intersection++; });
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

function findBestMatch(title, apiRides) {
  let best = null;
  let bestScore = 0;
  apiRides.forEach(ride => {
    const score = similarityScore(title, ride.name);
    if (score > bestScore) {
      bestScore = score;
      best = ride;
    }
  });
  return bestScore >= 0.3 ? best : null;
}

async function fetchLiveWaits() {
  try {
    const [dlRes, dcaRes] = await Promise.all([
      fetchWithCorsRetry(QUEUE_TIMES_BASE.dl),
      fetchWithCorsRetry(QUEUE_TIMES_BASE.dca)
    ]);

    if (!dlRes && !dcaRes) {
      updateLiveWaitsStatus(0, 'Could not reach Queue-Times API');
      return;
    }

    const apiRides = { dl: [], dca: [] };
    [['dl', dlRes], ['dca', dcaRes]].forEach(([park, res]) => {
      if (res && res.lands) {
        res.lands.forEach(land => {
          if (land.rides) apiRides[park].push(...land.rides);
        });
      }
    });

    liveWaits = {};
    let matchCount = 0;
    planData.schedule.forEach(item => {
      if (item.type !== 'ride') return;
      const park = item.park;
      if (!apiRides[park] || apiRides[park].length === 0) return;
      const match = findBestMatch(item.title, apiRides[park]);
      if (match) {
        liveWaits[item.id] = {
          wait_time: match.wait_time,
          is_open: match.is_open,
          last_updated: match.last_updated,
          api_name: match.name
        };
        matchCount++;
      }
    });

    lastFetchTime = new Date();
    updateLiveWaitsStatus(matchCount, null);
    renderTimeline();
  } catch (err) {
    console.warn('Live wait times unavailable:', err);
    updateLiveWaitsStatus(0, err.message);
  }
}

function updateLiveWaitsStatus(matchCount, error) {
  const el = document.getElementById('liveWaitsStatus');
  if (!el) return;
  if (error) {
    el.textContent = 'Unavailable: ' + error;
    el.style.color = '#e05050';
  } else if (matchCount > 0) {
    const ago = lastFetchTime ? Math.round((Date.now() - lastFetchTime.getTime()) / 60000) : 0;
    el.textContent = `Active \u2014 ${matchCount} rides matched \u00b7 updated ${ago < 1 ? 'just now' : ago + ' min ago'}`;
    el.style.color = '#40c870';
  } else {
    el.textContent = 'No rides matched from API data.';
    el.style.color = 'var(--text-dim)';
  }
}

// ── Quick Actions ─────────────────────────────────────
let activeCardId = null;

function openActions(id) {
  const item = planData.schedule.find(s => s.id === id);
  if (!item || item.type === 'walk') return;
  activeCardId = id;

  const isDone = !!completed[id];
  const isRide = item.type === 'ride';
  const live = liveWaits[id];
  const liveStr = live && live.is_open ? `${live.wait_time} min live` : (live && !live.is_open ? 'CLOSED' : '');

  let html = `<div class="action-sheet-title">${item.title}</div>`;
  let subParts = [item.time];
  if (item.method) subParts.push(item.method.toUpperCase());
  if (liveStr) subParts.push(liveStr);
  html += `<div class="action-sheet-sub">${subParts.join(' \u00b7 ')}</div>`;

  if (isRide && !isDone) {
    html += btn('\uD83D\uDEAB', 'Ride is down', 'down');
    html += btn('\u23F1', 'Wait too long', 'wait-long');
    if (item.method === 'll') html += btn('\u26A1', 'Missed LL window', 'missed-ll');
    if (item.method === 'll') {
      html += `<div class="action-custom-wrap" id="llTimesWrap" style="display:none;">
        <input type="text" id="llTimesInput" placeholder="e.g. Guardians 1:30, Incred 2:15" />
        <button onclick="sendAction('ll-times')">Copy</button>
      </div>`;
      html += btn('\uD83C\uDF9F', 'LL times available', 'show-ll-times');
    }
    html += btn('\u23ED', 'Skip this', 'skip');
  }
  if (isRide && isDone) {
    html += btn('\uD83D\uDD04', 'Ride again', 'ride-again');
  }

  // Universal (non-walk)
  html += btn('\uD83D\uDD50', 'Running behind', 'behind');
  html += btn('\uD83C\uDFC3', 'Ahead of schedule', 'ahead');
  html += btn('\uD83C\uDF7D', 'Need a break', 'break');
  html += `<div class="action-custom-wrap" id="customNoteWrap" style="display:none;">
    <input type="text" id="customNoteInput" placeholder="Type a note\u2026" />
    <button onclick="sendAction('custom')">Copy</button>
  </div>`;
  html += btn('\uD83D\uDCDD', 'Custom note', 'show-custom');

  document.getElementById('actionSheetBody').innerHTML = html;
  document.getElementById('actionOverlay').classList.add('open');
}

function btn(icon, label, type) {
  let onclick;
  if (type === 'show-custom') {
    onclick = `document.getElementById('customNoteWrap').style.display='flex';document.getElementById('customNoteInput').focus();`;
  } else if (type === 'show-ll-times') {
    onclick = `document.getElementById('llTimesWrap').style.display='flex';document.getElementById('llTimesInput').focus();`;
  } else {
    onclick = `sendAction('${type}')`;
  }
  return `<button class="action-btn" onclick="${onclick}"><span class="action-btn-icon">${icon}</span>${label}</button>`;
}

function closeActions() {
  document.getElementById('actionOverlay').classList.remove('open');
  activeCardId = null;
}

function generateCompactContext() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
  const rides = planData.schedule.filter(s => s.type === 'ride');
  const doneCount = rides.filter(r => completed[r.id]).length;

  let lines = [];
  lines.push(`\uD83D\uDCCD ${timeStr} \u00b7 ${doneCount}/${rides.length} rides done`);

  const item = planData.schedule.find(s => s.id === activeCardId);
  if (item) {
    let pin = `\uD83D\uDCCC ${item.title}`;
    if (item.method) pin += ` (${item.method.toUpperCase()})`;
    const live = liveWaits[item.id];
    if (live && live.is_open) pin += ` \u00b7 live: ${live.wait_time} min`;
    else if (live && !live.is_open) pin += ' \u00b7 CLOSED';
    lines.push(pin);
  }

  return { header: lines.join('\n'), item };
}

function sendAction(type) {
  const { header, item } = generateCompactContext();
  if (!item) return;

  let issue = '';
  let ask = '';
  const live = liveWaits[item.id];
  const liveMin = live && live.is_open ? live.wait_time : null;

  switch (type) {
    case 'down':
      issue = `\u26A0\uFE0F ${item.title} is closed/down`;
      ask = 'What should I do instead?';
      break;
    case 'wait-long':
      issue = `\u26A0\uFE0F Wait for ${item.title} is too long` + (liveMin ? ` (${liveMin} min live)` : '');
      ask = 'Should I skip it, come back later, or switch strategy?';
      break;
    case 'missed-ll':
      issue = `\u26A0\uFE0F Missed my LL window for ${item.title}`;
      ask = 'How should I adjust the LL chain?';
      break;
    case 'skip':
      issue = `\u23ED ${item.title}`;
      ask = 'What should I do with the freed time?';
      break;
    case 'ride-again':
      issue = `\uD83D\uDD04 Want to ride ${item.title} again`;
      ask = 'Can you fit it in?';
      break;
    case 'behind':
      issue = `\uD83D\uDD50 Running behind schedule at ${item.title}`;
      ask = 'What should I cut or rearrange?';
      break;
    case 'ahead':
      issue = `\uD83C\uDFC3 Finished ${item.title} early`;
      ask = 'What should I add or do next?';
      break;
    case 'break':
      issue = `\uD83C\uDF7D Need food/rest near ${item.title}`;
      ask = 'Where should I go and how to adjust the plan?';
      break;
    case 'll-times': {
      const text = document.getElementById('llTimesInput').value.trim();
      if (!text) return;
      issue = `\uD83C\uDF9F LL times I can see: ${text}`;
      ask = 'Based on these available windows, should I adjust the LL chain order or timing?';
      break;
    }
    case 'custom': {
      const text = document.getElementById('customNoteInput').value.trim();
      if (!text) return;
      issue = `\uD83D\uDCDD Note about ${item.title}: ${text}`;
      ask = 'How should I adjust?';
      break;
    }
  }

  const fullExport = buildFullExportJSON();
  const msg = `[Disneyland Navigator \u2014 Quick Update]\n\n${header}\n\n${issue}\n\n${ask}\n\n${fullExport}`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(msg).then(() => {
      showToast('Copied to clipboard!');
      closeActions();
    }).catch(() => {
      showToast('Clipboard failed');
    });
  } else {
    showToast('Clipboard not available');
  }
}

function showToast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ── State ─────────────────────────────────────────────
let completed = {};
try { completed = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch(e) {}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(completed)); }
function toggle(id) { completed[id] ? delete completed[id] : completed[id] = true; save(); render(); }

// ── Render ────────────────────────────────────────────
function getNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function findCurrentIdx() {
  const now = getNow();
  let idx = -1;
  for (let i = 0; i < planData.schedule.length; i++) {
    if (planData.schedule[i].m <= now) idx = i;
  }
  return idx;
}

function renderHeader() {
  document.getElementById('appTitle').textContent = planData.meta.title;
  document.getElementById('appDate').textContent = planData.meta.date;
  document.getElementById('appCost').textContent = planData.meta.cost;
}

function renderTimeline() {
  const el = document.getElementById('view-timeline');
  const schedule = planData.schedule;
  const nowIdx = findCurrentIdx();
  let nextRideIdx = -1;
  if (nowIdx >= 0) {
    for (let i = nowIdx + 1; i < schedule.length; i++) {
      if (schedule[i].type === 'ride' && !completed[schedule[i].id]) { nextRideIdx = i; break; }
    }
  }

  let html = '';
  let currentPark = null;

  schedule.forEach((item, i) => {
    // Park banner
    if (item.park !== currentPark) {
      currentPark = item.park;
      if (currentPark === 'dca') {
        html += '<div class="park-banner dca">\uD83C\uDFD6\uFE0F Disney California Adventure<span class="park-time">11:00 \u2013 1:55</span></div>';
      } else {
        html += '<div class="park-banner dl">\uD83C\uDFF0 Disneyland Park<span class="park-time">2:00 \u2013 8:30</span></div>';
      }
    }

    // Walk connector
    if (item.type === 'walk') {
      html += `<div class="walk" style="animation-delay:${i*40}ms"><span class="walk-dot"></span>${item.title} \u00b7 ${item.wait} min</div>`;
      return;
    }

    const isRide = item.type === 'ride';
    const isDone = !!completed[item.id];
    const isNow = i === nowIdx && !isDone;
    const isNext = i === nextRideIdx && !isDone;
    const methodClass = item.method ? `method-${item.method}` : '';
    const doneClass = isDone ? 'done' : '';
    const nowClass = isNow ? 'now' : '';

    html += `<div class="card ${methodClass} ${doneClass} ${nowClass}" style="animation-delay:${i*40}ms" onclick="openActions('${item.id}')">`;
    html += `<div class="card-top">`;
    html += `<span class="card-time">${item.time}</span>`;
    html += `<span class="card-title">${item.title}</span>`;
    if (item.method === 'll') {
      html += '<span class="badge badge-ll">LL</span>';
      if (item.hasSr) html += '<span class="badge badge-sr">SR</span>';
    }
    if (item.method === 'sr') html += '<span class="badge badge-sr">SR</span>';
    if (item.method === 'standby') html += '<span class="badge badge-standby">Standby</span>';
    if (isNow) html += '<span class="badge badge-now">NOW</span>';
    if (isNext) html += '<span class="badge badge-next">NEXT</span>';
    html += '</div>';

    if (isRide) {
      const live = liveWaits[item.id];
      if (live && live.is_open) {
        const staleClass = lastFetchTime && (Date.now() - lastFetchTime.getTime() > 600000) ? ' stale' : '';
        html += `<div class="card-details"><span class="card-wait card-wait-live"><span class="live-dot${staleClass}"></span>${live.wait_time} min live</span>`;
        if (item.wait != null) html += `<span class="card-wait card-wait-planned"> \u00b7 ~${item.wait} min planned</span>`;
        html += `</div>`;
      } else if (live && !live.is_open) {
        html += `<div class="card-details"><span class="card-closed">CLOSED</span>`;
        if (item.wait != null) html += `<span class="card-wait card-wait-planned"> \u00b7 ~${item.wait} min planned</span>`;
        html += `</div>`;
      } else if (item.wait != null) {
        html += `<div class="card-details"><span class="card-wait">\u23F1 ~${item.wait} min wait</span></div>`;
      }
    }
    if (item.wait != null && item.type === 'meal') {
      html += `<div class="card-details"><span class="card-wait">\uD83C\uDF7D ~${item.wait} min</span></div>`;
    }
    if (item.llNote) {
      html += `<div class="card-ll-note">\u26A1 ${item.llNote}</div>`;
    }

    if (isRide) {
      html += `<button class="card-check ${isDone?'checked':''}" onclick="event.stopPropagation();toggle('${item.id}')" aria-label="Mark complete">${isDone?'\u2713':''}</button>`;
    }

    html += '</div>';
  });

  if (Object.keys(liveWaits).length > 0) {
    html += '<div class="attribution">Wait times powered by <a href="https://queue-times.com" target="_blank" rel="noopener">Queue-Times.com</a></div>';
  }

  el.innerHTML = html;
}

function renderChain() {
  const el = document.getElementById('view-chain');
  const chain = planData.llChain;
  let html = '<div class="section-title">Lightning Lane Booking Chain</div>';
  html += '<p style="font-size:12px;color:var(--text-dim);margin-bottom:16px;">Book one at a time. After tapping in, immediately book the next.</p>';

  chain.forEach((step, i) => {
    const isDone = !!completed[step.rideId];
    html += `<div class="chain-step ${isDone?'done':''}" style="animation-delay:${i*60}ms">`;
    html += `<div class="chain-num">${isDone?'\u2713':step.num}</div>`;
    html += '<div class="chain-body">';
    html += `<div class="chain-trigger">${step.trigger}</div>`;
    html += `<div class="chain-ride">${step.ride}</div>`;
    html += `<div class="chain-park ${step.park}">${step.park==='dca'?'California Adventure':'Disneyland'}</div>`;
    if (step.note) html += `<div class="chain-note">${step.note}</div>`;
    if (i === 2) html += '<div class="chain-note">\u23F0 2-hour rule may apply after this step</div>';
    html += '</div></div>';
  });

  el.innerHTML = html;
}

function renderMustDos() {
  const el = document.getElementById('view-mustdos');
  const mustDos = planData.mustDos;
  const doneCount = mustDos.filter(m => completed[m.id]).length;
  let html = '<div class="section-title">Must-Do Rides</div>';
  html += `<div class="mustdo-progress">${doneCount}/${mustDos.length} must-dos complete</div>`;

  mustDos.forEach((m, i) => {
    const isDone = !!completed[m.id];
    html += `<div class="mustdo-item ${isDone?'done':''}" style="animation-delay:${i*60}ms">`;
    html += `<button class="mustdo-check ${isDone?'checked':''}" onclick="toggle('${m.id}')" aria-label="Mark complete">${isDone?'\u2713':''}</button>`;
    html += `<span class="mustdo-title">${m.title}</span>`;
    html += `<span class="mustdo-meta">${m.park} \u00b7 ${m.method}</span>`;
    html += '</div>';
  });

  el.innerHTML = html;
}

function renderTips() {
  const el = document.getElementById('view-tips');
  let html = '<div class="section-title">Contingencies</div>';

  planData.contingencies.forEach(c => {
    html += `<details><summary>${c.title}</summary><div class="tip-content">${c.body}</div></details>`;
  });

  html += '<div class="section-title" style="margin-top:20px;">Pro Tips</div>';
  planData.proTips.forEach(t => {
    html += `<details><summary>${t.split('.')[0]}</summary><div class="tip-content">${t}</div></details>`;
  });

  el.innerHTML = html;
}

function updateProgress() {
  const rides = planData.schedule.filter(s => s.type === 'ride');
  const total = rides.length;
  const done = rides.filter(r => completed[r.id]).length;
  document.getElementById('progressFill').style.width = `${(done/total)*100}%`;
  document.getElementById('progressText').textContent = `${done}/${total} rides`;
}

function render() {
  renderHeader();
  renderTimeline();
  renderChain();
  renderMustDos();
  renderTips();
  updateProgress();
}

// ── Settings ──────────────────────────────────────────
function openSettings() {
  document.getElementById('settingsOverlay').classList.add('open');
  // Clear previous messages
  document.getElementById('exportMsg').innerHTML = '';
  document.getElementById('importMsg').innerHTML = '';
  document.getElementById('resetMsg').innerHTML = '';
  document.getElementById('exportArea').style.display = 'none';
  document.getElementById('importArea').value = '';
  // Refresh live waits status display
  const matchCount = Object.keys(liveWaits).length;
  if (lastFetchTime) {
    updateLiveWaitsStatus(matchCount, null);
  }
  // Enable/disable live waits export checkbox based on availability
  const liveCheckbox = document.getElementById('exportLiveWaits');
  if (matchCount === 0) {
    liveCheckbox.checked = false;
    liveCheckbox.disabled = true;
    liveCheckbox.parentElement.style.opacity = '0.4';
  } else {
    liveCheckbox.disabled = false;
    liveCheckbox.parentElement.style.opacity = '1';
  }
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('open');
}

function showMsg(elId, text, type) {
  document.getElementById(elId).innerHTML = `<div class="settings-msg ${type}">${text}</div>`;
}

function buildFullExportJSON(includeLive) {
  if (includeLive === undefined) includeLive = true;
  const exportData = {
    version: 1,
    _instructions: [
      'This is a Disneyland day plan for the Navigator app.',
      'To modify it, output a JSON object with ONLY the sections you want to change under a "plan" key \u2014 unchanged sections will be preserved automatically.',
      'Sections: meta, schedule, llChain, mustDos, contingencies, proTips.',
      'For a full replacement, include at least "schedule" in plan. If "schedule" is absent, it is treated as a partial update.',
      'Partial update example: { "plan": { "meta": { "cost": "~$40/person" } } } \u2014 this changes only the cost, everything else stays.',
      'Another example: { "plan": { "schedule": [...], "llChain": [...] } } \u2014 replaces schedule and llChain, keeps everything else.',
      'To update individual schedule items without replacing the whole schedule, use "scheduleUpdates" instead of "schedule". Each item must have an "id" matching an existing schedule item \u2014 only included fields are overwritten.',
      'scheduleUpdates example: { "plan": { "scheduleUpdates": [{ "id": "rise", "wait": 45 }] } }',
      'You can also output the full export wrapper format with all sections if preferred.'
    ].join(' '),
    _schema: {
      'meta': '{ title: string, date: string, cost: string }',
      'schedule[]': '{ id: string, time: string (e.g. "2:00"), m: number (minutes since midnight), title: string, park: "dca"|"dl", type: "ride"|"walk"|"meal"|"action", method: "ll"|"sr"|"standby"|null, wait: number|null (minutes), isMustDo: bool, llNote: string|null, hasSr: bool|null (true if LL ride also has Single Rider) }',
      'scheduleUpdates[]': '{ id: string (required, matches existing schedule id), ...any schedule fields to overwrite }',
      'llChain[]': '{ num: number, trigger: string, ride: string, park: "dca"|"dl", rideId: string (matches schedule id), note?: string }',
      'mustDos[]': '{ id: string (matches schedule id), title: string, park: string, method: string }',
      'contingencies[]': '{ title: string, body: string }',
      'proTips[]': 'string'
    },
    plan: JSON.parse(JSON.stringify(planData)),
    completed: { ...completed },
    exportedAt: new Date().toISOString()
  };
  // Remove version from plan level if it exists (it's at top level)
  delete exportData.plan.version;

  // Include live wait times if requested
  if (includeLive && Object.keys(liveWaits).length > 0) {
    exportData.liveWaitTimes = {
      _note: 'Real-time wait data from Queue-Times.com, fetched at the time of export. Use these to advise on schedule adjustments.',
      fetchedAt: lastFetchTime ? lastFetchTime.toISOString() : null,
      rides: {}
    };
    for (const id in liveWaits) {
      const lw = liveWaits[id];
      const item = planData.schedule.find(s => s.id === id);
      exportData.liveWaitTimes.rides[id] = {
        name: item ? item.title : id,
        liveWait: lw.wait_time,
        plannedWait: item ? item.wait : null,
        isOpen: lw.is_open,
        apiName: lw.api_name
      };
    }
  }

  return JSON.stringify(exportData, null, 2);
}

function exportPlan() {
  const includeLive = document.getElementById('exportLiveWaits').checked;
  const json = buildFullExportJSON(includeLive);

  // Show in textarea as fallback
  const area = document.getElementById('exportArea');
  area.value = json;
  area.style.display = 'block';

  // Try clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json).then(() => {
      showMsg('exportMsg', 'Copied to clipboard!', 'success');
    }).catch(() => {
      showMsg('exportMsg', 'Clipboard failed \u2014 copy from the text box below.', 'error');
      area.select();
    });
  } else {
    showMsg('exportMsg', 'Clipboard not available \u2014 copy from the text box below.', 'error');
    area.select();
  }
}

function importPlan() {
  const raw = document.getElementById('importArea').value.trim();
  if (!raw) {
    showMsg('importMsg', 'Paste JSON data first.', 'error');
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch(e) {
    showMsg('importMsg', 'Invalid JSON: ' + e.message, 'error');
    return;
  }

  // Strip _instructions and _schema if present (they're for Claude, not for us)
  delete data._instructions;
  delete data._schema;

  // Extract the plan object from various formats
  let newPlan;
  if (data.plan) {
    // Wrapper format: { plan: { ... }, completed?, ... }
    newPlan = data.plan;
    if (data.completed) {
      Object.assign(completed, data.completed);
    }
  } else if (data.schedule || data.meta || data.llChain || data.mustDos || data.contingencies || data.proTips || data.scheduleUpdates) {
    // Direct plan format (with or without all sections)
    newPlan = data;
  } else {
    showMsg('importMsg', 'No recognizable plan data found.', 'error');
    return;
  }

  // Detect partial vs full update: if schedule is absent, it's partial
  const isPartial = !newPlan.schedule;

  if (isPartial) {
    // --- Partial update: merge only provided sections into current planData ---

    // Validate sections that are present
    if (newPlan.schedule && (!Array.isArray(newPlan.schedule) || newPlan.schedule.length === 0)) {
      showMsg('importMsg', 'Schedule must be a non-empty array.', 'error');
      return;
    }
    if (newPlan.schedule) {
      for (let i = 0; i < newPlan.schedule.length; i++) {
        const item = newPlan.schedule[i];
        if (!item.id || !item.time || !item.title) {
          showMsg('importMsg', `Schedule item ${i} missing id, time, or title.`, 'error');
          return;
        }
      }
    }
    if (newPlan.llChain && !Array.isArray(newPlan.llChain)) {
      showMsg('importMsg', 'llChain must be an array.', 'error');
      return;
    }
    if (newPlan.mustDos && !Array.isArray(newPlan.mustDos)) {
      showMsg('importMsg', 'mustDos must be an array.', 'error');
      return;
    }
    if (newPlan.contingencies && !Array.isArray(newPlan.contingencies)) {
      showMsg('importMsg', 'contingencies must be an array.', 'error');
      return;
    }
    if (newPlan.proTips && !Array.isArray(newPlan.proTips)) {
      showMsg('importMsg', 'proTips must be an array.', 'error');
      return;
    }

    // Merge: only overwrite sections that are present
    const updatedParts = [];
    if (newPlan.meta) { planData.meta = { ...planData.meta, ...newPlan.meta }; updatedParts.push('meta'); }
    if (newPlan.schedule) { planData.schedule = newPlan.schedule; updatedParts.push('schedule'); }
    if (newPlan.llChain) { planData.llChain = newPlan.llChain; updatedParts.push('llChain'); }
    if (newPlan.mustDos) { planData.mustDos = newPlan.mustDos; updatedParts.push('mustDos'); }
    if (newPlan.contingencies) { planData.contingencies = newPlan.contingencies; updatedParts.push('contingencies'); }
    if (newPlan.proTips) { planData.proTips = newPlan.proTips; updatedParts.push('proTips'); }

    if (newPlan.scheduleUpdates && Array.isArray(newPlan.scheduleUpdates)) {
      const notFound = mergeScheduleUpdates(planData.schedule, newPlan.scheduleUpdates);
      if (notFound.length) {
        showMsg('importMsg', 'Schedule IDs not found: ' + notFound.join(', '), 'error');
        return;
      }
      updatedParts.push(newPlan.scheduleUpdates.length + ' schedule item(s)');
    }

    save();
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(planData));
    render();
    fetchLiveWaits();
    showMsg('importMsg', 'Partial update applied: ' + updatedParts.join(', '), 'success');

  } else {
    // --- Full replacement (existing logic) ---

    // Validate required fields
    if (!Array.isArray(newPlan.schedule) || newPlan.schedule.length === 0) {
      showMsg('importMsg', 'Schedule must be a non-empty array.', 'error');
      return;
    }

    for (let i = 0; i < newPlan.schedule.length; i++) {
      const item = newPlan.schedule[i];
      if (!item.id || !item.time || !item.title) {
        showMsg('importMsg', `Schedule item ${i} missing id, time, or title.`, 'error');
        return;
      }
    }

    if (!Array.isArray(newPlan.llChain)) {
      showMsg('importMsg', 'Missing required "llChain" array.', 'error');
      return;
    }

    if (!Array.isArray(newPlan.mustDos)) {
      showMsg('importMsg', 'Missing required "mustDos" array.', 'error');
      return;
    }

    // Fill in optional fields with defaults
    if (!newPlan.meta) {
      newPlan.meta = { title: 'Disneyland Navigator', date: '', cost: '' };
    }
    if (!Array.isArray(newPlan.contingencies)) newPlan.contingencies = [];
    if (!Array.isArray(newPlan.proTips)) newPlan.proTips = [];

    // Merge completion state: keep completed IDs that exist in new plan, drop orphans
    const newIds = new Set();
    newPlan.schedule.forEach(s => newIds.add(s.id));
    newPlan.mustDos.forEach(m => newIds.add(m.id));
    newPlan.llChain.forEach(l => { if (l.rideId) newIds.add(l.rideId); });

    const newCompleted = {};
    for (const id in completed) {
      if (newIds.has(id)) newCompleted[id] = true;
    }
    completed = newCompleted;
    save();

    // Save plan to localStorage
    planData = newPlan;

    if (newPlan.scheduleUpdates && Array.isArray(newPlan.scheduleUpdates)) {
      const notFound = mergeScheduleUpdates(planData.schedule, newPlan.scheduleUpdates);
      if (notFound.length) {
        showMsg('importMsg', 'Schedule IDs not found: ' + notFound.join(', '), 'error');
        return;
      }
    }

    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(planData));

    render();
    fetchLiveWaits();
    showMsg('importMsg', 'Plan imported successfully!', 'success');
  }
}

function resetPlan() {
  if (!confirm('Reset to the default built-in plan? Your imported plan data will be removed.')) return;

  localStorage.removeItem(PLAN_STORAGE_KEY);
  planData = DEFAULT_PLAN;

  // Clean up orphaned completions
  const validIds = new Set();
  planData.schedule.forEach(s => validIds.add(s.id));
  planData.mustDos.forEach(m => validIds.add(m.id));
  planData.llChain.forEach(l => { if (l.rideId) validIds.add(l.rideId); });

  const cleaned = {};
  for (const id in completed) {
    if (validIds.has(id)) cleaned[id] = true;
  }
  completed = cleaned;
  save();

  render();
  showMsg('resetMsg', 'Reset to default plan.', 'success');
}

// ── Tabs ──────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.classList.remove('view-entering'); });
    tab.classList.add('active');
    const view = document.getElementById('view-' + tab.dataset.view);
    view.classList.add('active', 'view-entering');
    view.addEventListener('animationend', () => view.classList.remove('view-entering'), { once: true });
  });
});

// ── Init ──────────────────────────────────────────────
render();
fetchLiveWaits();
// Update current activity every 60s
setInterval(() => { renderTimeline(); }, 60000);
// Refresh live wait times every 5 min
setInterval(fetchLiveWaits, 300000);
