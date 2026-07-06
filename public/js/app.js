/* ==========================================================
   Auth State
   ========================================================== */
let authToken   = localStorage.getItem('auth_token');
let currentUser = null;
let adminToken  = localStorage.getItem('admin_token');
let adminUser   = null;

function setAuth(token, user) { authToken = token; currentUser = user; localStorage.setItem('auth_token', token); localStorage.setItem('auth_user', JSON.stringify(user)); }
function clearAuth() { authToken = null; currentUser = null; localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); }
function setAdminAuth(token, admin) { adminToken = token; adminUser = admin; localStorage.setItem('admin_token', token); localStorage.setItem('admin_user', JSON.stringify(admin)); }
function clearAdminAuth() { adminToken = null; adminUser = null; localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); }
function isLoggedIn() { return !!authToken; }
function isAdminLoggedIn() { return !!adminToken; }

/* ==========================================================
   App State
   ========================================================== */
let currentPage = 'dictation', dictState = null, timerRef = null;
let pendingUpload = null, editingWordId = null;
let wordsCache = [], curWordsPage = 1;
let wordsSearchTimer = null, errorsSearchTimer = null, adminSearchTimer = null;
let codeTimers = {}, adminUsersCache = [];

/* ==========================================================
   API Helpers
   ========================================================== */
async function api(url, method = 'GET', body, token) {
    const t = token || authToken;
    const opts = { method, headers: {} };
    if (t) opts.headers['Authorization'] = `Bearer ${t}`;
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    if (res.status === 401 && !url.includes('/admin/')) { clearAuth(); showView('auth'); throw new Error('登录已过期'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
}
async function uploadFile(url, formData) {
    const opts = { method: 'POST', headers: {}, body: formData };
    if (authToken) opts.headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(url, opts);
    if (res.status === 401) { clearAuth(); showView('auth'); throw new Error('登录已过期'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    return data;
}

/* ==========================================================
   View Management
   ========================================================== */
function showView(view) {
    document.getElementById('auth-page').style.display    = view === 'auth'   ? 'flex'  : 'none';
    document.getElementById('app-wrapper').style.display  = view === 'app'    ? 'flex'  : 'none';
    document.getElementById('admin-wrapper').style.display = view === 'admin'  ? 'block' : 'none';
    if (view === 'auth') showStudentAuth();
    if (view === 'app')  { updateSidebarUser(); navigateTo('dictation'); }
    if (view === 'admin') loadAdminDashboard();
}

/* ==========================================================
   Auth Page
   ========================================================== */
function showStudentAuth() {
    document.getElementById('auth-student').style.display = 'block';
    document.getElementById('auth-admin').style.display = 'none';
    document.querySelectorAll('#auth-page input[type!=button]').forEach(el => el.value = '');
    switchAuthTab('login'); switchLoginMode('password');
}
function showAdminLogin() { document.getElementById('auth-student').style.display = 'none'; document.getElementById('auth-admin').style.display = 'block'; }
function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
}
function switchLoginMode(mode) {
    document.getElementById('login-pwd-mode').style.display = mode === 'password' ? 'block' : 'none';
    document.getElementById('login-code-mode').style.display = mode === 'code' ? 'block' : 'none';
}

async function sendCode(type) {
    const phone = type === 'login' ? document.getElementById('login-code-phone').value.trim() : document.getElementById('reg-phone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { toast('请输入正确的手机号', 'warning'); return; }
    const btnEl = type === 'login' ? document.getElementById('login-send-btn') : document.getElementById('reg-send-btn');
    btnEl.disabled = true; btnEl.textContent = '发送中…';
    try { await api('/api/auth/send-code', 'POST', { phone, type }); toast('验证码已发送', 'success'); startCodeCountdown(btnEl); }
    catch (e) { toast(e.message, 'error'); btnEl.disabled = false; btnEl.textContent = '发送验证码'; }
}
function startCodeCountdown(btnEl) {
    let sec = 60; btnEl.textContent = `${sec}s`;
    const key = btnEl.id; if (codeTimers[key]) clearInterval(codeTimers[key]);
    codeTimers[key] = setInterval(() => { sec--; if (sec <= 0) { clearInterval(codeTimers[key]); btnEl.disabled = false; btnEl.textContent = '发送验证码'; } else btnEl.textContent = `${sec}s`; }, 1000);
}

async function doRegister() {
    const phone = document.getElementById('reg-phone').value.trim(), code = document.getElementById('reg-code').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim(), password = document.getElementById('reg-password').value;
    if (!/^1[3-9]\d{9}$/.test(phone)) { toast('请输入正确的手机号', 'warning'); return; }
    if (!code) { toast('请输入验证码', 'warning'); return; } if (!nickname) { toast('请输入昵称', 'warning'); return; }
    if (!password || password.length < 6) { toast('密码至少6位', 'warning'); return; }
    try { const d = await api('/api/auth/register', 'POST', { phone, code, nickname, password }); setAuth(d.token, d.user); toast('注册成功', 'success'); showView('app'); }
    catch (e) { toast(e.message, 'error'); }
}
async function loginWithPassword() {
    const phone = document.getElementById('login-phone').value.trim(), password = document.getElementById('login-password').value;
    if (!phone || !password) { toast('请输入手机号和密码', 'warning'); return; }
    try { const d = await api('/api/auth/login', 'POST', { phone, password }); setAuth(d.token, d.user); toast('登录成功', 'success'); showView('app'); }
    catch (e) { toast(e.message, 'error'); }
}
async function loginWithCode() {
    const phone = document.getElementById('login-code-phone').value.trim(), code = document.getElementById('login-code').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { toast('请输入正确的手机号', 'warning'); return; }
    if (!code) { toast('请输入验证码', 'warning'); return; }
    try { const d = await api('/api/auth/login-code', 'POST', { phone, code }); setAuth(d.token, d.user); toast('登录成功', 'success'); showView('app'); }
    catch (e) { toast(e.message, 'error'); }
}
async function adminLogin() {
    const username = document.getElementById('admin-username').value.trim(), password = document.getElementById('admin-password').value;
    if (!username || !password) { toast('请输入账号和密码', 'warning'); return; }
    try { const d = await api('/api/admin/login', 'POST', { username, password }); setAdminAuth(d.token, d.admin); toast('管理员登录成功', 'success'); showView('admin'); }
    catch (e) { toast(e.message, 'error'); }
}

function doLogout() { clearAuth(); cleanupDictation(); showView('auth'); toast('已退出登录', 'info'); }
function adminLogout() { clearAdminAuth(); showView('auth'); toast('已退出管理后台', 'info'); }

function updateSidebarUser() {
    if (!currentUser) try { currentUser = JSON.parse(localStorage.getItem('auth_user')); } catch {}
    if (currentUser) {
        document.getElementById('user-avatar').textContent = (currentUser.nickname || '?').charAt(0).toUpperCase();
        document.getElementById('user-name').textContent = currentUser.nickname || '用户';
        document.getElementById('user-phone').textContent = currentUser.phone || '';
    }
}

/* ==========================================================
   Book / Unit Utilities
   ========================================================== */
async function loadBooksIntoSelect(selectId, selected) {
    const books = await api('/api/books');
    const sel = document.getElementById(selectId);
    sel.innerHTML = '<option value="__all__">全部书本</option>';
    books.forEach(b => { sel.innerHTML += `<option value="${esc(b.book)}">${esc(b.book)}（${b.word_count}词）</option>`; });
    if (selected && [...sel.options].some(o => o.value === selected)) sel.value = selected;
    return books;
}

async function loadUnitsIntoSelect(selectId, book, selected) {
    const sel = document.getElementById(selectId);
    if (!book || book === '__all__') { sel.innerHTML = '<option value="__all__">全部单元</option>'; return []; }
    const units = await api(`/api/units?book=${enc(book)}`);
    sel.innerHTML = '<option value="__all__">全部单元</option>';
    units.forEach(u => { sel.innerHTML += `<option value="${esc(u.unit)}">${esc(u.unit)}（${u.word_count}词）</option>`; });
    if (selected && [...sel.options].some(o => o.value === selected)) sel.value = selected;
    return units;
}

/* ==========================================================
   Dictation
   ========================================================== */
async function loadDictSetup() {
    try {
        const [stats] = await Promise.all([api('/api/stats'), loadBooksIntoSelect('dict-book', currentUser?.last_book || '__all__')]);
        document.getElementById('s-total').textContent = stats.totalWords;
        document.getElementById('s-error').textContent = stats.activeErrors;
        document.getElementById('s-sess').textContent = stats.totalSessions;
        // 如果有记住的书本，加载其单元
        const lb = currentUser?.last_book;
        if (lb) { document.getElementById('dict-book').value = lb; await loadUnitsIntoSelect('dict-unit', lb); }
        showPhase('setup');
    } catch (e) { toast(e.message, 'error'); }
}

async function onDictBookChange() {
    const book = document.getElementById('dict-book').value;
    await loadUnitsIntoSelect('dict-unit', book);
}

async function startDictation() {
    try {
        const book = document.getElementById('dict-book').value;
        const unit = document.getElementById('dict-unit').value;
        const mode = document.querySelector('input[name="dict-mode"]:checked').value;
        const count = parseInt(document.getElementById('dict-count').value) || 30;
        const words = await api('/api/dictation/select', 'POST', { book: book === '__all__' ? '' : book, unit: unit === '__all__' ? '' : unit, count, mode });
        if (!words.length) { toast(mode === 'error_book' ? '错题本为空' : '没有找到单词', 'warning'); return; }
        // 更新记住的书本
        if (book && book !== '__all__') currentUser.last_book = book;
        dictState = { words: words.map(w => ({ ...w, markedWrong: false })), book: book === '__all__' ? '' : book, unit: unit === '__all__' ? '' : unit, mode, phase: 'active', elapsed: 0, timerStarted: false, paused: false };
        document.getElementById('dict-words-grid').innerHTML = dictState.words.map((w, i) =>
            `<div class="dict-word-card" style="animation-delay:${Math.min(i*.03,.8)}s"><span class="word-number">${i+1}</span><span class="word-chinese">${esc(w.chinese)}</span></div>`).join('');
        document.getElementById('dict-timer').textContent = '00:00'; renderTimerControls(); showPhase('active');
        toast(`已选择 ${words.length} 个单词`, 'info');
    } catch (e) { toast(e.message, 'error'); }
}

function renderTimerControls() {
    const c = document.getElementById('timer-controls');
    if (!dictState) { c.innerHTML = ''; return; }
    if (!dictState.timerStarted) c.innerHTML = `<button class="btn btn-primary" onclick="startTimer()">开始计时</button><button class="btn btn-ghost" onclick="endDictation()">跳过计时</button>`;
    else if (dictState.paused) c.innerHTML = `<button class="btn btn-primary" onclick="togglePause()">继续</button><button class="btn btn-danger" onclick="endDictation()">结束</button>`;
    else c.innerHTML = `<button class="btn btn-secondary" onclick="togglePause()">暂停</button><button class="btn btn-danger" onclick="endDictation()">结束</button>`;
}
function startTimer() { if (!dictState) return; dictState.timerStarted = true; timerRef = setInterval(tickTimer, 1000); renderTimerControls(); }
function togglePause() { if (!dictState) return; dictState.paused = !dictState.paused; if (dictState.paused) { clearInterval(timerRef); timerRef = null; } else timerRef = setInterval(tickTimer, 1000); renderTimerControls(); }
function tickTimer() { if (!dictState || dictState.paused) return; dictState.elapsed++; document.getElementById('dict-timer').textContent = fmtTime(dictState.elapsed); }

function endDictation() {
    if (timerRef) { clearInterval(timerRef); timerRef = null; } if (!dictState) return; dictState.phase = 'review';
    document.getElementById('review-grid').innerHTML = dictState.words.map((w, i) =>
        `<div class="review-card" data-i="${i}" onclick="toggleWrong(${i})" style="animation-delay:${Math.min(i*.03,.8)}s">
            <span class="word-number">${i+1}</span>
            <div class="review-chinese">${esc(w.chinese)}</div>
            ${w.phonetic ? `<div class="review-phonetic">${esc(w.phonetic)}</div>` : ''}
            <div class="review-english">${esc(w.english)}</div><div class="wrong-badge">✗</div>
        </div>`).join('');
    showPhase('review');
}
function toggleWrong(i) { if (!dictState) return; dictState.words[i].markedWrong = !dictState.words[i].markedWrong; document.querySelector(`.review-card[data-i="${i}"]`).classList.toggle('wrong', dictState.words[i].markedWrong); }

async function submitDictation() {
    if (!dictState) return;
    try {
        const results = dictState.words.map(w => ({ wordId: w.id, isCorrect: !w.markedWrong }));
        const data = await api('/api/dictation/submit', 'POST', { book: dictState.book, unit: dictState.unit, mode: dictState.mode, timeSpent: dictState.elapsed, results });
        renderResult(data); dictState.phase = 'result'; showPhase('result');
    } catch (e) { toast(e.message, 'error'); }
}

function renderResult(data) {
    const wrong = dictState.words.filter(w => w.markedWrong);
    const ac = +data.accuracy >= 90 ? 'ok' : +data.accuracy < 70 ? 'err' : '';
    document.getElementById('result-content').innerHTML = `
    <div class="result-card card">
        <h2 class="result-title">听写完成</h2>
        <div class="result-stats">
            <div class="stat"><div class="stat-val ok">${data.correctCount}</div><div class="stat-lbl">正确</div></div>
            <div class="stat"><div class="stat-val err">${data.wrongCount}</div><div class="stat-lbl">错误</div></div>
            <div class="stat"><div class="stat-val ${ac}">${data.accuracy}%</div><div class="stat-lbl">正确率</div></div>
            <div class="stat"><div class="stat-val">${fmtTime(data.timeSpent)}</div><div class="stat-lbl">用时</div></div>
        </div>
        ${wrong.length ? `<div class="result-section"><h3 class="result-section-title">错误单词（${wrong.length}）</h3><div class="wrong-words-list">
            ${wrong.map(w => `<div class="wrong-word-item"><span class="ww-chinese">${esc(w.chinese)}</span>${w.phonetic?`<span class="ww-phonetic">${esc(w.phonetic)}</span>`:''}<span class="ww-divider">—</span><span class="ww-english">${esc(w.english)}</span></div>`).join('')}
        </div></div>` : `<div class="result-perfect"><div class="perfect-icon">★</div><p>全部正确，太棒了！</p></div>`}
        <div class="result-actions"><button class="btn btn-primary btn-lg" onclick="startDictation()">再来一次</button><button class="btn btn-secondary" onclick="backToSetup()">返回设置</button></div>
    </div>`;
}
function backToSetup() { cleanupDictation(); loadDictSetup(); }
function cleanupDictation() { if (timerRef) { clearInterval(timerRef); timerRef = null; } dictState = null; }
function showPhase(p) { ['setup','active','review','result'].forEach(k => { const el = document.getElementById(`dict-${k}`); if (el) el.style.display = k === p ? 'block' : 'none'; }); }

/* ==========================================================
   Word Management
   ========================================================== */
async function loadWordsPage() {
    try {
        await loadBooksIntoSelect('words-book-filter');
        document.getElementById('words-unit-filter').innerHTML = '<option value="">全部单元</option>';
        fetchWords();
    } catch (e) { toast(e.message, 'error'); }
}
async function onWordsBookFilterChange() { await loadUnitsIntoSelect('words-unit-filter', document.getElementById('words-book-filter').value); fetchWords(); }

async function fetchWords(page = 1) {
    try {
        const book = document.getElementById('words-book-filter').value;
        const unit = document.getElementById('words-unit-filter').value;
        const search = document.getElementById('words-search').value;
        const data = await api(`/api/words?book=${enc(book === '__all__' ? '' : book)}&unit=${enc(unit === '__all__' ? '' : unit)}&search=${enc(search)}&page=${page}&pageSize=30`);
        wordsCache = data.words; curWordsPage = data.page; renderWordsTable(data);
    } catch (e) { toast(e.message, 'error'); }
}

function renderWordsTable(data) {
    const tbody = document.getElementById('words-tbody');
    if (!data.words.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-state">暂无单词，请上传 Excel</td></tr>'; document.getElementById('words-pagination').innerHTML = ''; return; }
    tbody.innerHTML = data.words.map((w, i) => `<tr>
        <td class="text-muted">${(data.page-1)*data.pageSize+i+1}</td>
        <td>${esc(w.chinese)}</td><td class="english-cell">${esc(w.english)}</td>
        <td class="phonetic-cell">${esc(w.phonetic) || '<span class="text-muted">—</span>'}</td>
        <td><span class="tag">${esc(w.book) || '—'}</span></td>
        <td>${esc(w.unit) || '<span class="text-muted">—</span>'}</td>
        <td class="text-center">${w.dictation_count}</td>
        <td class="actions-cell">
            <button class="btn btn-sm btn-ghost" onclick="editWord(${w.id})">编辑</button>
            <button class="btn btn-sm btn-ghost btn-danger-text" onclick="deleteWord(${w.id},'${esc(w.english)}')">删除</button>
        </td></tr>`).join('');
    const total = Math.ceil(data.total / data.pageSize), pc = document.getElementById('words-pagination');
    if (total <= 1) { pc.innerHTML = ''; return; }
    let h = ''; for (let i = 1; i <= total; i++) h += `<button class="btn btn-sm ${i===data.page?'btn-primary':'btn-ghost'}" onclick="fetchWords(${i})">${i}</button>`;
    pc.innerHTML = h;
}

function debounceWordsSearch() { clearTimeout(wordsSearchTimer); wordsSearchTimer = setTimeout(() => fetchWords(), 300); }
function debounceErrorsSearch() { clearTimeout(errorsSearchTimer); errorsSearchTimer = setTimeout(() => fetchErrors(), 300); }

async function handleFileUpload(event) {
    const file = event.target.files[0]; if (!file) return; event.target.value = '';
    const fd = new FormData(); fd.append('file', file);
    try { pendingUpload = (await uploadFile('/api/upload/parse', fd)); showUploadPreview(pendingUpload); }
    catch (e) { toast(e.message, 'error'); }
}

function showAddWord() {
    openModal(`<h2 class="modal-title">新增单词</h2>
        <div class="form-group"><label>中文</label><input type="text" id="add-cn" class="input" placeholder="请输入中文"></div>
        <div class="form-group"><label>英文</label><input type="text" id="add-en" class="input" style="font-family:var(--font-mono)" placeholder="请输入英文"></div>
        <div class="form-group"><label>音标</label><input type="text" id="add-ph" class="input" style="font-family:var(--font-mono)" placeholder="如：/æp.l/"></div>
        <div class="form-group"><label>书本</label><input type="text" id="add-book" class="input" placeholder="如：八年级上册"></div>
        <div class="form-group"><label>单元</label><input type="text" id="add-unit" class="input" placeholder="如：Unit2"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" onclick="addWord()">确认添加</button>
        </div>`);
}

async function addWord() {
    const chinese = document.getElementById('add-cn').value.trim();
    const english = document.getElementById('add-en').value.trim();
    const phonetic = document.getElementById('add-ph').value.trim();
    const book = document.getElementById('add-book').value.trim();
    const unit = document.getElementById('add-unit').value.trim();
    if (!chinese || !english) { toast('中文和英文不能为空', 'warning'); return; }
    if (!book) { toast('请输入书本', 'warning'); return; }
    if (!unit) { toast('请输入单元', 'warning'); return; }
    try {
        await api('/api/words', 'POST', { chinese, phonetic, english, book, unit });
        closeModal(); toast('添加成功', 'success'); fetchWords();
    } catch (e) { toast(e.message, 'error'); }
}

function showUploadPreview(data) {
    openModal(`<h2 class="modal-title">确认上传</h2>
        <p class="modal-desc">解析到 <strong>${data.words.length}</strong> 个有效单词（共 ${data.totalRows} 行）</p>
        ${data.parseErrors.length ? `<div class="parse-errors">${data.parseErrors.slice(0,5).map(e=>`<p>${esc(e)}</p>`).join('')}${data.parseErrors.length>5?`<p>…还有 ${data.parseErrors.length-5} 条</p>`:''}</div>` : ''}
        <div class="form-group"><label>书本名称</label><input type="text" id="upload-book" class="input" placeholder="如：八年级上册"></div>
        <div class="form-group"><label>单元</label><input type="text" id="upload-unit" class="input" placeholder="如：Unit2"></div>
        <div class="preview-wrapper"><table class="preview-table"><thead><tr><th>中文</th><th>英文</th><th>音标</th></tr></thead>
        <tbody>${data.words.slice(0,10).map(w=>`<tr><td>${esc(w.chinese)}</td><td>${esc(w.english)}</td><td>${esc(w.phonetic)||'—'}</td></tr>`).join('')}
        ${data.words.length>10?`<tr><td colspan="3" class="text-muted text-center">…还有 ${data.words.length-10} 个</td></tr>`:''}</tbody></table></div>
        <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="confirmUpload()">确认上传</button></div>`);
}

async function confirmUpload() {
    const book = document.getElementById('upload-book').value.trim(), unit = document.getElementById('upload-unit').value.trim();
    if (!book) { toast('请输入书本名称', 'warning'); return; }
    if (!unit) { toast('请输入单元', 'warning'); return; }
    try {
        const r = await api('/api/upload/confirm', 'POST', { words: pendingUpload.words, book, unit });
        closeModal(); pendingUpload = null; toast(`上传成功：新增 ${r.inserted}，更新 ${r.updated}`, 'success');
        if (currentPage === 'words') loadWordsPage();
    } catch (e) { toast(e.message, 'error'); }
}

function editWord(id) {
    const w = wordsCache.find(x => x.id === id); if (!w) return; editingWordId = id;
    openModal(`<h2 class="modal-title">编辑单词</h2>
        <div class="form-group"><label>中文</label><input type="text" id="edit-cn" class="input" value="${esc(w.chinese)}"></div>
        <div class="form-group"><label>英文</label><input type="text" id="edit-en" class="input" style="font-family:var(--font-mono)" value="${esc(w.english)}"></div>
        <div class="form-group"><label>音标</label><input type="text" id="edit-ph" class="input" style="font-family:var(--font-mono)" value="${esc(w.phonetic||'')}"></div>
        <div class="form-group"><label>书本</label><input type="text" id="edit-book" class="input" value="${esc(w.book)}"></div>
        <div class="form-group"><label>单元</label><input type="text" id="edit-unit" class="input" value="${esc(w.unit)}"></div>
        <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveWord()">保存</button></div>`);
}

async function saveWord() {
    const chinese = document.getElementById('edit-cn').value.trim(), english = document.getElementById('edit-en').value.trim();
    const phonetic = document.getElementById('edit-ph').value.trim(), book = document.getElementById('edit-book').value.trim(), unit = document.getElementById('edit-unit').value.trim();
    if (!chinese || !english) { toast('中文和英文不能为空', 'warning'); return; }
    try { await api(`/api/words/${editingWordId}`, 'PUT', { chinese, phonetic, english, book, unit }); closeModal(); toast('保存成功', 'success'); fetchWords(curWordsPage); }
    catch (e) { toast(e.message, 'error'); }
}

async function deleteWord(id, en) { if (!confirm(`确定删除 "${en}" 吗？`)) return; try { await api(`/api/words/${id}`, 'DELETE'); toast('已删除', 'success'); fetchWords(curWordsPage); } catch (e) { toast(e.message, 'error'); } }

/* ==========================================================
   Error Book
   ========================================================== */
async function loadErrorsPage() {
    try {
        const books = await api('/api/error-books');
        const sel = document.getElementById('errors-book-filter');
        sel.innerHTML = '<option value="__all__">全部书本</option>';
        books.forEach(b => { sel.innerHTML += `<option value="${esc(b.book)}">${esc(b.book)}（${b.word_count}题）</option>`; });
        document.getElementById('errors-unit-filter').innerHTML = '<option value="__all__">全部单元</option>';
        fetchErrors();
    } catch (e) { toast(e.message, 'error'); }
}

async function onErrorsBookFilterChange() {
    const book = document.getElementById('errors-book-filter').value;
    const sel = document.getElementById('errors-unit-filter');
    if (!book || book === '__all__') { sel.innerHTML = '<option value="__all__">全部单元</option>'; fetchErrors(); return; }
    const units = await api(`/api/error-units?book=${enc(book)}`);
    sel.innerHTML = '<option value="__all__">全部单元</option>';
    units.forEach(u => { sel.innerHTML += `<option value="${esc(u.unit)}">${esc(u.unit)}（${u.word_count}题）</option>`; });
    fetchErrors();
}

async function fetchErrors() {
    try {
        const book = document.getElementById('errors-book-filter').value, unit = document.getElementById('errors-unit-filter').value, search = document.getElementById('errors-search').value;
        renderErrorsTable(await api(`/api/errors?book=${enc(book === '__all__' ? '' : book)}&unit=${enc(unit === '__all__' ? '' : unit)}&search=${enc(search)}`));
    } catch (e) { toast(e.message, 'error'); }
}

function renderErrorsTable(rows) {
    const tbody = document.getElementById('errors-tbody');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-state">错题本为空</td></tr>'; return; }
    tbody.innerHTML = rows.map((r, i) => `<tr>
        <td class="text-muted">${i+1}</td><td>${esc(r.chinese)}</td><td class="english-cell">${esc(r.english)}</td>
        <td class="phonetic-cell">${esc(r.phonetic) || '<span class="text-muted">—</span>'}</td>
        <td><span class="tag">${esc(r.book) || '—'}</span></td>
        <td>${esc(r.unit) || '<span class="text-muted">—</span>'}</td>
        <td class="text-center"><span class="error-count-badge">${r.error_count}</span></td>
        <td class="text-center"><span class="correct-streak">${r.consecutive_correct}/3</span></td>
    </tr>`).join('');
}

/* ==========================================================
   History
   ========================================================== */
async function loadHistoryPage() { try { renderHistoryTable(await api('/api/history')); } catch (e) { toast(e.message, 'error'); } }

function renderHistoryTable(rows) {
    const tbody = document.getElementById('history-tbody');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty-state">暂无记录</td></tr>'; return; }
    tbody.innerHTML = rows.map(s => {
        const ac = s.word_count ? ((s.correct_count / s.word_count) * 100).toFixed(0) : 0;
        const cls = ac >= 90 ? 'text-success' : ac < 70 ? 'text-danger' : '';
        return `<tr class="clickable-row" onclick="viewSession(${s.id})">
            <td>${new Date(s.created_at).toLocaleString('zh-CN')}</td>
            <td><span class="tag">${esc(s.book) || '—'}</span></td>
            <td>${esc(s.unit) || '<span class="text-muted">全部</span>'}</td>
            <td>${s.mode==='error_book'?'错题本':'正常'}</td>
            <td class="text-center">${s.word_count}</td>
            <td class="text-center text-success">${s.correct_count}</td>
            <td class="text-center text-danger">${s.wrong_count}</td>
            <td class="text-center"><strong class="${cls}">${ac}%</strong></td>
            <td>${fmtTime(s.time_spent)}</td></tr>`;
    }).join('');
}

async function viewSession(id) {
    try {
        const { session: s, records } = await api(`/api/history/${id}`);
        const ac = s.word_count ? ((s.correct_count/s.word_count)*100).toFixed(1) : 0;
        const wrongRecords = records.filter(r => !r.is_correct);
        const correctRecords = records.filter(r => r.is_correct);

        function renderWords(showAll) {
            const list = showAll ? records : wrongRecords;
            if (!list.length) return '<p class="text-muted" style="padding:16px;text-align:center">没有错误单词，太棒了！</p>';
            return `<div class="detail-words">${list.map(r => `
                <div class="detail-word ${r.is_correct?'correct':'wrong'}">
                    <span class="dw-status">${r.is_correct?'✓':'✗'}</span>
                    <span class="dw-chinese">${esc(r.chinese)}</span>
                    ${r.phonetic?`<span class="dw-phonetic">${esc(r.phonetic)}</span>`:''}
                    <span class="dw-english">${esc(r.english)}</span>
                </div>`).join('')}</div>`;
        }

        openModal(`<h2 class="modal-title">听写详情</h2>
            <div class="detail-meta">
                <span>日期：${new Date(s.created_at).toLocaleString('zh-CN')}</span>
                <span>书本：${esc(s.book)||'全部'}</span>
                <span>单元：${esc(s.unit)||'全部'}</span>
                <span>用时：${fmtTime(s.time_spent)}</span>
                <span>正确率：${ac}%</span>
            </div>
            <div id="session-detail-toggle" style="margin-bottom:16px">
                <button class="btn btn-sm btn-primary" id="toggle-detail-btn" onclick="toggleSessionDetail(${id})">显示全部单词</button>
                <span class="text-muted" style="margin-left:12px;font-size:13px">错误 ${wrongRecords.length} / 共 ${records.length}</span>
            </div>
            <div id="session-detail-words">${renderWords(false)}</div>
            <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">关闭</button></div>`);
    } catch (e) { toast(e.message, 'error'); }
}

async function toggleSessionDetail(id) {
    const btn = document.getElementById('toggle-detail-btn');
    const showAll = btn.textContent === '显示全部单词';
    try {
        const { session: s, records } = await api(`/api/history/${id}`);
        const wrongRecords = records.filter(r => !r.is_correct);
        const list = showAll ? records : wrongRecords;
        btn.textContent = showAll ? '仅显示错误单词' : '显示全部单词';
        btn.className = showAll ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-primary';
        if (!list.length) { document.getElementById('session-detail-words').innerHTML = '<p class="text-muted" style="padding:16px;text-align:center">没有错误单词，太棒了！</p>'; return; }
        document.getElementById('session-detail-words').innerHTML = `<div class="detail-words">${list.map(r => `
            <div class="detail-word ${r.is_correct?'correct':'wrong'}">
                <span class="dw-status">${r.is_correct?'✓':'✗'}</span>
                <span class="dw-chinese">${esc(r.chinese)}</span>
                ${r.phonetic?`<span class="dw-phonetic">${esc(r.phonetic)}</span>`:''}
                <span class="dw-english">${esc(r.english)}</span>
            </div>`).join('')}</div>`;
    } catch (e) { toast(e.message, 'error'); }
}

/* ==========================================================
   Admin Dashboard
   ========================================================== */
async function loadAdminDashboard() {
    try {
        const [stats, users] = await Promise.all([api('/api/admin/stats', 'GET', undefined, adminToken), api('/api/admin/users', 'GET', undefined, adminToken)]);
        if (adminUser) document.getElementById('admin-display-name').textContent = adminUser.username;
        document.getElementById('as-users').textContent = stats.totalUsers;
        document.getElementById('as-words').textContent = stats.totalWords;
        document.getElementById('as-sessions').textContent = stats.totalSessions;
        document.getElementById('as-time').textContent = fmtTime(stats.totalTime);
        adminUsersCache = users; renderAdminUsers(users);
    } catch (e) { toast(e.message, 'error'); clearAdminAuth(); showView('auth'); }
}

function renderAdminUsers(users) {
    const tbody = document.getElementById('admin-users-tbody');
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="12" class="empty-state">暂无用户</td></tr>'; return; }
    tbody.innerHTML = users.map((u, i) => {
        const acc = u.avg_accuracy || 0, accColor = acc >= 90 ? 'var(--success)' : acc >= 70 ? 'var(--primary)' : 'var(--danger)';
        const lastActive = u.last_active ? timeAgo(new Date(u.last_active)) : '从未';
        return `<tr>
            <td class="text-muted">${i+1}</td><td><strong>${esc(u.nickname)}</strong></td>
            <td style="font-family:var(--font-mono);font-size:13px">${esc(u.phone)}</td>
            <td class="text-muted" style="font-size:12px">${new Date(u.created_at).toLocaleDateString('zh-CN')}</td>
            <td class="text-center">${u.word_count}</td><td class="text-center">${u.book_count}</td>
            <td class="text-center">${u.session_count}</td>
            <td style="font-family:var(--font-mono);font-size:13px">${fmtTime(u.total_time)}</td>
            <td><div class="accuracy-bar"><div class="accuracy-track"><div class="accuracy-fill" style="width:${Math.min(acc,100)}%;background:${accColor}"></div></div><span class="accuracy-val" style="color:${accColor}">${acc}%</span></div></td>
            <td class="text-center">${u.error_count > 0 ? `<span class="error-count-badge">${u.error_count}</span>` : '<span class="text-muted">0</span>'}</td>
            <td class="text-muted" style="font-size:12px">${lastActive}</td>
            <td class="actions-cell">
                <button class="btn btn-sm btn-ghost" onclick="viewUserDetail(${u.id})">详情</button>
                <button class="btn btn-sm btn-ghost btn-danger-text" onclick="deleteUser(${u.id},'${esc(u.nickname)}')">删除</button>
            </td></tr>`;
    }).join('');
}

function debounceAdminSearch() {
    clearTimeout(adminSearchTimer);
    adminSearchTimer = setTimeout(() => {
        const kw = document.getElementById('admin-user-search').value.trim().toLowerCase();
        renderAdminUsers(!kw ? adminUsersCache : adminUsersCache.filter(u => u.phone.includes(kw) || (u.nickname||'').toLowerCase().includes(kw)));
    }, 300);
}

async function viewUserDetail(uid) {
    try {
        const data = await api(`/api/admin/users/${uid}`, 'GET', undefined, adminToken);
        const u = data.user;
        // 按书本分组
        const byBook = {};
        data.books.forEach(b => { if (!byBook[b.book]) byBook[b.book] = []; byBook[b.book].push(b); });
        const booksHtml = Object.keys(byBook).length
            ? Object.entries(byBook).map(([book, units]) => `
                <div class="detail-book-block">
                    <div class="detail-book-name">${esc(book) || '未分书本'}</div>
                    ${units.map(ut => `<div class="detail-unit-item">
                        <span class="du-name">${esc(ut.unit) || '未分单元'}</span>
                        <span class="du-stat">${ut.word_count} 词</span>
                        <span class="du-stat">${ut.total_dictations} 次听写</span>
                    </div>`).join('')}
                </div>`).join('')
            : '<p class="text-muted" style="padding:8px">暂无单词</p>';

        const sessionsHtml = data.sessions.length
            ? data.sessions.map(s => { const ac = s.word_count ? ((s.correct_count/s.word_count)*100).toFixed(0) : 0; const c = ac>=90?'text-success':ac<70?'text-danger':''; return `<div class="detail-session-item"><span class="ds-date">${new Date(s.created_at).toLocaleString('zh-CN')}</span><span class="ds-info"><span class="tag">${esc(s.book)||'—'}</span> ${esc(s.unit)||''}</span><span class="ds-accuracy ${c}">${ac}%</span><span class="ds-time">${fmtTime(s.time_spent)}</span></div>`; }).join('')
            : '<p class="text-muted" style="padding:8px">暂无听写记录</p>';

        openModal(`<h2 class="modal-title">${esc(u.nickname)} 的使用详情</h2>
            <div class="detail-meta" style="margin-bottom:24px"><span>手机：${esc(u.phone)}</span><span>注册：${new Date(u.created_at).toLocaleDateString('zh-CN')}</span><span>错题：${data.activeErrors} 个</span></div>
            <div class="detail-section"><h3 class="detail-section-title">书本与单元</h3><div style="max-height:240px;overflow-y:auto">${booksHtml}</div></div>
            <div class="detail-section"><h3 class="detail-section-title">最近听写（${data.sessions.length}）</h3><div style="max-height:240px;overflow-y:auto">${sessionsHtml}</div></div>
            <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">关闭</button></div>`);
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteUser(uid, name) {
    if (!confirm(`确定删除用户"${name}"吗？\n该操作将删除该用户的所有数据且不可恢复！`)) return;
    try { await api(`/api/admin/users/${uid}`, 'DELETE', undefined, adminToken); toast(`已删除用户"${name}"`, 'success'); loadAdminDashboard(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ==========================================================
   Navigation
   ========================================================== */
function navigateTo(page) {
    if (dictState && dictState.phase !== 'setup' && dictState.phase !== 'result') { if (!confirm('听写进行中，确定离开？')) return; cleanupDictation(); }
    currentPage = page;
    document.querySelectorAll('#sidebar-nav .nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
    switch (page) { case 'dictation': loadDictSetup(); break; case 'words': loadWordsPage(); break; case 'errors': loadErrorsPage(); break; case 'history': loadHistoryPage(); break; }
}

/* ==========================================================
   Modal & Toast
   ========================================================== */
function openModal(html) { document.getElementById('modal-content').innerHTML = html; document.getElementById('modal-overlay').classList.add('active'); }
function closeModal() { document.getElementById('modal-overlay').classList.remove('active'); document.getElementById('modal-content').innerHTML = ''; }
function toast(msg, type = 'info') { const c = document.getElementById('toast-container'), t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg; c.appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(12px)'; setTimeout(() => t.remove(), 300); }, 3000); }

/* ==========================================================
   Utilities
   ========================================================== */
function fmtTime(sec) { const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60; return h > 0 ? `${h}h${String(m).padStart(2,'0')}m` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
function timeAgo(date) { const diff = Math.floor((Date.now()-date.getTime())/1000); if (diff<60) return '刚刚'; if (diff<3600) return `${Math.floor(diff/60)} 分钟前`; if (diff<86400) return `${Math.floor(diff/3600)} 小时前`; if (diff<2592000) return `${Math.floor(diff/86400)} 天前`; return date.toLocaleDateString('zh-CN'); }
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function enc(s) { return encodeURIComponent(s || ''); }

/* ==========================================================
   Init
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    if (isAdminLoggedIn()) { api('/api/admin/me', 'GET', undefined, adminToken).then(() => showView('admin')).catch(() => { clearAdminAuth(); checkStudentAuth(); }); }
    else checkStudentAuth();
});

function checkStudentAuth() {
    if (isLoggedIn()) { api('/api/auth/me').then(user => { currentUser = user; showView('app'); }).catch(() => { clearAuth(); showView('auth'); }); }
    else showView('auth');
}