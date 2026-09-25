// ==========================================
// 1. Firebase
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyC5Dh7bJzPqLaZl4djKCgpzaHHSeeD1aHU",
    authDomain: "phaseten-435bf.firebaseapp.com",
    projectId: "phaseten-435bf",
    storageBucket: "phaseten-435bf.firebasestorage.app",
    messagingSenderId: "780298483879",
    appId: "1:780298483879:web:6b6627e673d4808e098382"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
db.settings({ experimentalForceLongPolling: true, experimentalAutoDetectLongPolling: false });
const FV = firebase.firestore.FieldValue;

// ==========================================
// 2. ثوابت وحالة
// ==========================================
const GAME_DOC_ID = "game_session_v1";
const gameRef = () => db.collection('game_session').doc(GAME_DOC_ID);
const EMPTY_GAME = () => ({ round: 1, players: {}, state: 'active' });
const TOTAL_ROUNDS = 10;

const AVATARS = ["🦁", "🐯", "🐻", "🐼", "🐨", "🐸", "🐔", "🦄", "🐉", "👽", "🤖", "🤠", "😎", "👻", "🦊", "🐺", "🦅", "🐙", "🦈", "🐲", "🧔", "👑", "🔥", "⚡"];
const PHASES = [
    "2 مجموعات (3)", "مجموعة (3) + تسلسل (4)", "مجموعة (4) + تسلسل (4)", "تسلسل (7)",
    "تسلسل (8)", "تسلسل (9)", "2 مجموعات (4)", "7 كروت لون واحد",
    "مجموعة (5) + مجموعة (2)", "مجموعة (5) + مجموعة (3)"
];
const FUNNY_COMMENTS = {
    lion: ["بابا المجال وصل 🦁", "ولا كلمة يا خروف 🤫", "القمة بتاعتي لوحدي", "وسع للكبير"],
    tiger: ["هجيبك يا أسد 🐅", "الوصيف الذهبي", "قربت أوي", "يا مسهل"],
    goat: ["يا معزة يا صديق البيئة 🐐", "شد حيلك شوية", "قربت للخروف اوي", "كل برسيم واسكت"],
    sheep: ["ملك البرسيم 🌿", "يا فضيحتك 🐑", "حد يطلب الاسعاف 😂", "المركز الأخير بجدارة", "صوتك عالي ليه؟"],
    normal: ["ركز في ورقك 🃏", "العب بذكاء", "لسه فيها أمل", "اصحى للكلام"]
};
const SKIP_COMMENTS = ["لبس السكيب 😂", "حظه وحش أوي 🌚", "خدلك بريك ☕", "تتعوض 😜"];
const RANK_BADGE = { lion: '🦁', tiger: '🐯', goat: '🐐', sheep: '🐑' };
const RANK_NAME = { lion: 'الأسد', tiger: 'النمر', goat: 'المعزة', sheep: 'الخروف' };

let currentUser = null;
let usersCache = {};
let gameData = EMPTY_GAME();
let listeners = [];
let localSelection = new Set();
let editMode = false;
let prevRanks = { lion: null, sheep: null };
let localFinalResults = null;
let dismissedCertId = null;
let scoreSheetUid = null;
let ssValue = '';

const $ = id => document.getElementById(id);
const haptic = (ms = 10) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

// ==========================================
// 3. البداية
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initAvatars();
    auth.onAuthStateChanged(async user => {
        if (user) await loadUserData(user.uid);
        else { cleanupListeners(); currentUser = null; $('tabBar').hidden = true; showScreen('authScreen'); }
    });

    // قفل الشيتات والمودالز لما تدوس برا
    document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s) closeSheet(s.id); }));
    $('skipModal').addEventListener('click', e => { if (e.target.id === 'skipModal') closeModal('skipModal'); });
    document.addEventListener('keydown', e => {
        if ($('scoreSheet').classList.contains('open')) {
            if (/^[0-9]$/.test(e.key)) ssKey(e.key);
            else if (e.key === 'Backspace') ssKey('back');
            else if (e.key === 'Enter') ssSave();
        }
        if (e.key === 'Escape') document.querySelectorAll('.sheet.open').forEach(s => closeSheet(s.id));
    });
    addSwipeToClose();
    try { dismissedCertId = localStorage.getItem('p10_dismissedCert'); } catch (e) {}
});

// ==========================================
// 4. الحساب
// ==========================================
async function loadUserData(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (!doc.exists) { toast("الحساب ده اتمسح من اللعبة 🤷"); await auth.signOut(); return; }
        currentUser = { uid, ...doc.data() };
        applyUserUI();
        $('tabBar').hidden = false;
        setupRealtimeListeners();
    } catch (e) { console.error(e); toast("مشكلة في الاتصال ❌"); }
}

function applyUserUI() {
    if (!currentUser) return;
    const s = currentUser;
    $('myName').innerText = s.name;
    $('myAvatar').innerText = s.avatar;
    const g = s.gamesPlayed || 0;
    const wr = g ? Math.round(((s.lionCount || 0) / g) * 100) : 0;
    $('myStats').innerHTML = `
        <span class="stat"><b>${g}</b><small>ماتش</small></span>
        <span class="stat"><b>${s.lionCount || 0}</b><small>🦁 أسد</small></span>
        <span class="stat"><b>${s.sheepCount || 0}</b><small>🐑 خروف</small></span>
        <span class="stat"><b>${wr}%</b><small>فوز</small></span>`;
    document.body.classList.toggle('is-admin', !!s.isAdmin);
}

async function login() {
    const email = $('loginEmail').value.trim(), pass = $('loginPass').value;
    if (!email || !pass) return toast("اكتب الإيميل والباسورد");
    try { await auth.signInWithEmailAndPassword(email, pass); }
    catch (e) { toast("الإيميل أو الباسورد غلط ❌"); haptic(60); }
}

async function register() {
    const name = $('regName').value.trim(), email = $('regEmail').value.trim(), pass = $('regPass').value;
    const avatar = $('selectedAvatar').value;
    if (!name || !email || !pass) return toast("كمّل البيانات");
    if (pass.length < 6) return toast("الباسورد لازم 6 حروف على الأقل");
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection('users').doc(cred.user.uid).set({
            name, avatar, email, isAdmin: false,
            gamesPlayed: 0, lionCount: 0, tigerCount: 0, goatCount: 0, sheepCount: 0,
            createdAt: FV.serverTimestamp()
        });
        await loadUserData(cred.user.uid);
        toast(`أهلاً يا ${name} 👋`);
    } catch (e) {
        const msgs = { 'auth/email-already-in-use': 'الإيميل ده متسجل قبل كده', 'auth/invalid-email': 'الإيميل مش مظبوط', 'auth/weak-password': 'الباسورد ضعيف' };
        toast(msgs[e.code] || e.message);
    }
}

window.editMyProfile = async function () {
    const newName = await askInput({ emoji: '✏️', title: 'غيّر اسمك', value: currentUser.name });
    if (newName && newName.trim()) {
        await db.collection('users').doc(currentUser.uid).update({ name: newName.trim().slice(0, 20) });
        toast("تم تغيير الاسم ✅");
    }
};

window.logout = async function () {
    if (!(await askConfirm({ emoji: '👋', title: 'تسجيل خروج؟', yes: 'خروج' }))) return;
    cleanupListeners(); await auth.signOut(); location.reload();
};

// ==========================================
// 5. الاستماع اللحظي
// ==========================================
function cleanupListeners() { listeners.forEach(u => u()); listeners = []; }

function setupRealtimeListeners() {
    cleanupListeners();
    listeners.push(db.collection('users').onSnapshot(snap => {
        usersCache = {};
        snap.forEach(doc => usersCache[doc.id] = doc.data());
        if (currentUser && usersCache[currentUser.uid]) {
            currentUser = { uid: currentUser.uid, ...usersCache[currentUser.uid] };
            applyUserUI();
        }
        renderAll();
    }));

    gameRef().get().then(doc => { if (!doc.exists) gameRef().set(EMPTY_GAME()); });

    listeners.push(gameRef().onSnapshot(doc => {
        if (!doc.exists) return;
        gameData = doc.data();
        if (!gameData.players) gameData.players = {};
        renderAll();
        if (gameData.state === 'finished' && gameData.finalResults) {
            localFinalResults = gameData.finalResults;
            const id = String(localFinalResults.id || localFinalResults.date);
            if (!isModalOpen('certModal') && dismissedCertId !== id) showCertificate('lion');
        } else if (gameData.state === 'active') closeModal('certModal');
    }));

    const inGame = document.querySelector('.screen.active')?.id;
    if (!inGame || inGame === 'authScreen') showScreen('lobbyScreen');
}

function renderAll() {
    if (!currentUser) return;
    renderLobby();
    renderGame();
    if (isActive('tableScreen')) renderTable();
    if (isActive('fameScreen')) renderFame();
    if (scoreSheetUid && !(gameData.players || {})[scoreSheetUid]) closeSheet('scoreSheet');
}

// ==========================================
// 6. اللوبي
// ==========================================
function renderLobby() {
    const list = $('lobbyPlayersList');
    const active = gameData.players || {};
    const inGameCount = Object.keys(active).length;
    const isAdmin = !!currentUser.isAdmin;
    $('lobbyCount').innerText = `${Object.keys(usersCache).length}`;

    // بانر الماتش الشغال
    $('liveBanner').hidden = inGameCount === 0;
    $('liveInfo').innerText = `الجولة ${gameData.round || 1} • ${inGameCount} لاعبين`;
    $('gameBadge').hidden = inGameCount === 0;

    $('editModeBtn').innerText = editMode ? '✓ خلصت' : '✎ تعديل';
    $('editModeBtn').classList.toggle('on', editMode);
    $('lobbyHint').innerText = editMode ? 'غيّر الأسماء أو احذف لاعبين 👇' : 'دوس على اللاعبين عشان تختارهم للماتش';

    const uids = Object.keys(usersCache).sort((a, b) =>
        (active[a] ? 0 : 1) - (active[b] ? 0 : 1) || (usersCache[a].name || '').localeCompare(usersCache[b].name || '', 'ar'));

    list.innerHTML = uids.map(uid => {
        const u = usersCache[uid];
        const inGame = !!active[uid];
        const selected = localSelection.has(uid);
        const selectable = isAdmin && !inGame && !editMode;
        let trailing = '';
        if (editMode && isAdmin) {
            trailing = `<div class="row-actions">
                <button class="icon-btn sm" onclick="event.stopPropagation(); editPlayerName('${uid}')" aria-label="تعديل">✎</button>
                ${uid !== currentUser.uid ? `<button class="icon-btn sm danger" onclick="event.stopPropagation(); deleteUser('${uid}')" aria-label="حذف">🗑</button>` : ''}
            </div>`;
        } else if (inGame) trailing = `<span class="tag live">في الماتش</span>`;
        else if (isAdmin) trailing = `<span class="check ${selected ? 'on' : ''}">✓</span>`;

        const g = u.gamesPlayed || 0;
        return `<div class="row ${selected ? 'selected' : ''} ${selectable ? 'tappable' : ''}" ${selectable ? `onclick="toggleSelect('${uid}')"` : ''}>
            <div class="avatar">${esc(u.avatar)}</div>
            <div class="row-main">
                <div class="row-title">${esc(u.name)} ${u.isAdmin ? '<span class="mini-crown">👑</span>' : ''} ${uid === currentUser.uid ? '<span class="tag me">أنت</span>' : ''}</div>
                <div class="row-sub">${g} ماتش • 🦁 ${u.lionCount || 0} • 🐑 ${u.sheepCount || 0}</div>
            </div>
            ${trailing}
        </div>`;
    }).join('') || '<div class="empty">لسه مفيش لاعبين</div>';

    const btn = $('mainGameBtn');
    if (localSelection.size > 0) btn.innerHTML = `⚽ دخّل ${localSelection.size} للماتش`;
    else btn.innerHTML = inGameCount > 0 ? '🃏 روح للملعب' : '⚽ اختار لاعبين وابدأ';
    btn.classList.toggle('pulse', localSelection.size > 0);
    document.querySelector('.fab-wrap').hidden = editMode;
}

window.toggleSelect = uid => { haptic(); localSelection.has(uid) ? localSelection.delete(uid) : localSelection.add(uid); renderLobby(); };
window.toggleEditMode = force => { editMode = typeof force === 'boolean' ? force : !editMode; localSelection.clear(); renderLobby(); };

window.handleGameBtn = async function () {
    if (localSelection.size === 0) {
        if (Object.keys(gameData.players || {}).length) return showScreen('gameScreen');
        return toast("دوس على اللاعبين الأول 👆");
    }
    const players = gameData.players || {};
    const pIds = Object.keys(players);
    let maxTotal = pIds.length ? Math.max(...pIds.map(id => calculateTotal(players[id].scores))) : 0;
    if (!isFinite(maxTotal)) maxTotal = 0;
    const ok = await askConfirm({
        emoji: '⚽', title: `دخول ${localSelection.size} لاعب للماتش؟`,
        text: maxTotal > 0 ? `هيبدأوا بـ ${maxTotal} نقطة (زي الأخير) عشان دخلوا متأخر.` : '', yes: 'يلا'
    });
    if (!ok) return;
    const updates = {};
    localSelection.forEach(uid => updates[`players.${uid}`] = { scores: maxTotal > 0 ? { penalty: maxTotal } : {} });
    if (gameData.state !== 'active') updates.state = 'active';
    try {
        await gameRef().update(updates);
        localSelection.clear();
        toast("اتدخلوا ✅");
        showScreen('gameScreen');
    } catch (e) { console.error(e); toast("حصلت مشكلة ❌"); }
};

// ==========================================
// 7. الملعب
// ==========================================
function getSortedPlayers() {
    const players = gameData.players || {};
    return Object.keys(players).map(uid => {
        const u = usersCache[uid];
        if (!u) return null;
        const scores = players[uid].scores || {};
        return { uid, ...u, scores, total: calculateTotal(scores) };
    }).filter(Boolean).sort((a, b) => a.total - b.total || (a.name || '').localeCompare(b.name || '', 'ar'));
}

function rankOf(i, n) {
    if (n < 2) return null;
    if (i === 0) return 'lion';
    if (i === n - 1) return 'sheep';
    if (i === 1 && n > 2) return 'tiger';
    if (i === n - 2 && n > 3) return 'goat';
    return 'normal';
}

function renderGame() {
    const r = gameData.round || 1;
    $('currentRoundDisplay').innerText = r;
    $('roundPhaseDesc').innerText = PHASES[r - 1] || 'نهاية';
    $('roundDots').innerHTML = Array.from({ length: TOTAL_ROUNDS }, (_, i) =>
        `<i class="${i + 1 < r ? 'done' : ''} ${i + 1 === r ? 'cur' : ''}"></i>`).join('');

    const sorted = getSortedPlayers();
    const n = sorted.length;

    // إعلانات
    if (n >= 2) {
        const lion = sorted[0].uid, sheep = sorted[n - 1].uid;
        if (prevRanks.lion && prevRanks.lion !== lion) { toast(`🦁 الأسد الجديد: ${usersCache[lion].name}`); if (currentUser.uid === lion) playSound('soundLion'); }
        if (prevRanks.sheep && prevRanks.sheep !== sheep) { toast(`🐑 الخروف الجديد: ${usersCache[sheep].name}`); if (currentUser.uid === sheep) playSound('soundSheep'); }
        prevRanks = { lion, sheep };
    }

    // التقدم
    const entered = sorted.filter(p => p.scores[r] !== undefined).length;
    const allIn = n > 0 && entered === n;
    let prog = '';
    if (n === 0) {
        prog = `<div class="empty big"><div class="empty-emoji">🏟️</div><b>الملعب فاضي</b><small>${currentUser.isAdmin ? 'روح اللوبي واختار اللاعبين' : 'استنى الأدمن يدخّلكم'}</small>
            ${currentUser.isAdmin ? `<button class="btn btn-primary" onclick="showScreen('lobbyScreen')">اختار اللاعبين</button>` : ''}</div>`;
    } else {
        const pct = Math.round((entered / n) * 100);
        prog = `<div class="progress-card ${allIn ? 'complete' : ''}">
            <div class="ring" style="--p:${pct}"><span>${entered}/${n}</span></div>
            <div class="progress-text"><b>${allIn ? 'الكل سجّل ✅' : 'مستنيين السكور…'}</b>
            <small>${allIn ? (currentUser.isAdmin ? 'تقدر تنقل للجولة الجاية' : 'مستنيين الأدمن') : sorted.filter(p => p.scores[r] === undefined).map(p => p.name).join('، ')}</small></div>
            ${currentUser.isAdmin && allIn ? (r < TOTAL_ROUNDS
                ? `<button class="btn btn-primary sm pulse" onclick="changeRound(1)">الجولة ${r + 1} ←</button>`
                : `<button class="btn btn-gold sm pulse" onclick="finishGameAndArchive()">🏁 الشهادات</button>`) : ''}
        </div>`;
    }
    $('roundProgress').innerHTML = prog;

    // البوديوم
    const pod = $('podium');
    if (n >= 3) {
        const slot = (p, place) => `<div class="pod p${place}" onclick="openScoreSheet('${p.uid}')">
            <div class="pod-avatar">${esc(p.avatar)}<span class="pod-badge">${['', '🦁', '🐯', '🥉'][place]}</span></div>
            <div class="pod-name">${esc(p.name)}</div>
            <div class="pod-block"><b>${p.total}</b><small>${place}</small></div></div>`;
        pod.innerHTML = slot(sorted[1], 2) + slot(sorted[0], 1) + slot(sorted[2], 3);
        pod.hidden = false;
    } else { pod.hidden = true; pod.innerHTML = ''; }

    // اللستة
    $('gamePlayersContainer').innerHTML = sorted.map((p, i) => {
        const rank = rankOf(i, n);
        const saved = p.scores[r];
        const has = saved !== undefined;
        const canEdit = currentUser.uid === p.uid || currentUser.isAdmin;
        const hist = [];
        for (let k = 1; k < r; k++) hist.push(p.scores[k] !== undefined ? p.scores[k] : '–');
        const leader = sorted[0].total;
        const gap = i > 0 ? `+${p.total - leader}` : '';
        return `<div class="player ${rank ? 'r-' + rank : ''} ${p.uid === currentUser.uid ? 'me' : ''} ${canEdit ? 'tappable' : ''}" ${canEdit ? `onclick="openScoreSheet('${p.uid}')"` : ''}>
            <div class="pos">${rank && RANK_BADGE[rank] ? RANK_BADGE[rank] : i + 1}</div>
            <div class="avatar">${esc(p.avatar)}</div>
            <div class="row-main">
                <div class="row-title">${esc(p.name)}${p.uid === currentUser.uid ? ' <span class="tag me">أنت</span>' : ''}</div>
                <div class="row-sub">${rank ? stableComment(rank, p.uid, r) : ''}</div>
                <div class="totals"><span class="total"><b>${p.total}</b> مجموع</span>${gap ? `<span class="gap">${gap}</span>` : ''}${hist.length ? `<span class="hist" dir="ltr">${hist.slice(-4).join(' · ')}</span>` : ''}</div>
            </div>
            <div class="round-score ${has ? 'has' : ''} ${canEdit ? 'editable' : ''}">
                <b>${has ? saved : (canEdit ? '+' : '…')}</b>
                <small>${has ? 'الجولة' : (canEdit ? 'سجّل' : 'مستني')}</small>
            </div>
        </div>`;
    }).join('');

    if (isActive('tableScreen')) renderTable();
}

// ---------- شيت السكور ----------
window.openScoreSheet = function (uid) {
    const p = (gameData.players || {})[uid];
    if (!p) return;
    if (!(currentUser.uid === uid || currentUser.isAdmin)) return toast("مش هتقدر تعدل سكور حد تاني 😉");
    scoreSheetUid = uid;
    const r = gameData.round || 1;
    const saved = (p.scores || {})[r];
    ssValue = saved !== undefined ? String(saved) : '';
    const u = usersCache[uid] || {};
    $('ssAvatar').innerText = u.avatar || '🙂';
    $('ssName').innerText = u.name || '';
    $('ssSub').innerText = `الجولة ${r} • ${PHASES[r - 1] || ''}`;
    updateSS();
    openSheet('scoreSheet');
    haptic();
};
function updateSS() {
    $('ssValue').innerText = ssValue === '' ? '0' : ssValue;
    $('ssValue').classList.toggle('empty', ssValue === '');
    $('ssHint').innerText = ssValue === '' ? 'اكتب الرقم أو دوس على الكروت' : 'نقطة';
}
window.ssKey = function (k) {
    haptic(6);
    if (k === 'C') ssValue = '';
    else if (k === 'back') ssValue = ssValue.slice(0, -1);
    else if (ssValue.length < 3) ssValue = (ssValue === '0' ? '' : ssValue) + k;
    updateSS();
};
window.ssAdd = function (pts) {
    haptic(12);
    ssValue = String((Number(ssValue) || 0) + pts);
    updateSS();
    const d = $('ssValue'); d.classList.remove('bump'); void d.offsetWidth; d.classList.add('bump');
};
window.ssSave = () => saveFromSheet(ssValue === '' ? '0' : ssValue);
window.ssSaveZero = () => saveFromSheet('0');
window.ssClear = () => saveFromSheet('');
async function saveFromSheet(val) {
    const uid = scoreSheetUid;
    closeSheet('scoreSheet');
    try {
        await saveScore(uid, gameData.round || 1, val);
        haptic(20);
        if (val === '0') { toast(`${usersCache[uid]?.name} خلّص ورقه! 🎉`); fireConfetti(80); }
        else toast(val === '' ? "اتمسح 🗑️" : `اتحفظ ${val} ✅`);
    } catch (e) { console.error(e); toast("الحفظ فشل ❌ جرب تاني"); }
}

function stableComment(type, uid, round) {
    const list = FUNNY_COMMENTS[type] || FUNNY_COMMENTS.normal;
    let h = round * 31;
    for (const ch of uid) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    return list[h % list.length];
}

window.randomSkip = function () {
    const c = Object.keys(gameData.players || {}).filter(uid => uid !== currentUser.uid && usersCache[uid]);
    if (!c.length) return toast("مفيش حد غيرك!");
    const v = c[Math.floor(Math.random() * c.length)];
    $('skipTargetName').innerText = usersCache[v].name;
    $('skipComment').innerText = SKIP_COMMENTS[Math.floor(Math.random() * SKIP_COMMENTS.length)];
    openModal('skipModal');
    playSound('soundSkip');
    haptic([30, 40, 30]);
};

// ==========================================
// 8. الجدول
// ==========================================
function renderTable() {
    const sorted = getSortedPlayers();
    const r = gameData.round || 1;
    const hasPenalty = sorted.some(p => p.scores.penalty);
    let h = '<th class="sticky-col">اللاعب</th><th>Σ</th>';
    if (hasPenalty) h += '<th>⚖️</th>';
    for (let i = 1; i <= TOTAL_ROUNDS; i++) h += `<th class="${i === r ? 'cur' : ''}">${i}</th>`;
    document.querySelector('#scoreTable thead tr').innerHTML = h;

    const best = {};
    for (let i = 1; i <= TOTAL_ROUNDS; i++) {
        const v = sorted.map(p => p.scores[i]).filter(x => x !== undefined).map(Number);
        if (v.length > 1) best[i] = Math.min(...v);
    }
    $('tableBody').innerHTML = sorted.map((p, idx) => {
        const rank = rankOf(idx, sorted.length);
        let row = `<td class="sticky-col"><span class="t-rank">${RANK_BADGE[rank] || idx + 1}</span> ${esc(p.name)}</td><td class="t-total">${p.total}</td>`;
        if (hasPenalty) row += `<td class="muted">${p.scores.penalty || ''}</td>`;
        for (let i = 1; i <= TOTAL_ROUNDS; i++) {
            const v = p.scores[i];
            row += `<td class="${v !== undefined && best[i] !== undefined && Number(v) === best[i] ? 'best' : ''} ${i === r ? 'cur' : ''}">${v !== undefined ? v : ''}</td>`;
        }
        return `<tr class="${p.uid === currentUser.uid ? 'me' : ''}">${row}</tr>`;
    }).join('') || `<tr><td colspan="13" class="empty">مفيش ماتش شغال</td></tr>`;
}

// ==========================================
// 9. لوحة الشرف
// ==========================================
function renderFame() {
    const users = Object.entries(usersCache).map(([uid, u]) => ({ uid, ...u }))
        .sort((a, b) => (b.lionCount || 0) - (a.lionCount || 0) || (b.tigerCount || 0) - (a.tigerCount || 0)
            || (a.sheepCount || 0) - (b.sheepCount || 0) || (b.gamesPlayed || 0) - (a.gamesPlayed || 0));

    const pod = $('famePodium');
    if (users.length >= 3) {
        const slot = (u, place) => `<div class="pod p${place}">
            <div class="pod-avatar">${esc(u.avatar)}<span class="pod-badge">${['', '🥇', '🥈', '🥉'][place]}</span></div>
            <div class="pod-name">${esc(u.name)}</div>
            <div class="pod-block"><b>${u.lionCount || 0}</b><small>🦁</small></div></div>`;
        pod.innerHTML = slot(users[1], 2) + slot(users[0], 1) + slot(users[2], 3);
        pod.hidden = false;
    } else pod.hidden = true;

    $('fameList').innerHTML = users.map((u, i) => {
        const g = u.gamesPlayed || 0;
        const wr = g ? Math.round(((u.lionCount || 0) / g) * 100) : 0;
        return `<div class="row ${u.uid === currentUser.uid ? 'me' : ''}">
            <div class="pos">${i + 1}</div>
            <div class="avatar">${esc(u.avatar)}</div>
            <div class="row-main">
                <div class="row-title">${esc(u.name)}</div>
                <div class="row-sub">${g} ماتش • فوز ${wr}%</div>
                <div class="winbar"><i style="width:${wr}%"></i></div>
            </div>
            <div class="fame-stats">
                <span>🦁<b>${u.lionCount || 0}</b></span><span>🐯<b>${u.tigerCount || 0}</b></span>
                <span>🐐<b>${u.goatCount || 0}</b></span><span>🐑<b>${u.sheepCount || 0}</b></span>
            </div>
        </div>`;
    }).join('') || '<div class="empty">لسه مفيش حد</div>';
}

// ==========================================
// 10. الأدمن
// ==========================================
window.editPlayerName = async function (uid) {
    const newName = await askInput({ emoji: '✏️', title: 'تعديل اسم اللاعب', value: usersCache[uid]?.name || '' });
    if (newName && newName.trim()) {
        await db.collection('users').doc(uid).update({ name: newName.trim().slice(0, 20) });
        toast("تم تعديل الاسم ✅");
    }
};

window.deleteUser = async function (uid) {
    const u = usersCache[uid];
    if (!u) return;
    const ok = await askConfirm({
        emoji: '🗑️', title: `حذف ${u.name}؟`, danger: true, yes: 'احذف نهائياً',
        text: 'هيتمسح من اللعبة ومن لوحة الشرف ومش هيقدر يدخل تاني بنفس الحساب.'
    });
    if (!ok) return;
    try {
        if ((gameData.players || {})[uid]) await gameRef().update({ [`players.${uid}`]: FV.delete() });
        await db.collection('users').doc(uid).delete();
        localSelection.delete(uid);
        toast(`اتحذف ${u.name} 🗑️`);
        haptic(30);
    } catch (e) { console.error(e); toast("الحذف فشل ❌"); }
};

window.removeFromGame = async function (uid) {
    const u = usersCache[uid];
    const ok = await askConfirm({ emoji: '🚪', title: `إخراج ${u?.name} من الماتش؟`, text: 'السكور بتاعه في الماتش ده هيتمسح.', danger: true, yes: 'إخراج' });
    if (!ok) return;
    closeSheet('scoreSheet');
    await gameRef().update({ [`players.${uid}`]: FV.delete() });
    toast("اتشال من الماتش");
};

window.openSubSheet = function (uidOut) {
    const active = gameData.players || {};
    $('pickTitle').innerText = `🔄 مين يدخل مكان ${usersCache[uidOut]?.name}؟`;
    $('pickList').innerHTML = Object.keys(usersCache).filter(uid => !active[uid]).map(uid =>
        `<div class="row tappable" onclick="performSub('${uidOut}','${uid}')"><div class="avatar">${esc(usersCache[uid].avatar)}</div><div class="row-main"><div class="row-title">${esc(usersCache[uid].name)}</div></div><span class="tag">ياخد مكانه</span></div>`
    ).join('') || '<div class="empty">مفيش بدلاء</div>';
    closeSheet('scoreSheet');
    openSheet('pickSheet');
};
window.performSub = async function (out, inn) {
    closeSheet('pickSheet');
    const ok = await askConfirm({ emoji: '🔄', title: 'تبديل', text: `${usersCache[inn]?.name} يدخل مكان ${usersCache[out]?.name} وياخد سكوره؟`, yes: 'بدّل' });
    if (!ok) return;
    const scores = gameData.players[out]?.scores || {};
    await gameRef().update({ [`players.${out}`]: FV.delete(), [`players.${inn}`]: { scores } });
    toast("تم التبديل 🔄");
};

window.openTransferAdmin = function () {
    $('pickTitle').innerText = '🔑 اختار الأدمن الجديد';
    $('pickList').innerHTML = Object.keys(usersCache).filter(uid => uid !== currentUser.uid).map(uid =>
        `<div class="row tappable" onclick="transferAdmin('${uid}')"><div class="avatar">${esc(usersCache[uid].avatar)}</div><div class="row-main"><div class="row-title">${esc(usersCache[uid].name)}</div></div></div>`
    ).join('') || '<div class="empty">مفيش حد تاني</div>';
    closeSheet('adminSheet');
    openSheet('pickSheet');
};
window.transferAdmin = async function (uid) {
    closeSheet('pickSheet');
    if (!(await askConfirm({ emoji: '🔑', title: `نقل الأدمن لـ ${usersCache[uid].name}؟`, text: 'مش هتقدر ترجعها إلا لو هو رجعهالك.', yes: 'انقل' }))) return;
    const b = db.batch();
    b.update(db.collection('users').doc(uid), { isAdmin: true });
    b.update(db.collection('users').doc(currentUser.uid), { isAdmin: false });
    await b.commit();
    toast("الأدمن اتنقل 🔑");
};

window.cancelCurrentGame = async function () {
    closeSheet('adminSheet');
    if (!(await askConfirm({ emoji: '🧹', title: 'إلغاء الماتش الحالي؟', text: 'السكور هيتمسح ولوحة الشرف مش هتتأثر.', danger: true, yes: 'إلغاء الماتش' }))) return;
    await gameRef().set(EMPTY_GAME());
    prevRanks = { lion: null, sheep: null };
    toast("الماتش اتلغى 🧹");
};

window.resetGameCompletely = async function () {
    closeSheet('adminSheet');
    const typed = await askInput({ emoji: '☢️', title: 'تصفير المصنع', text: 'هيمسح الماتش + كل إحصائيات لوحة الشرف للكل. اكتب «مسح» للتأكيد.', placeholder: 'مسح', danger: true, yes: 'امسح كل حاجة' });
    if (typed !== 'مسح') return typed !== null && toast("اتلغى 👍");
    const b = db.batch();
    b.set(gameRef(), EMPTY_GAME());
    const snap = await db.collection('users').get();
    snap.forEach(d => b.update(d.ref, { gamesPlayed: 0, lionCount: 0, tigerCount: 0, goatCount: 0, sheepCount: 0 }));
    await b.commit();
    prevRanks = { lion: null, sheep: null };
    toast("تم التصفير ☢️");
};

// ==========================================
// 11. إنهاء الماتش والشهادات
// ==========================================
window.finishGameAndArchive = async function () {
    const sorted = getSortedPlayers();
    if (sorted.length < 2) return toast("لازم 2 على الأقل");
    const r = gameData.round || 1;
    const missing = sorted.filter(p => p.scores[r] === undefined).map(p => p.name);
    const ok = await askConfirm({
        emoji: '🏁', title: 'إنهاء الماتش وتوزيع الشهادات؟', yes: 'وزّع الشهادات',
        text: missing.length ? `⚠️ لسه مسجلوش الجولة ${r}: ${missing.join('، ')}` : `الأسد: ${sorted[0].name} • الخروف: ${sorted.at(-1).name}`
    });
    if (!ok) return;
    const n = sorted.length, lion = sorted[0], sheep = sorted[n - 1];
    const b = db.batch();
    sorted.forEach((p, i) => {
        const upd = { gamesPlayed: FV.increment(1) };
        const rank = rankOf(i, n);
        if (rank && rank !== 'normal') upd[`${rank}Count`] = FV.increment(1);
        b.update(db.collection('users').doc(p.uid), upd);
    });
    b.update(gameRef(), {
        state: 'finished',
        finalResults: {
            id: Date.now(),
            lion: { name: lion.name, total: lion.total, victims: sorted.slice(1).map(p => p.name).join(" - ") },
            sheep: { name: sheep.name, total: sheep.total, witnesses: sorted.slice(0, -1).map(p => p.name).join(" - ") },
            standings: sorted.map(p => ({ name: p.name, avatar: p.avatar, total: p.total })),
            date: new Date().toLocaleDateString('ar-EG')
        }
    });
    try { await b.commit(); localSelection.clear(); prevRanks = { lion: null, sheep: null }; }
    catch (e) { console.error(e); toast("الحفظ فشل ❌"); }
};

window.showCertificate = function (type) {
    if (!localFinalResults) return;
    const R = localFinalResults;
    const card = $('certCard');
    openModal('certModal');
    $('certDate').innerText = R.date;
    card.classList.remove('flip'); void card.offsetWidth; card.classList.add('flip');
    if (type === 'lion') {
        card.className = 'cert-card lion flip';
        $('certIcon').innerText = '🦁👑';
        $('certTitle').innerText = 'وثيقة هيمنة وسيطرة';
        $('certText').innerHTML = `نقر ونعترف نحن (ضحايا الجيم) أن<span class="cert-name">${esc(R.lion.name)}</span>${R.lion.total !== undefined ? `<small class="cert-score">${R.lion.total} نقطة بس</small>` : ''}هو عمهم وحارق دمهم، وقد فاز بجدارة واكتسح الجميع!`;
        $('certListLabel').innerText = 'على رقاب كل من';
        $('certList').innerText = R.lion.victims;
        playSound('soundLion');
        fireConfetti(220);
        $('nextCertBtn').hidden = false;
        $('nextCertBtn').onclick = () => showCertificate('sheep');
        $('closeCertBtn').hidden = true;
    } else {
        card.className = 'cert-card sheep flip';
        $('certIcon').innerText = '🐑🌿';
        $('certTitle').innerText = 'شهادة تقدير (بالخيبة)';
        $('certText').innerHTML = `تتشرف إدارة اللعبة بمنح اللاعب<span class="cert-name">${esc(R.sheep.name)}</span>${R.sheep.total !== undefined ? `<small class="cert-score">${R.sheep.total} نقطة 😬</small>` : ''}لقب «ملك البرسيم» لهذا المساء، مع تمنياتنا له بتعلم اللعب مستقبلاً!`;
        $('certListLabel').innerText = 'الشهود على الفضيحة';
        $('certList').innerText = R.sheep.witnesses;
        playSound('soundSheep');
        $('nextCertBtn').hidden = true;
        $('closeCertBtn').hidden = false;
        $('closeCertBtn').innerText = currentUser?.isAdmin ? 'قفل وابدأ ماتش جديد 🚀' : 'قفل';
    }
};

window.closeCert = async function () {
    const id = String(localFinalResults?.id || localFinalResults?.date || '');
    dismissedCertId = id;
    try { localStorage.setItem('p10_dismissedCert', id); } catch (e) {}
    closeModal('certModal');
    if (currentUser?.isAdmin) {
        await gameRef().set(EMPTY_GAME());
        showScreen('lobbyScreen');
        toast("ماتش جديد 🚀");
    } else toast("مستنيين الأدمن يبدأ ماتش جديد…");
};

// ==========================================
// 12. مساعدات
// ==========================================
function calculateTotal(s) { return Object.values(s || {}).reduce((a, b) => a + (Number(b) || 0), 0); }

window.saveScore = async function (uid, round, val) {
    await gameRef().update({ [`players.${uid}.scores.${round}`]: val === '' ? FV.delete() : Number(val) });
};

window.changeRound = async function (d) {
    if (!currentUser.isAdmin) return;
    const cur = gameData.round || 1;
    const next = Math.max(1, Math.min(TOTAL_ROUNDS, cur + d));
    if (next === cur) return;
    if (d > 0) {
        const missing = getSortedPlayers().filter(p => p.scores[cur] === undefined).map(p => p.name);
        if (missing.length && !(await askConfirm({ emoji: '⏳', title: 'في ناس لسه مسجلتش', text: missing.join('، '), yes: 'كمّل برضه' }))) return;
    }
    haptic(15);
    await gameRef().update({ round: next });
};

function playSound(id) { const a = $(id); if (a) { a.currentTime = 0; a.play().catch(() => {}); } }
function fireConfetti(n) {
    try { confetti({ particleCount: n, spread: 90, origin: { y: 0.7 }, zIndex: 5000, colors: ['#ffd166', '#a78bfa', '#f472b6', '#34d399', '#60a5fa'] }); } catch (e) {}
}

// شاشات
window.showScreen = function (id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    document.querySelectorAll('#tabBar button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    if (id === 'tableScreen') renderTable();
    if (id === 'fameScreen') renderFame();
    if (id !== 'lobbyScreen' && editMode) { editMode = false; renderLobby(); }
    window.scrollTo({ top: 0 });
};
const isActive = id => $(id)?.classList.contains('active');

// شيتات ومودالز
window.openSheet = id => { $(id).classList.add('open'); document.body.classList.add('locked'); };
window.closeSheet = id => {
    $(id).classList.remove('open');
    $(id).querySelector('.sheet-body').style.transform = '';
    if (id === 'scoreSheet') scoreSheetUid = null;
    if (!document.querySelector('.sheet.open, .modal.open')) document.body.classList.remove('locked');
};
window.openModal = id => { $(id).classList.add('open'); document.body.classList.add('locked'); };
window.closeModal = id => { $(id)?.classList.remove('open'); if (!document.querySelector('.sheet.open, .modal.open')) document.body.classList.remove('locked'); };
const isModalOpen = id => $(id)?.classList.contains('open');

function addSwipeToClose() {
    document.querySelectorAll('.sheet').forEach(sheet => {
        const body = sheet.querySelector('.sheet-body');
        let startY = null, dy = 0;
        body.addEventListener('touchstart', e => {
            if (body.scrollTop > 0 || e.target.closest('.keypad, .quick-cards, .list')) return;
            startY = e.touches[0].clientY; dy = 0; body.style.transition = 'none';
        }, { passive: true });
        body.addEventListener('touchmove', e => {
            if (startY === null) return;
            dy = Math.max(0, e.touches[0].clientY - startY);
            body.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        body.addEventListener('touchend', () => {
            if (startY === null) return;
            body.style.transition = '';
            if (dy > 110) closeSheet(sheet.id); else body.style.transform = '';
            startY = null;
        });
    });
}

// تأكيد وإدخال بشكل شيك بدل confirm/prompt
function askConfirm({ emoji = '⚠️', title = '', text = '', yes = 'تأكيد', no = 'إلغاء', danger = false, input = false, value = '', placeholder = '' }) {
    return new Promise(resolve => {
        $('confirmEmoji').innerText = emoji;
        $('confirmTitle').innerText = title;
        $('confirmText').innerText = text;
        $('confirmText').hidden = !text;
        const inp = $('confirmInput');
        inp.hidden = !input; inp.value = value; inp.placeholder = placeholder;
        $('confirmYes').innerText = yes;
        $('confirmNo').innerText = no;
        $('confirmYes').className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
        openModal('confirmModal');
        if (input) setTimeout(() => { inp.focus(); inp.select(); }, 150);
        const done = v => { closeModal('confirmModal'); $('confirmYes').onclick = $('confirmNo').onclick = inp.onkeydown = null; resolve(v); };
        $('confirmYes').onclick = () => done(input ? inp.value : true);
        $('confirmNo').onclick = () => done(input ? null : false);
        inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value); };
    });
}
const askInput = opts => askConfirm({ yes: 'حفظ', ...opts, input: true });

let toastTimer = null;
function toast(m) {
    const t = $('toast');
    t.innerText = m; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

window.toggleAuthMode = m => {
    $('loginForm').hidden = m !== 'login';
    $('registerForm').hidden = m !== 'register';
    document.querySelectorAll('#authSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    $('authSeg').dataset.mode = m;
};

function initAvatars() {
    const c = $('avatarList');
    AVATARS.forEach((a, i) => {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = `av ${i === 0 ? 'selected' : ''}`;
        s.innerText = a;
        s.onclick = () => { c.querySelectorAll('.av').forEach(x => x.classList.remove('selected')); s.classList.add('selected'); $('selectedAvatar').value = a; haptic(); };
        c.appendChild(s);
    });
}
