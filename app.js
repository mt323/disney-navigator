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

async function fetchWithCorsRetryHTML(url) {
  try {
    const r = await fetch(url);
    if (r.ok) return r.text();
  } catch(e) {}
  for (const proxy of CORS_PROXIES) {
    try {
      const r = await fetch(proxy(url));
      if (r.ok) return r.text();
    } catch(e) {}
  }
  return null;
}
let liveWaits = {};
let lastFetchTime = null;
let llSlots = {};        // { scheduleId: { time: "16:25" | null, soldOut: bool, fetchedAt: Date } }
let lastLLFetchTime = null;

// ── All Rides Browser ────────────────────────────────
let allRides = {};        // { "dl": [{ land, rides: [{ id, name, wait_time, is_open, ... }] }], "dca": [...] }
let allRidesLL = {};      // { "{park}-{rideId}": { name, time, soldOut, park } }
let rideWishlist = {};    // { "{park}-{rideId}": true } — persisted to localStorage
let ridesSortMode = 'default'; // 'default' | 'wait' | 'score'
let ridesFilter = 'all';      // 'all' | 'rides' | 'shows'

const WISHLIST_KEY = 'disney-ride-wishlist';
try { rideWishlist = JSON.parse(localStorage.getItem(WISHLIST_KEY)) || {}; } catch(e) {}
function saveWishlist() { localStorage.setItem(WISHLIST_KEY, JSON.stringify(rideWishlist)); }

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

    // Store ALL rides grouped by land, folding Single Rider into parent ride
    allRides = {};
    [['dl', dlRes], ['dca', dcaRes]].forEach(([park, res]) => {
      allRides[park] = [];
      if (res && res.lands) {
        res.lands.forEach(land => {
          if (land.rides && land.rides.length > 0) {
            const srMap = {};
            const regular = [];
            land.rides.forEach(r => {
              const srMatch = r.name.match(/^(.+?)\s*[-–—]\s*Single Rider$/i);
              if (srMatch) {
                srMap[srMatch[1].trim()] = { wait: r.wait_time, is_open: r.is_open };
              } else if (/single\s*rider/i.test(r.name)) {
                const baseName = r.name.replace(/\s*[-–—]?\s*single\s*rider\s*/i, '').trim();
                srMap[baseName] = { wait: r.wait_time, is_open: r.is_open };
              } else {
                regular.push({ ...r, park });
              }
            });
            // Attach SR wait to parent ride
            regular.forEach(r => {
              const sr = srMap[r.name] || Object.entries(srMap).find(([k]) => r.name.startsWith(k))?.[1];
              if (sr) { r.sr_wait = sr.wait; r.sr_open = sr.is_open; }
            });
            if (regular.length > 0) {
              allRides[park].push({ land: land.name, rides: regular });
            }
          }
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
    renderRides();
  } catch (err) {
    console.warn('Live wait times unavailable:', err);
    updateLiveWaitsStatus(0, err.message);
  }
}

async function fetchLLSlots() {
  try {
    const [dlHtml, dcaHtml] = await Promise.all([
      fetchWithCorsRetryHTML(LL_SLOTS_BASE.dl),
      fetchWithCorsRetryHTML(LL_SLOTS_BASE.dca)
    ]);

    if (!dlHtml && !dcaHtml) {
      updateLLSlotsStatus(0, 'Could not reach Queue-Times');
      return;
    }

    // Extract ride names from HTML
    const rideNameMap = {};
    [['dl', dlHtml], ['dca', dcaHtml]].forEach(([park, html]) => {
      if (!html) return;
      const nameRe = /\/rides\/(\d+)"[^>]*>([^<]+)</g;
      let nm;
      while ((nm = nameRe.exec(html)) !== null) {
        rideNameMap[park + '-' + nm[1]] = nm[2].trim();
      }
    });

    allRidesLL = {};
    let matchCount = 0;

    [['dl', dlHtml], ['dca', dcaHtml]].forEach(([park, html]) => {
      if (!html) return;
      const re = /rides\/(\d+)\/reservation_slots[\s\S]*?↳\s*(Reservation slots available for (\d{2}:\d{2})|No reservation slots currently available)/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const rideId = m[1];
        const hasTime = !!m[3];
        // Store ALL LL data
        allRidesLL[park + '-' + rideId] = {
          name: rideNameMap[park + '-' + rideId] || null,
          time: hasTime ? m[3] : null,
          soldOut: !hasTime,
          park
        };
        // Existing plan-specific logic
        const schedId = LL_RIDE_IDS[rideId];
        if (!schedId) continue;
        llSlots[schedId] = {
          time: hasTime ? m[3] : null,
          soldOut: !hasTime,
          fetchedAt: new Date()
        };
        matchCount++;
      }
    });

    lastLLFetchTime = new Date();
    updateLLSlotsStatus(matchCount, null);
    renderTimeline();
    renderChain();
    checkLLPlanAlignment();
    renderRides();
  } catch (err) {
    console.warn('LL slot data unavailable:', err);
    updateLLSlotsStatus(0, err.message);
  }
}

function updateLLSlotsStatus(matchCount, error) {
  const el = document.getElementById('llSlotsStatus');
  if (!el) return;
  if (error) {
    el.textContent = 'Unavailable: ' + error;
    el.style.color = '#e05050';
  } else if (matchCount > 0) {
    const ago = lastLLFetchTime ? Math.round((Date.now() - lastLLFetchTime.getTime()) / 60000) : 0;
    el.textContent = `${matchCount}/9 rides · updated ${ago < 1 ? 'just now' : ago + ' min ago'}`;
    el.style.color = '#40c870';
  } else {
    el.textContent = 'No LL slot data found.';
    el.style.color = 'var(--text-dim)';
  }
}

function formatLLTime(time24) {
  if (!time24) return null;
  const [h, m] = time24.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')}${suffix}`;
}

function checkLLPlanAlignment() {
  const chain = planData.llChain;
  if (!chain) return;

  chain.forEach(step => {
    const slot = llSlots[step.rideId];
    if (!slot || slot.soldOut || !slot.time) {
      step._llAlert = null;
      return;
    }

    const schedItem = planData.schedule.find(s => s.id === step.rideId);
    if (!schedItem) { step._llAlert = null; return; }

    const [slotH, slotM] = slot.time.split(':').map(Number);
    const slotMinutes = slotH * 60 + slotM;
    const plannedMinutes = schedItem.m;
    const diff = slotMinutes - plannedMinutes;

    if (diff > 30) {
      step._llAlert = { type: 'warning', text: `LL window is ${formatLLTime(slot.time)} but plan says ${schedItem.time} — ${Math.round(diff / 60)}hr ${diff % 60}min delay` };
    } else if (diff < -10) {
      step._llAlert = { type: 'ahead', text: `Window available at ${formatLLTime(slot.time)}, ahead of ${schedItem.time} plan` };
    } else {
      step._llAlert = null;
    }
  });
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
    // LL return window display
    if (isRide && item.method === 'll') {
      const slot = llSlots[item.id];
      if (slot) {
        const staleClass = slot.fetchedAt && (Date.now() - slot.fetchedAt.getTime() > 1200000) ? ' stale' : '';
        if (slot.soldOut) {
          html += `<div class="card-ll-slot card-ll-slot-none"><span class="ll-slot-dot sold-out"></span>LL: Sold out</div>`;
        } else if (slot.time) {
          html += `<div class="card-ll-slot"><span class="ll-slot-dot${staleClass}"></span>LL window: ${formatLLTime(slot.time)}</div>`;
        }
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

    // LL slot pill
    const slot = llSlots[step.rideId];
    if (slot) {
      if (slot.soldOut) {
        html += '<div class="chain-ll-sold-out">Sold out</div>';
      } else if (slot.time) {
        html += `<div class="chain-ll-slot">Next window: ${formatLLTime(slot.time)}</div>`;
      }
    }
    // Plan alignment alert
    if (step._llAlert) {
      const alertClass = step._llAlert.type === 'warning' ? 'chain-alert chain-alert-warning' : 'chain-alert chain-alert-ahead';
      html += `<div class="${alertClass}">${step._llAlert.text}</div>`;
    }

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

// Personal ride scores (1-5): how much we think you'd enjoy each ride
const RIDE_SCORES = {
  // DCA - Cars Land
  'Radiator Springs Racers': 5,
  'Luigi\'s Rollickin\' Roadsters': 3,
  'Mater\'s Junkyard Jamboree': 3,
  // DCA - Avengers Campus
  'Guardians of the Galaxy - Mission: BREAKOUT!': 5,
  'WEB SLINGERS: A Spider-Man Adventure': 4,
  // DCA - Pixar Pier
  'Incredicoaster': 4,
  'Inside Out Emotional Whirlwind': 2,
  'Jessie\'s Critter Carousel': 1,
  'Pixar Pal-A-Round - Swinging': 3,
  'Pixar Pal-A-Round - Non-Swinging': 2,
  'Toy Story Midway Mania!': 4,
  // DCA - Grizzly Peak
  'Grizzly River Run': 4,
  'Soarin\' Around the World': 5,
  'Soarin\' Over California': 5,
  // DCA - Hollywood Land
  'Monsters, Inc. Mike & Sulley to the Rescue!': 3,
  'Animation Academy': 2,
  'Turtle Talk with Crush': 2,
  // DCA - Paradise Gardens
  'The Little Mermaid ~ Ariel\'s Undersea Adventure': 2,
  'Golden Zephyr': 2,
  'Silly Symphony Swings': 3,
  'Goofy\'s Sky School': 3,
  'Jumping Jellyfish': 1,
  // DCA - San Fransokyo
  'San Fransokyo Square': 2,
  // Disneyland - Adventureland
  'Indiana Jones Adventure': 5,
  'Jungle Cruise': 4,
  // Disneyland - New Orleans Square
  'Haunted Mansion': 5,
  'Pirates of the Caribbean': 5,
  // Disneyland - Critter Country
  'Tiana\'s Bayou Adventure': 5,
  'The Many Adventures of Winnie the Pooh': 2,
  'Davy Crockett\'s Explorer Canoes': 2,
  // Disneyland - Star Wars: Galaxy\'s Edge
  'Star Wars: Rise of the Resistance': 5,
  'Millennium Falcon: Smugglers Run': 4,
  'Millennium Falcon: Smuggler\'s Run': 4,
  // Disneyland - Frontierland
  'Big Thunder Mountain Railroad': 5,
  'Mark Twain Riverboat': 2,
  'Sailing Ship Columbia': 2,
  // Disneyland - Fantasyland
  'Matterhorn Bobsleds': 4,
  'Mr. Toad\'s Wild Ride': 4,
  'Alice in Wonderland': 3,
  'Peter Pan\'s Flight': 3,
  'it\'s a small world': 2,
  'Snow White\'s Enchanted Wish': 3,
  'Pinocchio\'s Daring Journey': 2,
  'Dumbo the Flying Elephant': 1,
  'Casey Jr. Circus Train': 1,
  'Storybook Land Canal Boats': 2,
  'King Arthur Carrousel': 1,
  'Mad Tea Party': 2,
  // Disneyland - Tomorrowland
  'Space Mountain': 5,
  'Buzz Lightyear Astro Blasters': 3,
  'Star Tours - The Adventures Continue': 4,
  'Astro Orbitor': 1,
  'Autopia': 2,
  'Finding Nemo Submarine Voyage': 3,
  // Disneyland - Mickey\'s Toontown
  'Mickey & Minnie\'s Runaway Railway': 4,
  'Roger Rabbit\'s Car Toon Spin': 3,
  'Gadget\'s Go Coaster': 2,
  'Chip \'n\' Dale\'s GADGETcoaster': 2,
  // Non-ride attractions
  'Walt Disney\'s Enchanted Tiki Room': 2,
  'Disney Junior Dance Party!': 1,
  'Fantasmic!': 4,
  'Main Street Electrical Parade': 3,
  'Wondrous Journeys': 3,
  'The Disneyland Story presenting Great Moments with Mr. Lincoln': 1,
  'Star Wars Launch Bay': 2,
  'Sorcerer\'s Workshop': 1,
  'Disney Princess Fantasy Faire': 1,
};

const NON_RIDES = new Set([
  // DCA
  'Animation Academy',
  'Turtle Talk with Crush',
  'Disney Junior Dance Party!',
  'Sorcerer\'s Workshop',
  // Disneyland
  'Fantasmic!',
  'Main Street Electrical Parade',
  'Wondrous Journeys',
  'Walt Disney\'s Enchanted Tiki Room',
  'The Disneyland Story presenting Great Moments with Mr. Lincoln',
  'Star Wars Launch Bay',
  'Disney Princess Fantasy Faire',
]);

function isNonRide(name) {
  if (NON_RIDES.has(name)) return true;
  for (const nr of NON_RIDES) {
    if (similarityScore(nr, name) >= 0.5) return true;
  }
  return false;
}

function getRideScore(rideName) {
  if (RIDE_SCORES[rideName]) return RIDE_SCORES[rideName];
  // Fuzzy match for slight name differences
  for (const [key, score] of Object.entries(RIDE_SCORES)) {
    if (similarityScore(key, rideName) >= 0.5) return score;
  }
  return null;
}

function isPlanRide(rideName) {
  return planData.schedule.some(s => s.type === 'ride' && similarityScore(s.title, rideName) >= 0.5);
}
function isPlanRideDone(rideName) {
  return planData.schedule.some(s => s.type === 'ride' && completed[s.id] && similarityScore(s.title, rideName) >= 0.5);
}
function isMustDoRide(rideName) {
  return planData.mustDos.some(m => similarityScore(m.title, rideName) >= 0.5);
}

function toggleWishlist(key) {
  rideWishlist[key] ? delete rideWishlist[key] : rideWishlist[key] = true;
  saveWishlist();
  renderRides();
}

function setRidesSort(mode) { ridesSortMode = ridesSortMode === mode ? 'default' : mode; renderRides(); }
function setRidesFilter(f) { ridesFilter = ridesFilter === f ? 'all' : f; renderRides(); }

function renderRides() {
  ['dca', 'dl'].forEach(park => renderRidesPark(park));
}

function renderRidesPark(park) {
  const el = document.getElementById('view-' + park);
  if (!el) return;

  const parkLabel = park === 'dca' ? '🏖️ California Adventure' : '🏰 Disneyland';
  const hasData = allRides[park] && allRides[park].length > 0;

  let html = '';

  // Sort controls
  html += '<div class="rides-sort-bar">';
  html += `<button class="rides-sort-btn ${ridesFilter==='rides'?'active':''}" onclick="setRidesFilter('rides')">Rides</button>`;
  html += `<button class="rides-sort-btn ${ridesFilter==='shows'?'active':''}" onclick="setRidesFilter('shows')">Shows</button>`;
  html += '<div style="flex:1;"></div>';
  html += `<button class="rides-sort-btn ${ridesSortMode==='score'?'active':''}" onclick="setRidesSort('score')">Score ↓</button>`;
  html += `<button class="rides-sort-btn ${ridesSortMode==='wait'?'active':''}" onclick="setRidesSort('wait')">Wait ↑</button>`;
  html += '</div>';

  if (!hasData) {
    html += '<div style="text-align:center;color:var(--text-dim);padding:40px 0;font-size:13px;">Waiting for ride data…<br><span style="font-size:11px;opacity:.6;">Data loads automatically from Queue-Times.com</span></div>';
    el.innerHTML = html;
    return;
  }

  html += `<div class="section-title" style="margin-top:4px;">${parkLabel}</div>`;

  allRides[park].forEach(landGroup => {
    html += `<div class="rides-land-header">${landGroup.land}</div>`;
    let rides = [...landGroup.rides];
    if (ridesSortMode === 'wait') {
      rides.sort((a, b) => {
        const aOpen = a.is_open ? 0 : 1;
        const bOpen = b.is_open ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return (a.wait_time || 0) - (b.wait_time || 0);
      });
    } else if (ridesSortMode === 'score') {
      rides.sort((a, b) => (getRideScore(b.name) || 0) - (getRideScore(a.name) || 0));
    } else {
      rides.sort((a, b) => {
        const scoreDiff = (getRideScore(b.name) || 0) - (getRideScore(a.name) || 0);
        if (scoreDiff !== 0) return scoreDiff;
        const aOpen = a.is_open ? 0 : 1;
        const bOpen = b.is_open ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return (a.wait_time || 0) - (b.wait_time || 0);
      });
    }
    rides.forEach(r => {
      if (ridesFilter === 'rides' && isNonRide(r.name)) return;
      if (ridesFilter === 'shows' && !isNonRide(r.name)) return;
      html += renderRideRow(r, false);
    });
  });

  // Wishlist count (show on each tab, filtered to that park)
  const wlCount = Object.entries(rideWishlist).filter(([k]) => k.startsWith(park + '-')).length;
  if (wlCount > 0) {
    html += `<div class="rides-wishlist-count">${wlCount} ride${wlCount!==1?'s':''} wishlisted — included in export</div>`;
  }

  html += '<div class="attribution">Wait times powered by <a href="https://queue-times.com" target="_blank" rel="noopener">Queue-Times.com</a></div>';

  el.innerHTML = html;
}

function renderRideRow(ride, isMustDoSection) {
  const key = ride.park + '-' + ride.id;
  const inPlan = isPlanRide(ride.name);
  const wishlisted = !!rideWishlist[key] || inPlan;
  const mustDo = isMustDoRide(ride.name);
  const llData = findRideLL(ride);

  const done = isPlanRideDone(ride.name);
  let html = `<div class="ride-row${inPlan ? ' in-plan' : ''}${done ? ' ride-done' : ''}">`;

  // Checkbox
  html += `<button class="ride-check${wishlisted ? ' checked' : ''}" onclick="event.stopPropagation();toggleWishlist('${key}')">${wishlisted ? '✓' : ''}</button>`;

  // Name + badges
  html += '<div style="flex:1;min-width:0;">';
  const score = getRideScore(ride.name);
  const nonRide = isNonRide(ride.name);
  html += `<div class="ride-name">${ride.name}`;
  if (nonRide) html += ' <span class="ride-tag-show">Show</span>';
  if (mustDo && !isMustDoSection) html += ' <span class="ride-mustdo">★</span>';
  if (inPlan) html += ' <span class="ride-in-plan">In Plan</span>';
  if (score) html += ` <span class="ride-score ride-score-${score}">${'●'.repeat(score)}${'○'.repeat(5-score)}</span>`;
  html += '</div>';

  // LL window on second line
  if (llData) {
    if (llData.soldOut) {
      html += '<div class="ride-ll ride-ll-none">LL: Sold out</div>';
    } else if (llData.time) {
      html += `<div class="ride-ll">LL: ${formatLLTime(llData.time)}</div>`;
    }
  }
  html += '</div>';

  // Wait time + SR
  html += '<div style="text-align:right;flex-shrink:0;">';
  if (ride.is_open) {
    html += `<div class="ride-wait"><span class="live-dot"></span>${ride.wait_time} min</div>`;
  } else {
    html += '<div class="ride-closed">CLOSED</div>';
  }
  if (ride.sr_wait != null) {
    html += `<div class="ride-sr">${ride.sr_open ? `SR ${ride.sr_wait}m` : 'SR closed'}</div>`;
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function findRideLL(ride) {
  // Try exact id match first
  const key = ride.park + '-' + ride.id;
  if (allRidesLL[key]) return allRidesLL[key];
  // No match
  return null;
}

function renderTipsInSettings() {
  const el = document.getElementById('tipsContent');
  if (!el) return;
  let html = '<div class="section-title" style="margin-top:0;">Contingencies</div>';
  planData.contingencies.forEach(c => {
    html += `<details><summary>${c.title}</summary><div class="tip-content">${c.body}</div></details>`;
  });
  html += '<div class="section-title" style="margin-top:16px;">Pro Tips</div>';
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
  renderRides();
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
  // Render tips content
  renderTipsInSettings();
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
  // Enable/disable LL slots export checkbox
  const llCheckbox = document.getElementById('exportLLSlots');
  const llCount = Object.keys(llSlots).length;
  if (llCheckbox) {
    if (llCount === 0) {
      llCheckbox.checked = false;
      llCheckbox.disabled = true;
      llCheckbox.parentElement.style.opacity = '0.4';
    } else {
      llCheckbox.disabled = false;
      llCheckbox.parentElement.style.opacity = '1';
    }
  }
  // Refresh LL slots status
  if (lastLLFetchTime) {
    updateLLSlotsStatus(llCount, null);
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
      'proTips[]': 'string',
      'llReturnWindows': '{ _note: string, fetchedAt: ISO string, rides: { [schedId]: { name: string, earliestWindow: string|null, soldOut: bool } } }',
      'wishlistRides': '{ rides: { [parkDashId]: { name, park, land, waitMinutes, isOpen, llWindow, llSoldOut } } }'
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

  // Include LL return windows if requested
  const includeLL = typeof document !== 'undefined' && document.getElementById('exportLLSlots')
    ? document.getElementById('exportLLSlots').checked : true;
  if (includeLL && Object.keys(llSlots).length > 0) {
    exportData.llReturnWindows = {
      _note: 'Earliest available LL return windows from Queue-Times.com',
      fetchedAt: lastLLFetchTime ? lastLLFetchTime.toISOString() : null,
      rides: {}
    };
    for (const id in llSlots) {
      const sl = llSlots[id];
      const item = planData.schedule.find(s => s.id === id);
      exportData.llReturnWindows.rides[id] = {
        name: item ? item.title : id,
        earliestWindow: sl.time ? formatLLTime(sl.time) : null,
        soldOut: sl.soldOut
      };
    }
  }

  // Include wishlisted rides
  if (Object.keys(rideWishlist).length > 0) {
    exportData.wishlistRides = {
      _note: 'Rides the user is interested in but not currently in the plan. Include wait and LL data so Claude can advise on whether/when to add them.',
      rides: {}
    };
    // Flatten allRides for lookup
    const rideIndex = {};
    ['dca','dl'].forEach(park => {
      if (!allRides[park]) return;
      allRides[park].forEach(landGroup => {
        landGroup.rides.forEach(r => {
          rideIndex[park + '-' + r.id] = { ...r, land: landGroup.land };
        });
      });
    });
    for (const key in rideWishlist) {
      const r = rideIndex[key];
      const ll = allRidesLL[key];
      exportData.wishlistRides.rides[key] = {
        name: r ? r.name : key,
        park: r ? r.park : key.split('-')[0],
        land: r ? r.land : null,
        waitMinutes: r ? r.wait_time : null,
        isOpen: r ? r.is_open : null,
        llWindow: ll && ll.time ? formatLLTime(ll.time) : null,
        llSoldOut: ll ? ll.soldOut : null
      };
    }
  }

  return JSON.stringify(exportData, null, 2);
}

function exportPlan() {
  const includeLive = document.getElementById('exportLiveWaits').checked;
  const json = buildFullExportJSON(includeLive);

  // Build prompt wrapper
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
  const rides = planData.schedule.filter(s => s.type === 'ride');
  const doneCount = rides.filter(r => completed[r.id]).length;

  let prompt = `[Disneyland Navigator \u2014 Plan Update]\n\n`;
  prompt += `\u{1F550} ${timeStr} \u00B7 ${doneCount}/${rides.length} rides done\n\n`;

  if (Object.keys(rideWishlist).length > 0) {
    prompt += `The wishlisted rides in the data are ones I want to do \u2014 work them into the plan if possible.\n\n`;
  }

  prompt += `Based on the current data (live wait times, LL return windows, completed rides, and wishlisted rides), give me the best updated plan for the rest of the day. Optimize for:\n`;
  prompt += `- Minimizing wait times by hitting low-wait rides first\n`;
  prompt += `- Using LL windows effectively\n`;
  prompt += `- Fitting in wishlisted rides where they make sense\n`;
  prompt += `- Keeping a good pace without burnout\n\n`;
  prompt += json;

  // Show in textarea as fallback
  const area = document.getElementById('exportArea');
  area.value = prompt;
  area.style.display = 'block';

  // Try clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(prompt).then(() => {
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
    fetchLLSlots();
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
    fetchLLSlots();
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
setInterval(() => { renderTimeline(); renderRides(); }, 60000);
// Refresh live wait times every 5 min
setInterval(fetchLiveWaits, 300000);
// Fetch LL return windows 2s after page load, then every 10 min
setTimeout(fetchLLSlots, 2000);
setInterval(fetchLLSlots, 600000);
