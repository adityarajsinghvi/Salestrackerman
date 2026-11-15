/* Salesman Bonus Tracker — front end. Talks to Supabase; all access rules are enforced by RLS in the database. */
const C = window.APP_CONFIG;
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);
const $app = document.getElementById('app');

const S = {
  me: null, items: [], rate: 0, men: [],
  tab: 'entry', month: '', date: '', selMan: null, rows: [], histMan: '',
};

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthRange = m => {
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${pad(mo + 1)}-01`;
  return [`${m}-01`, next];
};
const money = n => '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN');
let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}
async function run(promise) { // unwrap a supabase result, throwing a readable error
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}
async function fetchAll(buildQuery) { // pages past Supabase's 1000-row default limit
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await run(buildQuery().range(from, from + 999));
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
const manName = id => (S.men.find(m => m.id === id) || {}).display_name || '(removed)';

/* ---------- auth ---------- */
function renderLogin(msg = '') {
  $app.innerHTML = `
  <div class="wrap login"><div class="card">
    <h1>🧵 Bonus Tracker</h1>
    <form id="loginForm" style="margin-top:16px">
      <label for="u">Username</label><input id="u" autocomplete="username" autocapitalize="none" required>
      <label for="p" style="margin-top:12px">Password</label><input id="p" type="password" autocomplete="current-password" required>
      <p class="err" id="loginErr">${esc(msg)}</p>
      <button class="btn" type="submit">Log in</button>
    </form>
  </div></div>`;
  document.getElementById('loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const u = document.getElementById('u').value.trim().toLowerCase();
    const { error } = await sb.auth.signInWithPassword({ email: `${u}@${C.EMAIL_DOMAIN}`, password: document.getElementById('p').value });
    if (error) { document.getElementById('loginErr').textContent = 'Wrong username or password'; btn.disabled = false; return; }
    start();
  };
}
async function logout() { await sb.auth.signOut(); S.me = null; renderLogin(); }

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  try {
    S.me = await run(sb.from('st_profiles').select('*').eq('id', session.user.id).maybeSingle());
    if (!S.me || !S.me.active) { await sb.auth.signOut(); return renderLogin('This account is not active. Ask the owner.'); }
    S.items = await run(sb.from('st_items').select('*').order('sort').order('id'));
    S.rate = Number((await run(sb.from('st_settings').select('rate_per_point').maybeSingle())).rate_per_point) || 0;
    S.month = todayStr().slice(0, 7); S.date = todayStr();
    if (S.me.role === 'owner') {
      S.men = await run(sb.from('st_profiles').select('*').eq('role', 'salesman').order('display_name'));
      S.tab = 'entry'; S.rows = await loadRows(); S.selMan = (S.men.find(m => m.active) || {}).id || null;
      renderOwner();
    } else renderSalesman();
  } catch (e) { renderLogin('Could not load: ' + e.message); }
}

/* ---------- shared pieces ---------- */
const header = (title) => `<div class="top"><h1>${title}</h1><div class="row" style="margin:0"><span class="mute">${esc(S.me.display_name)}</span><button class="btn ghost sm" data-act="logout">Log out</button></div></div>`;
const monthPicker = () => `<div class="card" style="padding:12px"><label for="monthSel">Month</label><input type="month" id="monthSel" value="${S.month}"></div>`;
const activeItems = () => S.items.filter(i => i.active);

/* ---------- salesman (read-only) ---------- */
async function renderSalesman() {
  $app.innerHTML = `<div class="wrap">${header('My points')}${monthPicker()}<div id="view"><p class="mute">Loading…</p></div></div>`;
  bindMonth(renderSalesman);
  const [from, to] = monthRange(S.month);
  try {
    const [sum, list] = await Promise.all([
      run(sb.rpc('st_month_summary', { month_start: from })),
      fetchAll(() => sb.from('st_sales').select('id,item_name,points,sold_on,created_at').gte('sold_on', from).lt('sold_on', to).order('sold_on', { ascending: false }).order('created_at', { ascending: false })),
    ]);
    const total = sum.reduce((a, r) => a + Number(r.pts), 0), qty = sum.reduce((a, r) => a + Number(r.qty), 0);
    const todays = list.filter(s => s.sold_on === todayStr());
    const days = {};
    list.forEach(s => { (days[s.sold_on] ||= []).push(s); });
    document.getElementById('view').innerHTML = `
      <div class="card"><div class="stats">
        <div class="stat"><span>Points this month</span><div class="big">${total}</div></div>
        <div class="stat"><span>Items sold</span><b>${qty}</b></div>
        <div class="stat"><span>Today</span><b>${todays.reduce((a, s) => a + s.points, 0)} pts</b></div>
        ${S.rate > 0 ? `<div class="stat"><span>Bonus</span><b>${money(total * S.rate)}</b></div>` : ''}
      </div></div>
      <div class="card"><h2>By item</h2>${sum.length ? `<table><tbody>${sum.sort((a, b) => b.pts - a.pts).map(r => `<tr><td>${esc(r.item_name)}</td><td class="n">${r.qty} sold</td><td class="n pts">${r.pts} pts</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No sales this month yet.</p>'}</div>
      <div class="card"><h2>My sales</h2>${list.length ? `<div class="scroll"><table><thead><tr><th>Date</th><th>Item</th><th class="n">Pts</th></tr></thead><tbody>${Object.keys(days).map(d => {
        const counts = {}; days[d].forEach(s => { counts[s.item_name] = (counts[s.item_name] || 0) + 1; });
        return Object.entries(counts).map(([n, c]) => `<tr><td>${d}</td><td>${esc(n)} × ${c}</td><td class="n pts">${days[d].filter(s => s.item_name === n).reduce((a, s) => a + s.points, 0)}</td></tr>`).join('');
      }).join('')}</tbody></table></div>` : '<p class="empty">Nothing yet.</p>'}</div>`;
  } catch (e) { document.getElementById('view').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

function bindMonth(rerender) {
  const el = document.getElementById('monthSel');
  if (el) el.onchange = () => { S.month = el.value || S.month; rerender(); };
}

/* ---------- owner ---------- */
function renderOwner() {
  const tabs = [['entry', 'Quick Entry'], ['board', 'Leaderboard'], ['history', 'History'], ['manage', 'Manage']];
  $app.innerHTML = `<div class="wrap">${header('🧵 Bonus Tracker')}
    <nav>${tabs.map(([k, n]) => `<button data-act="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${n}</button>`).join('')}</nav>
    <div id="view"></div></div>`;
  ({ entry: drawEntry, board: drawBoard, history: drawHistory, manage: drawManage })[S.tab]();
}

/* Quick entry: every tap on an item inserts one sale row. */
async function loadRows() {
  const data = await fetchAll(() => sb.from('st_sales').select('id,salesman_id,item_id,points').eq('sold_on', S.date).order('id'));
  return data.map(r => ({ id: r.id, man: r.salesman_id, item: r.item_id, pts: r.points, p: Promise.resolve() }));
}
function drawEntry() {
  const v = document.getElementById('view'); if (!v) return;
  const active = S.men.filter(m => m.active);
  const stat = id => { const mine = S.rows.filter(r => r.man === id); return `${mine.length} items · ${mine.reduce((a, r) => a + r.pts, 0)} pts`; };
  const sel = S.men.find(m => m.id === S.selMan);
  v.innerHTML = `
    <div class="card" style="padding:12px"><label for="dateSel">Date</label><input type="date" id="dateSel" value="${S.date}" style="max-width:220px"></div>
    ${active.length ? `<div class="men">${active.map(m => `<button class="man ${m.id === S.selMan ? 'on' : ''}" data-act="selman" data-id="${m.id}"><b>${esc(m.display_name)}</b><span>${stat(m.id)}</span></button>`).join('')}</div>`
      : '<div class="card"><p class="empty">No salesmen yet. Add them under Manage.</p></div>'}
    ${sel ? `<div class="card" style="margin-top:16px"><h2>${esc(sel.display_name)} — tap an item for each piece sold</h2>
      <div class="tiles">${activeItems().map(i => {
        const c = S.rows.filter(r => r.man === sel.id && r.item === i.id).length;
        return `<div class="tile" data-act="tap" data-item="${i.id}" role="button" tabindex="0">
          <button class="minus" data-act="undo" data-item="${i.id}" aria-label="Remove one ${esc(i.name)}" ${c ? '' : 'disabled'}>−</button>
          <div><div class="name">${esc(i.name)}</div><div class="pp">${i.points} pt${i.points === 1 ? '' : 's'} each</div></div>
          <div class="cnt">${c}</div></div>`;
      }).join('')}</div></div>` : ''}`;
  document.getElementById('dateSel').onchange = async e => {
    S.date = e.target.value || todayStr();
    try { S.rows = await loadRows(); } catch (err) { toast(err.message); }
    drawEntry();
  };
}
function tap(manId, itemId) {
  const item = S.items.find(i => i.id === itemId); if (!item) return;
  const r = { id: null, man: manId, item: itemId, pts: item.points };
  r.p = sb.from('st_sales').insert({ salesman_id: manId, item_id: itemId, sold_on: S.date }).select('id').single().then(({ data, error }) => {
    if (error) { S.rows = S.rows.filter(x => x !== r); toast('Not saved: ' + error.message); drawEntry(); } else r.id = data.id;
  });
  S.rows.push(r); drawEntry();
}
async function undo(manId, itemId) {
  const idx = S.rows.map(r => r.man === manId && r.item === itemId).lastIndexOf(true);
  if (idx < 0) return;
  const [r] = S.rows.splice(idx, 1); drawEntry();
  await r.p;
  if (r.id) {
    const { error } = await sb.from('st_sales').delete().eq('id', r.id);
    if (error) { S.rows.push(r); toast('Could not remove: ' + error.message); drawEntry(); }
  }
}

async function drawBoard() {
  const v = document.getElementById('view');
  v.innerHTML = monthPicker() + '<div id="lb"><p class="mute">Loading…</p></div>';
  bindMonth(drawBoard);
  const [from] = monthRange(S.month);
  try {
    const sum = await run(sb.rpc('st_month_summary', { month_start: from }));
    const names = [...new Set([...activeItems().map(i => i.name), ...sum.map(r => r.item_name)])];
    const rows = S.men.filter(m => m.active || sum.some(r => r.salesman_id === m.id)).map(m => {
      const mine = sum.filter(r => r.salesman_id === m.id);
      return { m, pts: mine.reduce((a, r) => a + Number(r.pts), 0), qty: mine.reduce((a, r) => a + Number(r.qty), 0), by: Object.fromEntries(mine.map(r => [r.item_name, Number(r.qty)])) };
    }).sort((a, b) => b.pts - a.pts || a.m.display_name.localeCompare(b.m.display_name));
    const total = rows.reduce((a, r) => a + r.pts, 0), max = Math.max(1, ...rows.map(r => r.pts));
    document.getElementById('lb').innerHTML = `
      <div class="card"><div class="stats"><div class="stat"><span>Total points</span><b>${total}</b></div><div class="stat"><span>Items sold</span><b>${rows.reduce((a, r) => a + r.qty, 0)}</b></div>${S.rate > 0 ? `<div class="stat"><span>Total bonus</span><b>${money(total * S.rate)}</b></div>` : ''}</div></div>
      <div class="card"><h2>Leaderboard</h2><div class="scroll"><table><thead><tr><th>#</th><th>Salesman</th>${names.map(n => `<th class="n">${esc(n)}</th>`).join('')}<th class="n">Points</th>${S.rate > 0 ? '<th class="n">Bonus</th>' : ''}</tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${i === 0 && r.pts > 0 ? '🏆' : i + 1}</td><td>${esc(r.m.display_name)}<div style="height:5px;background:var(--line);border-radius:3px;margin-top:4px"><div style="height:100%;width:${r.pts / max * 100}%;background:var(--accent);border-radius:3px"></div></div></td>${names.map(n => `<td class="n">${r.by[n] || '–'}</td>`).join('')}<td class="n pts">${r.pts}</td>${S.rate > 0 ? `<td class="n">${money(r.pts * S.rate)}</td>` : ''}</tr>`).join('')}
      </tbody></table></div></div>`;
  } catch (e) { document.getElementById('lb').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

async function fetchMonthSales() {
  const [from, to] = monthRange(S.month);
  return fetchAll(() => {
    let q = sb.from('st_sales').select('id,salesman_id,item_name,points,sold_on,created_at').gte('sold_on', from).lt('sold_on', to).order('sold_on', { ascending: false }).order('id', { ascending: false });
    if (S.histMan) q = q.eq('salesman_id', S.histMan);
    return q;
  });
}
async function drawHistory() {
  const v = document.getElementById('view');
  v.innerHTML = monthPicker() + `<div class="card"><div class="grid" style="margin-bottom:12px"><div><label for="hMan">Salesman</label><select id="hMan"><option value="">All salesmen</option>${S.men.map(m => `<option value="${m.id}" ${m.id === S.histMan ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('')}</select></div><div><button class="btn ghost" data-act="csv">Download CSV</button></div></div><div id="hist" class="scroll"><p class="mute">Loading…</p></div></div>`;
  bindMonth(drawHistory);
  document.getElementById('hMan').onchange = e => { S.histMan = e.target.value; drawHistory(); };
  try {
    const rows = await fetchMonthSales();
    document.getElementById('hist').innerHTML = rows.length ? `<table><thead><tr><th>Date</th><th>Salesman</th><th>Item</th><th class="n">Pts</th><th></th></tr></thead><tbody>${rows.map(s => `<tr><td>${s.sold_on}</td><td>${esc(manName(s.salesman_id))}</td><td>${esc(s.item_name)}</td><td class="n pts">${s.points}</td><td class="n"><button class="link" data-act="delsale" data-id="${s.id}" aria-label="Delete">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty">No sales.</p>';
  } catch (e) { document.getElementById('hist').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
async function downloadCsv() {
  try {
    const rows = await fetchMonthSales();
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [['Date', 'Salesman', 'Item', 'Points'], ...rows.map(s => [s.sold_on, manName(s.salesman_id), s.item_name, s.points])].map(r => r.map(q).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `sales-${S.month}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { toast(e.message); }
}

function drawManage() {
  const v = document.getElementById('view');
  v.innerHTML = `
  <div class="card"><h2>Salesmen</h2>
    ${S.men.map(m => `<div class="row"><b style="flex:1;min-width:130px">${esc(m.display_name)} <span class="badge">${esc(m.username)}</span>${m.active ? '' : ' <span class="badge">inactive</span>'}</b>
      <button class="btn ghost sm" data-act="resetpw" data-id="${m.id}">Reset password</button>
      <button class="btn ghost sm" data-act="toggle" data-id="${m.id}" data-active="${m.active ? 1 : 0}">${m.active ? 'Deactivate' : 'Activate'}</button></div>`).join('') || '<p class="empty">None yet.</p>'}
    <form id="addMan" style="margin-top:16px"><label>Add salesman</label>
      <div class="row"><input id="nName" placeholder="Name (e.g. Rahul Sharma)" required><input id="nUser" placeholder="Username (e.g. rahul)" autocapitalize="none" required><input id="nPass" placeholder="Password (min 6)" minlength="6" required><button class="btn sm" type="submit">Add</button></div></form>
  </div>
  <div class="card"><h2>Items &amp; points</h2>
    ${S.items.map(i => `<div class="row"><input data-iname="${i.id}" value="${esc(i.name)}"><input class="sm" type="number" min="0" data-ipts="${i.id}" value="${i.points}" aria-label="Points"><button class="btn ghost sm" data-act="itemactive" data-id="${i.id}">${i.active ? 'Hide' : 'Show'}</button></div>`).join('')}
    <p class="mute" style="font-size:13px">Changing points applies to future sales only. Hidden items disappear from Quick Entry.</p>
    <form id="addItem" class="row"><input id="iName" placeholder="New item" required><input id="iPts" class="sm" type="number" min="0" placeholder="Points" required><button class="btn sm" type="submit">Add</button></form>
  </div>
  <div class="card"><h2>Bonus amount (optional)</h2><label for="rate">Rupees per point (0 hides bonus amounts)</label><input id="rate" type="number" min="0" step="any" value="${S.rate}" style="max-width:200px"></div>`;
  document.getElementById('addMan').onsubmit = async e => {
    e.preventDefault();
    try {
      await admin({ action: 'create', display_name: nName.value, username: nUser.value, password: nPass.value });
      toast('Salesman added'); await reloadMen(); drawManage();
    } catch (err) { toast(err.message); }
  };
  document.getElementById('addItem').onsubmit = async e => {
    e.preventDefault();
    try { await run(sb.from('st_items').insert({ name: iName.value.trim(), points: Math.max(0, parseInt(iPts.value) || 0), sort: S.items.length + 1 })); await reloadItems(); drawManage(); } catch (err) { toast(err.message); }
  };
  document.getElementById('rate').onchange = async e => {
    const r = Math.max(0, Number(e.target.value) || 0);
    try { await run(sb.from('st_settings').update({ rate_per_point: r }).eq('id', 1)); S.rate = r; toast('Saved'); } catch (err) { toast(err.message); }
  };
  v.querySelectorAll('[data-iname]').forEach(el => el.onchange = () => saveItem(el.dataset.iname, { name: el.value.trim() }));
  v.querySelectorAll('[data-ipts]').forEach(el => el.onchange = () => saveItem(el.dataset.ipts, { points: Math.max(0, parseInt(el.value) || 0) }));
}
async function saveItem(id, patch) {
  try { await run(sb.from('st_items').update(patch).eq('id', id)); await reloadItems(); toast('Saved'); } catch (e) { toast(e.message); }
}
const reloadItems = async () => { S.items = await run(sb.from('st_items').select('*').order('sort').order('id')); };
const reloadMen = async () => { S.men = await run(sb.from('st_profiles').select('*').eq('role', 'salesman').order('display_name')); };
async function admin(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch (_) { /* keep default */ }
    throw new Error(msg);
  }
  return data;
}

/* ---------- events (delegated) ---------- */
$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const d = el.dataset;
  if (d.act === 'logout') return logout();
  if (d.act === 'tab') { S.tab = d.tab; return renderOwner(); }
  if (d.act === 'selman') { S.selMan = d.id; return drawEntry(); }
  if (d.act === 'undo') { e.stopPropagation(); return undo(S.selMan, Number(d.item)); }
  if (d.act === 'tap') return tap(S.selMan, Number(d.item));
  if (d.act === 'csv') return downloadCsv();
  if (d.act === 'delsale' && confirm('Delete this sale?')) {
    try { await run(sb.from('st_sales').delete().eq('id', d.id)); toast('Deleted'); drawHistory(); } catch (err) { toast(err.message); }
  }
  if (d.act === 'resetpw') {
    const pw = prompt('New password for this salesman (min 6 characters):');
    if (pw) try { await admin({ action: 'reset_password', id: d.id, password: pw }); toast('Password changed'); } catch (err) { toast(err.message); }
  }
  if (d.act === 'toggle') {
    const turnOn = d.active !== '1';
    if (!turnOn && !confirm('Deactivate this salesman? They will no longer be able to log in. Their sales are kept.')) return;
    try { await admin({ action: 'set_active', id: d.id, active: turnOn }); await reloadMen(); drawManage(); } catch (err) { toast(err.message); }
  }
  if (d.act === 'itemactive') {
    const it = S.items.find(i => i.id === Number(d.id));
    await saveItem(it.id, { active: !it.active }); drawManage();
  }
});
$app.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.act === 'tap') { e.preventDefault(); tap(S.selMan, Number(e.target.dataset.item)); }
});
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && S.me) { S.me = null; renderLogin(); } });

start();
