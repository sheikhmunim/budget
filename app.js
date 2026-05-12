const COLORS      = ["#7F77DD","#1D9E75","#D4537E","#EF9F27","#378ADD","#D85A30","#5DCAA5","#888780","#E24B4A","#639922"];
const ICONS       = ["ti-users","ti-home","ti-heart","ti-star","ti-confetti","ti-users-group","ti-mood-smile","ti-briefcase"];
const CURRENCIES  = ['AUD', 'USD', 'BDT'];

// ── Utilities ──────────────────────────────────────────────────────────────

function uid()  { return Math.random().toString(36).slice(2, 9); }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function currencySymbol(trip) {
  switch (trip.currency || 'AUD') {
    case 'USD': return 'US$';
    case 'BDT': return '৳';
    default:    return 'A$';
  }
}

function fmt(n, trip) {
  return currencySymbol(trip || { currency: 'AUD' }) + (parseFloat(n) || 0).toFixed(0);
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
  const t = newTrip('Bangladesh 2026');
  t.budget = 400;
  t.groups = hydrate([
    { name: "Parents & in-laws", icon: "ti-home", color: "#5DCAA5", open: true, members: [
      { name: "Ammu",  hint: "Saree / gold-plated jewellery", amt: 0 },
      { name: "Abbu",  hint: "Punjabi / wallet",              amt: 0 },
      { name: "Aunty", hint: "Saree / cosmetics",             amt: 0 },
      { name: "Uncle", hint: "Punjabi / attar perfume",       amt: 0 },
    ]},
    { name: "Brothers", icon: "ti-users", color: "#7F77DD", open: false, members: [
      { name: "Purbo",        hint: "Car LEGO set",         amt: 0 },
      { name: "Dulabhai",     hint: "Attar / keychain",     amt: 0 },
      { name: "Shohag Bhai",  hint: "Attar / wallet",       amt: 0 },
      { name: "Showmik",      hint: "Chocolates / keychain", amt: 0 },
      { name: "Sian",         hint: "Chocolates",           amt: 0 },
      { name: "Sakib",        hint: "Chocolates",           amt: 0 },
      { name: "Akik",         hint: "Chocolates",           amt: 0 },
      { name: "Kafsat",       hint: "Chocolates",           amt: 0 },
      { name: "Shuvo Bhai (1)", hint: "Attar / keychain",   amt: 0 },
      { name: "Shuvo Bhai (2)", hint: "Attar / keychain",   amt: 0 },
      { name: "Mahfuj",       hint: "Chocolates",           amt: 0 },
      { name: "Mon",          hint: "Chocolates",           amt: 0 },
      { name: "Nafiz",        hint: "Chocolates",           amt: 0 },
    ]},
    { name: "Sisters", icon: "ti-heart", color: "#D4537E", open: false, members: [
      { name: "Diya",         hint: "Lipstick / skincare", amt: 0 },
      { name: "Shuchona",     hint: "Lipstick / skincare", amt: 0 },
      { name: "Duti Apu",     hint: "Lipstick / perfume",  amt: 0 },
      { name: "Sraborni Apu", hint: "Lipstick / perfume",  amt: 0 },
      { name: "Shikto",       hint: "Lipstick / skincare", amt: 0 },
      { name: "Dristy",       hint: "Lipstick / skincare", amt: 0 },
      { name: "Mou Apu",      hint: "Lipstick / perfume",  amt: 0 },
      { name: "Tithi",        hint: "Lipstick / skincare", amt: 0 },
      { name: "Maisha",       hint: "Lipstick / skincare", amt: 0 },
      { name: "Mitu",         hint: "Lipstick / skincare", amt: 0 },
      { name: "Shotota",      hint: "Lipstick / skincare", amt: 0 },
      { name: "Ekota",        hint: "Lipstick / skincare", amt: 0 },
      { name: "Vabi",         hint: "Lipstick / perfume",  amt: 0 },
    ]},
    { name: "Nephews", icon: "ti-star", color: "#EF9F27", open: false, members: [
      { name: "Shumormo", hint: "Toy / Lego mini / chocolate", amt: 0 },
      { name: "Kaif",     hint: "Toy / chocolate",             amt: 0 },
      { name: "Yusha",    hint: "Toy / chocolate",             amt: 0 },
      { name: "Ajlan",    hint: "Toy / chocolate",             amt: 0 },
    ]},
    { name: "Friends", icon: "ti-confetti", color: "#378ADD", open: false, members: [
      { name: "Joy",       hint: "Chocolates / keychain", amt: 0 },
      { name: "Istiack",   hint: "Chocolates / keychain", amt: 0 },
      { name: "Keya",      hint: "Lipstick + perfume",    amt: 0 },
      { name: "Sanjana",   hint: "Lipstick",              amt: 0 },
      { name: "Rafi",      hint: "Chocolates",            amt: 0 },
      { name: "Sajib",     hint: "Chocolates",            amt: 0 },
      { name: "Taj",       hint: "Chocolates",            amt: 0 },
      { name: "Al-Amin",   hint: "Chocolates",            amt: 0 },
      { name: "Al-Mahmud", hint: "Chocolates",            amt: 0 },
      { name: "Raju",      hint: "Chocolates",            amt: 0 },
    ]},
    { name: "Uncles & aunts", icon: "ti-users-group", color: "#888780", open: false, members: [
      { name: "Khalamoni", hint: "Saree / cosmetics", amt: 0 },
      { name: "Putul Kaki", hint: "Saree / cosmetics", amt: 0 },
    ]},
  ]);
  return t;
}

function loadState() {
  try {
    const raw = localStorage.getItem('giftplanner_v2');
    if (raw) {
      const p = JSON.parse(raw);
      return { activeId: p.activeId, trips: p.trips.map(t => ({ ...t, groups: hydrate(t.groups || []) })) };
    }
  } catch (e) {}
  const t = defaultTrip();
  return { activeId: t.id, trips: [t] };
}

function saveState() {
  try { localStorage.setItem('giftplanner_v2', JSON.stringify(state)); } catch (e) {}
}

let state = loadState();
function activeTrip() { return state.trips.find(t => t.id === state.activeId) || state.trips[0]; }

// ── Tabs ───────────────────────────────────────────────────────────────────

function renderTabs() {
  const wrap = document.getElementById('tabsWrap');
  wrap.innerHTML = '';

  state.trips.forEach(t => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (t.id === state.activeId ? ' active' : '');
    tab.dataset.id = t.id;

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
        <input class="budget-input" type="number" min="0" step="1" value="${esc(trip.budget)}" aria-label="Budget" />
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
    </div>`;

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

  return card;
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

  // Header
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

  // Color picker
  const colorRow = document.createElement('div');
  colorRow.className = 'color-row';
  COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'cdot' + (g.color === c ? ' sel' : '');
    dot.style.background = c;
    dot.addEventListener('click', () => { g.color = c; saveState(); renderTripContent(); });
    colorRow.appendChild(dot);
  });

  // Body (member list)
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

  // Wire events
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
      <input type="number" class="expense-price-input" min="0" step="1" value="${e.price || 0}" aria-label="Price" />
      <span class="amt-label">${esc(trip.currency || 'AUD')}</span>
      <button class="icon-btn del" title="Remove expense" aria-label="Remove expense">
        <i class="ti ti-x" style="font-size:13px"></i>
      </button>
    </div>`;

  row.querySelector('.expense-item-input').addEventListener('input', ev => { e.item = ev.target.value; saveState(); });
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
fullRender();
