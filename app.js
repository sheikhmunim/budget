const COLORS      = ["#7F77DD","#1D9E75","#D4537E","#EF9F27","#378ADD","#D85A30","#5DCAA5","#888780","#E24B4A","#639922"];
const ICONS       = ["ti-users","ti-home","ti-heart","ti-star","ti-confetti","ti-users-group","ti-mood-smile","ti-briefcase"];
const CURRENCIES  = ['AUD', 'USD', 'BDT'];

// ── Supabase config ────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://cqivnqntpuhnraohrwfo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxaXZucW50cHVobnJhb2hyd2ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NjMxNDAsImV4cCI6MjA5NDEzOTE0MH0.iTO6dZhHtGZML2_vwoRxuTSm38aK2nfM8tQOsD01RdA';

// ── Utilities ──────────────────────────────────────────────────────────────

function uid()  { return Math.random().toString(36).slice(2, 9); }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function genShareCode() {
  const chars = 'abcdefhjkmnprstuvwxyz23456789';
  return Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function currencySymbol(trip) {
  switch (trip.currency || 'AUD') {
    case 'USD': return 'US$';
    case 'BDT': return '৳';
    default:    return 'A$';
  }
}

function fmt(n, trip) {
  const v = parseFloat(n) || 0;
  const s = v % 1 === 0 ? v.toFixed(0) : parseFloat(v.toFixed(2)).toString();
  return currencySymbol(trip || { currency: 'AUD' }) + s;
}

function personTotal(m)  { return (m.expenses || []).reduce((s, e) => s + (parseFloat(e.price) || 0), 0); }
function groupTotal(g)   { return g.members.reduce((sum, m) => sum + personTotal(m), 0); }
function tripSpent(trip) { return trip.groups.reduce((sum, g) => sum + groupTotal(g), 0); }

function getBudgetStatus(trip) {
  const spent = tripSpent(trip);
  const rem   = trip.budget - spent;
  const pct   = trip.budget > 0 ? Math.min(100, Math.round(spent / trip.budget * 100)) : 0;
  return {
    spent, rem, pct,
    barColor: pct >= 100 ? '#E24B4A' : pct >= 80 ? '#BA7517' : '#1D9E75',
    remClass: rem < 0 ? 'danger' : rem < trip.budget * 0.1 ? 'warn' : 'ok'
  };
}

// ── State ──────────────────────────────────────────────────────────────────

function hydrate(groups) {
  return groups.map(g => ({
    ...g,
    id: g.id || uid(),
    open: g.open || false,
    members: g.members.map(m => {
      let expenses = m.expenses ? m.expenses.map(e => ({ ...e, id: e.id || uid() })) : [];
      const legacyAmt = parseFloat(m.amt) || 0;
      if (expenses.length === 0 && legacyAmt > 0) {
        expenses = [{ id: uid(), item: '', price: legacyAmt }];
      }
      return { ...m, id: m.id || uid(), amt: 0, expenses };
    })
  }));
}

function newTrip(name) {
  return { id: uid(), name: name || 'New trip', budget: 400, currency: 'AUD', groups: [] };
}

function defaultTrip() {
  return newTrip('My trip');
}

function loadState() {
  try {
    const raw = localStorage.getItem('giftplanner_v2');
    if (raw) {
      const p = JSON.parse(raw);
      return { activeId: p.activeId, trips: p.trips.map(t => ({ ...t, groups: hydrate(t.groups || []) })), _ts: p._ts || 0 };
    }
  } catch (e) {}
  const t = defaultTrip();
  return { activeId: t.id, trips: [t], _ts: 0 };
}

function saveState() {
  state._ts = Date.now();
  try { localStorage.setItem('giftplanner_v2', JSON.stringify(state)); } catch (e) {}
  scheduleSync();
}

function saveLocal() {
  try { localStorage.setItem('giftplanner_v2', JSON.stringify(state)); } catch (_) {}
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

let state = loadState();
function activeTrip() { return state.trips.find(t => t.id === state.activeId) || state.trips[0]; }

// ── Supabase auth & sync ───────────────────────────────────────────────────

const sbReady = SUPABASE_URL !== 'YOUR_SUPABASE_URL';
let sb = null;
let currentUser = null;
if (sbReady) {
  try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); }
  catch (e) { console.error('Supabase client failed to init:', e); }
}

// Debounced sync — fires 1.5 s after last change, or immediately when app is hidden
let _syncTimer = null;
let _syncInFlight = false;
let _hiddenAt = 0;

function scheduleSync() {
  if (!sbReady || !currentUser) return;
  clearTimeout(_syncTimer);
  // If the page is already hidden (e.g. user switched apps mid-edit), push immediately
  if (document.visibilityState === 'hidden') { doSync(); return; }
  _syncTimer = setTimeout(doSync, 1500);
}

// doSync(pullFirst=false): push-only from debounce; pull-then-push from load/refresh.
// Keeping these two paths separate prevents a debounce push from overwriting
// in-progress edits with a just-fetched remote state.
async function doSync(pullFirst = false) {
  if (!currentUser || _syncInFlight) return;
  _syncInFlight = true;
  updateSyncBtn('syncing');
  let success = false;
  try {
    if (pullFirst) {
      // ── Pull main user state ─────────────────────────────────────────────
      const { data, error: pullErr } = await withTimeout(
        sb.from('user_state').select('state_json, updated_at').eq('user_id', currentUser.id).single(),
        8000
      );
      // PGRST116 = no row yet (first ever sync) — not an error
      if (pullErr && pullErr.code !== 'PGRST116') throw pullErr;
      if (data) {
        const remoteTs = new Date(data.updated_at).getTime();
        if (remoteTs > (state._ts || 0)) {
          const p = data.state_json;
          state = { activeId: p.activeId, trips: p.trips.map(t => ({ ...t, groups: hydrate(t.groups || []) })), _ts: remoteTs };
          saveLocal();
          fullRender();
        }
      }

      // ── Pull shared trips ────────────────────────────────────────────────
      let sharedUpdated = false;
      for (const trip of [...state.trips].filter(t => t.shareCode)) {
        const updated = await pullSharedTrip(trip);
        if (updated) {
          const idx = state.trips.findIndex(t => t.id === trip.id);
          if (idx !== -1) { state.trips[idx] = { ...updated, groups: hydrate(updated.groups || []) }; sharedUpdated = true; }
        }
      }
      if (sharedUpdated) { saveLocal(); fullRender(); }
    }

    // ── Push main state ──────────────────────────────────────────────────
    const ts = new Date().toISOString();
    const { error: pushErr } = await withTimeout(
      sb.from('user_state').upsert({ user_id: currentUser.id, state_json: state, updated_at: ts }, { onConflict: 'user_id' }),
      8000
    );
    if (pushErr) throw pushErr;
    state._ts = new Date(ts).getTime();
    saveLocal();

    // ── Push shared trips ────────────────────────────────────────────────
    await Promise.all(state.trips.filter(t => t.shareCode).map(pushSharedTrip));

    success = true;
  } catch (e) {
    console.error('Sync failed:', e.message);
  } finally {
    _syncInFlight = false;
    updateSyncBtn(success ? 'synced' : 'error');
  }
}

async function pushSharedTrip(trip) {
  if (!currentUser || !trip.shareCode || !sb) return;
  try {
    const ts = new Date().toISOString();
    const { error } = await withTimeout(
      sb.from('shared_trips').upsert({ code: trip.shareCode, state_json: trip, updated_at: ts }, { onConflict: 'code' }),
      8000
    );
    if (error) console.error('Shared trip push error:', error.message);
  } catch (e) { console.error('Shared trip push failed:', e.message); }
}

async function pullSharedTrip(trip) {
  if (!trip.shareCode || !sb) return null;
  try {
    const { data, error } = await withTimeout(
      sb.from('shared_trips').select('state_json, updated_at').eq('code', trip.shareCode).single(),
      8000
    );
    if (error) { console.error('Pull shared trip error:', error.message); return null; }
    if (!data) return null;
    const remoteTs = new Date(data.updated_at).getTime();
    if (remoteTs > (trip._ts || 0)) {
      return { ...data.state_json, shareCode: trip.shareCode, _ts: remoteTs };
    }
    return null;
  } catch (e) { console.error('Pull shared trip failed:', e.message); return null; }
}

function updateSyncBtn(s) {
  const btn = document.getElementById('syncBtn');
  if (!btn) return;
  const icon = { synced: 'ti-cloud-check', syncing: 'ti-cloud-upload', offline: 'ti-cloud-off', error: 'ti-cloud-x' }[s] || 'ti-cloud-off';
  btn.dataset.state = s;
  btn.innerHTML = `<i class="ti ${icon}"></i>`;
}

function showSyncPopover() {
  const old = document.getElementById('sync-popover');
  if (old) { old.remove(); return; }

  const btn     = document.getElementById('syncBtn');
  const popover = document.createElement('div');
  popover.id    = 'sync-popover';
  popover.innerHTML = `
    <div class="sp-email">${esc(currentUser?.email ?? '')}</div>
    <button class="sp-signout">Sign out</button>`;
  document.body.appendChild(popover);

  const rect = btn.getBoundingClientRect();
  popover.style.top   = (rect.bottom + 8) + 'px';
  popover.style.right = (window.innerWidth - rect.right) + 'px';

  popover.querySelector('.sp-signout').addEventListener('click', async () => {
    popover.remove();
    await sb.auth.signOut();
  });

  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!popover.contains(e.target) && e.target !== btn) {
        popover.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 0);
}

function showAuthOverlay() {
  if (document.getElementById('auth-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-card">
      <div class="auth-top-icon"><i class="ti ti-cloud"></i></div>
      <h2>Sync across devices</h2>
      <p>Sign in to keep your budget in sync on every device.</p>
      <input id="auth-email"    type="email"    placeholder="your@email.com" autocomplete="email"     inputmode="email"    />
      <input id="auth-password" type="password" placeholder="Password"       autocomplete="current-password" />
      <div id="auth-error" class="auth-error"></div>
      <button id="auth-signin-btn">Sign in</button>
      <button id="auth-signup-btn" class="auth-secondary">Create account</button>
      <button class="auth-skip" id="auth-skip-btn">Not now</button>
    </div>`;
  document.body.appendChild(overlay);

  const emailEl = overlay.querySelector('#auth-email');
  const passEl  = overlay.querySelector('#auth-password');
  const errEl   = overlay.querySelector('#auth-error');
  const signIn  = overlay.querySelector('#auth-signin-btn');
  const signUp  = overlay.querySelector('#auth-signup-btn');

  function showErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
  function clearErr()   { errEl.textContent = ''; errEl.style.display = 'none'; }
  function setLoading(btn, loading, label) { btn.disabled = loading; btn.textContent = loading ? '…' : label; }

  passEl.addEventListener('keydown', e => { if (e.key === 'Enter') signIn.click(); });

  signIn.addEventListener('click', async () => {
    clearErr();
    const email = emailEl.value.trim();
    const pass  = passEl.value;
    if (!email || !pass) { showErr('Please enter your email and password.'); return; }
    setLoading(signIn, true, 'Sign in');
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) showErr(error.message);
    } catch (e) {
      showErr('Sign in failed. Please try again.');
    } finally {
      setLoading(signIn, false, 'Sign in');
    }
  });

  signUp.addEventListener('click', async () => {
    clearErr();
    const email = emailEl.value.trim();
    const pass  = passEl.value;
    if (!email || !pass) { showErr('Please enter your email and password.'); return; }
    if (pass.length < 6)  { showErr('Password must be at least 6 characters.'); return; }
    setLoading(signUp, true, 'Create account');
    try {
      const { error } = await sb.auth.signUp({ email, password: pass });
      if (error) showErr(error.message);
    } catch (e) {
      showErr('Sign up failed. Please try again.');
    } finally {
      setLoading(signUp, false, 'Create account');
    }
  });

  overlay.querySelector('#auth-skip-btn').addEventListener('click', () => overlay.remove());
}

// ── Share modal ────────────────────────────────────────────────────────────

function showShareModal(trip) {
  document.getElementById('share-modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'share-modal-overlay';

  const isShared = !!trip.shareCode;
  const isOwner  = !trip.shareOwnerId || trip.shareOwnerId === currentUser?.id;

  overlay.innerHTML = `
    <div class="share-modal-card">
      <div class="smc-header">
        <h2>${isShared ? 'Shared trip' : 'Share trip'}</h2>
        <button class="smc-close icon-btn"><i class="ti ti-x"></i></button>
      </div>
      ${isShared ? `
        <p class="smc-desc">Share this code — anyone who enters it can view and edit this trip.</p>
        <div class="smc-code-wrap">
          <span class="smc-code">${esc(trip.shareCode)}</span>
          <button class="smc-copy icon-btn" title="Copy code"><i class="ti ti-copy"></i></button>
        </div>
        <button class="smc-leave">${isOwner ? 'Stop sharing' : 'Leave shared trip'}</button>
      ` : `
        <p class="smc-desc">Generate a code to share this trip. Anyone with the code can view and edit it.</p>
        <button class="smc-generate">Generate share code</button>
      `}
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('.smc-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  if (isShared) {
    overlay.querySelector('.smc-copy').addEventListener('click', async e => {
      await navigator.clipboard.writeText(trip.shareCode).catch(() => {});
      const btn = e.currentTarget;
      btn.innerHTML = '<i class="ti ti-check"></i>';
      setTimeout(() => { btn.innerHTML = '<i class="ti ti-copy"></i>'; }, 1500);
    });

    overlay.querySelector('.smc-leave').addEventListener('click', async () => {
      const msg = isOwner
        ? 'Stop sharing? Others with the code will lose access.'
        : 'Leave this shared trip? Your local copy will be removed.';
      if (!confirm(msg)) return;

      if (isOwner && currentUser) {
        sb.from('shared_trips').delete().eq('code', trip.shareCode).catch(() => {});
      }

      const idx = state.trips.findIndex(t => t.id === trip.id);
      if (idx !== -1) state.trips.splice(idx, 1);
      if (!state.trips.length) { const t = defaultTrip(); state.trips.push(t); }
      if (!state.trips.find(t => t.id === state.activeId)) {
        state.activeId = state.trips[0].id;
      }
      saveState();
      overlay.remove();
      fullRender();
    });
  } else {
    overlay.querySelector('.smc-generate').addEventListener('click', async () => {
      const btn = overlay.querySelector('.smc-generate');
      btn.disabled = true;
      btn.textContent = 'Generating…';
      const code = genShareCode();
      trip.shareCode    = code;
      trip.shareOwnerId = currentUser?.id || '';
      if (currentUser) await pushSharedTrip(trip);
      saveState();
      overlay.remove();
      showShareModal(trip);
      renderTabs();
    });
  }
}

// ── Join modal ─────────────────────────────────────────────────────────────

function showJoinModal() {
  document.getElementById('join-modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'join-modal-overlay';
  overlay.innerHTML = `
    <div class="share-modal-card">
      <div class="smc-header">
        <h2>Join shared trip</h2>
        <button class="smc-close icon-btn"><i class="ti ti-x"></i></button>
      </div>
      <p class="smc-desc">Enter the 6-character code to add a shared trip to your app.</p>
      <input class="smc-code-input" placeholder="abc123" maxlength="8"
             autocomplete="off" autocapitalize="none" spellcheck="false" />
      <div class="smc-error" style="display:none"></div>
      <button class="smc-join">Join trip</button>
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('.smc-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const input   = overlay.querySelector('.smc-code-input');
  const errEl   = overlay.querySelector('.smc-error');
  const joinBtn = overlay.querySelector('.smc-join');

  input.focus();
  input.addEventListener('input', e => { e.target.value = e.target.value.toLowerCase(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });

  joinBtn.addEventListener('click', async () => {
    const code = input.value.trim().toLowerCase();
    if (!code) { errEl.textContent = 'Please enter a code.'; errEl.style.display = 'block'; return; }

    if (state.trips.some(t => t.shareCode === code)) {
      errEl.textContent = 'You already have this trip.'; errEl.style.display = 'block'; return;
    }

    joinBtn.disabled = true;
    joinBtn.textContent = 'Joining…';
    errEl.style.display = 'none';

    try {
      const { data, error } = await sb.from('shared_trips')
        .select('state_json, updated_at')
        .eq('code', code)
        .single();

      if (error || !data) {
        errEl.textContent = 'Trip not found. Check the code and try again.';
        errEl.style.display = 'block';
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join trip';
        return;
      }

      const remoteTs = new Date(data.updated_at).getTime();
      const joined   = {
        ...data.state_json,
        groups:   hydrate(data.state_json.groups || []),
        shareCode: code,
        _ts:      remoteTs
      };
      state.trips.push(joined);
      state.activeId = joined.id;
      saveState();
      overlay.remove();
      fullRender();
    } catch (e) {
      errEl.textContent = 'Something went wrong. Try again.';
      errEl.style.display = 'block';
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join trip';
    }
  });
}

// ── Auth init ──────────────────────────────────────────────────────────────

async function initAuth() {
  fullRender();

  // Flush pending sync when app goes to background; pull-first when returning after 30+ seconds
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && currentUser) {
      _hiddenAt = Date.now();
      if (_syncTimer !== null) { clearTimeout(_syncTimer); _syncTimer = null; doSync(); }
    } else if (document.visibilityState === 'visible' && currentUser && (Date.now() - _hiddenAt) > 30000) {
      doSync(true);
    }
  });

  document.getElementById('syncBtn').addEventListener('click', () => {
    if (!sbReady) return;
    if (currentUser) showSyncPopover();
    else { sessionStorage.removeItem('auth_skipped'); showAuthOverlay(); }
  });

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    if (!currentUser) return;
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    clearTimeout(_syncTimer);
    _syncTimer = null;
    await doSync(true);
    btn.disabled = false;
    fullRender();
  });

  if (!sbReady || !sb) { showAuthOverlay(); return; }

  try {
    const { data: { session } } = await sb.auth.getSession();

    if (session) {
      currentUser = session.user;
      document.getElementById('refreshBtn').style.display = '';
      await doSync(true);
      fullRender();
    } else {
      updateSyncBtn('offline');
      showAuthOverlay();
    }

    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        currentUser = session.user;
        document.getElementById('auth-overlay')?.remove();
        document.getElementById('refreshBtn').style.display = '';
        await doSync(true);
        fullRender();
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        updateSyncBtn('offline');
        document.getElementById('refreshBtn').style.display = 'none';
      }
    });

  } catch (err) {
    console.error('Supabase init error:', err);
    updateSyncBtn('offline');
    showAuthOverlay();
  }
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function renderTabs() {
  const wrap = document.getElementById('tabsWrap');
  wrap.innerHTML = '';

  state.trips.forEach(t => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (t.id === state.activeId ? ' active' : '') + (t.shareCode ? ' shared' : '');
    tab.dataset.id = t.id;

    if (t.shareCode) {
      const si = document.createElement('i');
      si.className = 'ti ti-share-3 tab-shared-icon';
      tab.appendChild(si);
    }

    const nameInput = document.createElement('input');
    nameInput.className = 'tab-name-input';
    nameInput.value = t.name;
    nameInput.setAttribute('aria-label', 'Trip name');
    nameInput.style.width = Math.max(50, t.name.length * 8) + 'px';
    nameInput.addEventListener('input', e => {
      t.name = e.target.value;
      e.target.style.width = Math.max(50, e.target.value.length * 8) + 'px';
      saveState();
    });

    tab.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      if (t.id === state.activeId) return;
      state.activeId = t.id;
      saveState();
      fullRender();
    });

    tab.appendChild(nameInput);

    if (state.trips.length > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.title = 'Delete trip';
      closeBtn.setAttribute('aria-label', 'Delete trip');
      closeBtn.innerHTML = '<i class="ti ti-x"></i>';
      closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('Delete trip "' + t.name + '"?')) return;
        const idx = state.trips.indexOf(t);
        state.trips.splice(idx, 1);
        state.activeId = (state.trips[Math.max(0, idx - 1)] || state.trips[0]).id;
        saveState();
        fullRender();
      });
      tab.appendChild(closeBtn);
    }

    wrap.appendChild(tab);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'add-tab-btn';
  addBtn.innerHTML = '<i class="ti ti-plus" style="font-size:13px"></i> New trip';
  addBtn.addEventListener('click', () => {
    const t = newTrip('New trip');
    state.trips.push(t);
    state.activeId = t.id;
    saveState();
    fullRender();
    const inputs = document.querySelectorAll('.tab-name-input');
    if (inputs.length) inputs[inputs.length - 1].select();
  });
  wrap.appendChild(addBtn);

  const joinBtn = document.createElement('button');
  joinBtn.className = 'join-tab-btn';
  joinBtn.title = 'Join a shared trip by code';
  joinBtn.innerHTML = '<i class="ti ti-link" style="font-size:13px"></i> Join';
  joinBtn.addEventListener('click', () => {
    if (!currentUser) { showAuthOverlay(); return; }
    showJoinModal();
  });
  wrap.appendChild(joinBtn);
}

// ── Trip content ───────────────────────────────────────────────────────────

function renderTripContent() {
  const trip    = activeTrip();
  const content = document.getElementById('tripContent');
  content.innerHTML = '';

  content.appendChild(buildBudgetCard(trip));
  trip.groups.forEach(g => content.appendChild(buildGroupCard(trip, g)));

  const addGroupBtn = document.createElement('button');
  addGroupBtn.className = 'add-group-btn';
  addGroupBtn.innerHTML = '<i class="ti ti-plus"></i> Add group';
  addGroupBtn.addEventListener('click', () => {
    const color = COLORS[trip.groups.length % COLORS.length];
    const icon  = ICONS[trip.groups.length % ICONS.length];
    trip.groups.push({ id: uid(), name: 'New group', icon, color, open: true, members: [{ id: uid(), name: '', hint: '', amt: 0, expenses: [] }] });
    saveState();
    renderTripContent();
    const inputs = document.querySelectorAll('.group-name-input');
    if (inputs.length) inputs[inputs.length - 1].select();
  });
  content.appendChild(addGroupBtn);
}

// ── Budget card ────────────────────────────────────────────────────────────

function buildBudgetCard(trip) {
  const { spent, rem, pct, barColor, remClass } = getBudgetStatus(trip);

  const card = document.createElement('div');
  card.className = 'budget-card';
  card.innerHTML = `
    <div class="budget-top">
      <div class="budget-left">
        <label>Total budget</label>
        <input class="budget-input" type="number" min="0" step="any" value="${esc(trip.budget)}" aria-label="Budget" />
        <button class="currency-toggle" title="Click to change currency">${esc(trip.currency || 'AUD')}</button>
      </div>
      <div class="budget-stats">
        <div class="stat">
          <div class="stat-label">Spent</div>
          <div class="stat-val" id="spentVal">${fmt(spent, trip)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Remaining</div>
          <div class="stat-val ${remClass}" id="remVal">${fmt(rem, trip)}</div>
        </div>
      </div>
    </div>
    <div class="bar-outer">
      <div class="bar-inner" id="budgetBar" style="width:${pct}%;background:${barColor}"></div>
    </div>
    <div class="budget-footer">
      <button class="share-btn${trip.shareCode ? ' active' : ''}">
        <i class="ti ${trip.shareCode ? 'ti-share-3' : 'ti-share'}"></i>
        ${trip.shareCode ? 'Shared' : 'Share'}
      </button>
      <button class="pdf-btn"><i class="ti ti-download"></i> Download PDF</button>
    </div>`;

  card.querySelector('.budget-input').addEventListener('focus', e => e.target.select());
  card.querySelector('.budget-input').addEventListener('input', e => {
    trip.budget = parseFloat(e.target.value) || 0;
    updateBudgetDisplay(trip);
    saveState();
  });

  card.querySelector('.currency-toggle').addEventListener('click', () => {
    const idx = CURRENCIES.indexOf(trip.currency || 'AUD');
    trip.currency = CURRENCIES[(idx + 1) % CURRENCIES.length];
    saveState();
    renderTripContent();
  });

  card.querySelector('.share-btn').addEventListener('click', () => {
    if (!currentUser) { showAuthOverlay(); return; }
    showShareModal(trip);
  });

  card.querySelector('.pdf-btn').addEventListener('click', () => downloadTripPDF(trip));

  return card;
}

function generatePrintContent(trip) {
  const sym = currencySymbol(trip);
  const { spent, rem, pct, barColor } = getBudgetStatus(trip);
  const fmtA = n => { const v = parseFloat(n) || 0; return sym + (v % 1 === 0 ? v.toFixed(0) : parseFloat(v.toFixed(2)).toString()); };
  const remClass = rem < 0 ? 'danger' : rem < trip.budget * 0.1 ? 'warn' : 'ok';

  const groupsHTML = trip.groups.map(g => {
    const membersHTML = g.members.map(m => {
      const expHTML = (m.expenses || []).map(e => `
        <div class="pf-ei">
          <span class="pf-ei-name">${esc(e.item) || '—'}</span>
          <span class="pf-ei-price">${fmtA(e.price)}</span>
        </div>`).join('');
      return `
        <div class="pf-member">
          <div class="pf-mrow">
            <span class="pf-mname">${esc(m.name) || '—'}</span>
            <span class="pf-mhint">${esc(m.hint)}</span>
            <span class="pf-mamt">${fmtA(personTotal(m))}</span>
          </div>${expHTML}
        </div>`;
    }).join('');
    return `
      <div class="pf-group">
        <div class="pf-ghdr">
          <span class="pf-gdot" style="background:${g.color}"></span>
          <span class="pf-gname">${esc(g.name)}</span>
          <span class="pf-gtotal">${fmtA(groupTotal(g))}</span>
        </div>
        <div>${membersHTML || '<div class="pf-empty">No members</div>'}</div>
      </div>`;
  }).join('');

  return `
    <h1>${esc(trip.name)}</h1>
    <div class="pf-sub">Budget plan &middot; ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    <div class="pf-summary">
      <div><div class="pf-slabel">Budget</div><div class="pf-sval">${fmtA(trip.budget)}</div></div>
      <div><div class="pf-slabel">Spent</div><div class="pf-sval">${fmtA(spent)}</div></div>
      <div><div class="pf-slabel">Remaining</div><div class="pf-sval ${remClass}">${fmtA(rem)}</div></div>
    </div>
    <div class="pf-bar"><div class="pf-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
    ${groupsHTML}`;
}

function downloadTripPDF(trip) {
  const old = document.getElementById('print-frame');
  if (old) old.remove();

  const frame = document.createElement('div');
  frame.id = 'print-frame';
  frame.innerHTML = generatePrintContent(trip);
  document.body.appendChild(frame);

  const cleanup = () => { frame.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

function updateBudgetDisplay(trip) {
  const { spent, rem, pct, barColor, remClass } = getBudgetStatus(trip);

  const sv = document.getElementById('spentVal');
  const rv = document.getElementById('remVal');
  const br = document.getElementById('budgetBar');
  if (sv) sv.textContent = fmt(spent, trip);
  if (rv) { rv.textContent = fmt(rem, trip); rv.className = 'stat-val ' + remClass; }
  if (br) { br.style.width = pct + '%'; br.style.background = barColor; }

  trip.groups.forEach(g => {
    const totEl = document.getElementById('gt_' + g.id);
    if (totEl) totEl.textContent = fmt(groupTotal(g), trip);
    g.members.forEach(m => {
      const ptotEl = document.getElementById('ptotal_' + m.id);
      if (ptotEl) ptotEl.textContent = fmt(personTotal(m), trip);
    });
  });
}

// ── Group card ─────────────────────────────────────────────────────────────

function buildGroupCard(trip, g) {
  const card = document.createElement('div');
  card.className = 'group-card';
  card.id = 'gc_' + g.id;

  const hdr  = document.createElement('div');
  hdr.className = 'group-header';

  const left = document.createElement('div');
  left.className = 'group-left';

  const iconEl = document.createElement('i');
  iconEl.className = `ti ${g.icon} group-icon`;
  iconEl.style.color = g.color;
  iconEl.title = 'Change colour';

  const nameInput = document.createElement('input');
  nameInput.className = 'group-name-input';
  nameInput.value = g.name;
  nameInput.placeholder = 'Group name';
  nameInput.setAttribute('aria-label', 'Group name');

  const countEl = document.createElement('span');
  countEl.className = 'group-count';
  countEl.id = 'gcnt_' + g.id;
  countEl.textContent = g.members.length;

  left.append(iconEl, nameInput, countEl);

  const right = document.createElement('div');
  right.className = 'group-right';

  const totalEl = document.createElement('span');
  totalEl.className = 'group-total';
  totalEl.id = 'gt_' + g.id;
  totalEl.textContent = fmt(groupTotal(g), trip);

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn del';
  delBtn.title = 'Delete group';
  delBtn.setAttribute('aria-label', 'Delete group');
  delBtn.innerHTML = '<i class="ti ti-trash"></i>';

  const chevron = document.createElement('i');
  chevron.className = 'ti ti-chevron-down chevron' + (g.open ? ' open' : '');
  chevron.id = 'gchev_' + g.id;

  right.append(totalEl, delBtn, chevron);
  hdr.append(left, right);

  const colorRow = document.createElement('div');
  colorRow.className = 'color-row';
  COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'cdot' + (g.color === c ? ' sel' : '');
    dot.style.background = c;
    dot.addEventListener('click', () => { g.color = c; saveState(); renderTripContent(); });
    colorRow.appendChild(dot);
  });

  const body = document.createElement('div');
  body.className = 'group-body';
  body.id = 'gbody_' + g.id;
  if (!g.open) body.style.display = 'none';

  g.members.forEach(m => body.appendChild(buildPersonRow(trip, g, m)));

  const addPersonBtn = document.createElement('button');
  addPersonBtn.className = 'add-person-btn';
  addPersonBtn.innerHTML = '<i class="ti ti-plus" style="font-size:13px"></i> Add person';
  addPersonBtn.addEventListener('click', e => {
    e.stopPropagation();
    g.members.push({ id: uid(), name: '', hint: '', amt: 0, expenses: [] });
    g.open = true;
    saveState();
    renderTripContent();
    const rows = document.querySelectorAll('#gbody_' + g.id + ' .person-name');
    if (rows.length) rows[rows.length - 1].focus();
  });
  body.appendChild(addPersonBtn);

  nameInput.addEventListener('input', e => { g.name = e.target.value; saveState(); });
  iconEl.addEventListener('click', e => { e.stopPropagation(); colorRow.classList.toggle('visible'); });
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (g.members.length === 0 || confirm('Delete group "' + g.name + '"?')) {
      trip.groups.splice(trip.groups.indexOf(g), 1);
      saveState();
      renderTripContent();
    }
  });
  hdr.addEventListener('click', e => {
    if (e.target.closest('input, button') || e.target === iconEl) return;
    g.open = !g.open;
    body.style.display = g.open ? '' : 'none';
    chevron.classList.toggle('open', g.open);
    saveState();
  });

  card.append(hdr, colorRow, body);
  return card;
}

// ── Person row ─────────────────────────────────────────────────────────────

function buildExpenseRow(trip, m, e) {
  const row = document.createElement('div');
  row.className = 'expense-row';
  row.innerHTML = `
    <input class="expense-item-input" value="${esc(e.item)}" placeholder="Item" aria-label="Expense item" />
    <div class="expense-price-wrap">
      <input type="number" class="expense-price-input" min="0" step="any" value="${e.price || 0}" aria-label="Price" />
      <span class="amt-label">${esc(trip.currency || 'AUD')}</span>
      <button class="icon-btn del" title="Remove expense" aria-label="Remove expense">
        <i class="ti ti-x" style="font-size:13px"></i>
      </button>
    </div>`;

  row.querySelector('.expense-item-input').addEventListener('input', ev => { e.item = ev.target.value; saveState(); });
  row.querySelector('.expense-price-input').addEventListener('focus', ev => ev.target.select());
  row.querySelector('.expense-price-input').addEventListener('input', ev => {
    e.price = parseFloat(ev.target.value) || 0;
    const ptotEl = document.getElementById('ptotal_' + m.id);
    if (ptotEl) ptotEl.textContent = fmt(personTotal(m), trip);
    updateBudgetDisplay(trip);
    saveState();
  });
  row.querySelector('.icon-btn.del').addEventListener('click', () => {
    m.expenses.splice(m.expenses.indexOf(e), 1);
    saveState();
    renderTripContent();
  });
  return row;
}

function buildPersonRow(trip, g, m) {
  const block = document.createElement('div');
  block.className = 'person-block';

  const row = document.createElement('div');
  row.className = 'person-row';
  row.innerHTML = `
    <input class="person-name" value="${esc(m.name)}" placeholder="Name" aria-label="Name" />
    <input class="person-hint" value="${esc(m.hint)}" placeholder="What to buy..." aria-label="Gift idea" />
    <div class="person-amt-wrap">
      <span class="person-total-val" id="ptotal_${m.id}">${fmt(personTotal(m), trip)}</span>
      <button class="add-expense-btn icon-btn" title="Add expense" aria-label="Add expense">
        <i class="ti ti-plus" style="font-size:12px"></i>
      </button>
      <button class="icon-btn del" title="Remove person" aria-label="Remove person">
        <i class="ti ti-x" style="font-size:13px"></i>
      </button>
    </div>`;

  row.querySelector('.person-name').addEventListener('input', e => { m.name = e.target.value; saveState(); });
  row.querySelector('.person-hint').addEventListener('input', e => { m.hint = e.target.value; saveState(); });
  row.querySelector('.add-expense-btn').addEventListener('click', ev => {
    ev.stopPropagation();
    if (!m.expenses) m.expenses = [];
    const newExp = { id: uid(), item: '', price: 0 };
    m.expenses.push(newExp);
    saveState();
    const expRow = buildExpenseRow(trip, m, newExp);
    block.appendChild(expRow);
    expRow.querySelector('.expense-item-input').focus();
  });
  row.querySelector('.icon-btn.del').addEventListener('click', () => {
    g.members.splice(g.members.indexOf(m), 1);
    saveState();
    renderTripContent();
  });

  block.appendChild(row);
  (m.expenses || []).forEach(e => block.appendChild(buildExpenseRow(trip, m, e)));

  return block;
}

// ── Init ───────────────────────────────────────────────────────────────────

function fullRender() { renderTabs(); renderTripContent(); }
initAuth();
