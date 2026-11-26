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

const AVATARS = ["🦁", "🐯", "🐻", "🐼", "🐨", "🐸", "🐔", "🦄", "🐉", "👽", "🤖", "🤠", "😎", "👻", "🦊", "🐺", "🦅", "🐙", "🦈", "🐲", "🧔", "👑", "🔥", "⚡",
    "🐵", "🐷", "🐮", "🐰", "🐧", "🦉", "🐢", "🐊", "🦖", "🦍", "🐝", "🦋", "😂", "🤓", "🥸", "🤡", "😈", "💀", "🥷", "🧙", "🧛", "🕵️", "👨‍🚀", "🧑‍🍳", "🍕", "🌶️", "🍉", "☕", "🎯", "🎩", "🃏", "🚀", "💎", "🌚"];
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
const ROUND_LION_LINES = ["زئير يرج الترابيزة 🦁", "الملك ما بيتكلمش… بيكسب", "كله ورا الأسد يا شباب", "لسه الليلة طويلة… وأنا فوق", "خدوا بالكم، الأسد جعان"];
const ROUND_SHEEP_LINES = ["ماااااء 🐑 حد يلحقه", "البرسيم في الطريق 🌿", "الخروف بتاعنا وصل الحظيرة", "شد حيلك… أو كُل عشب", "ماااء… بيقول هيعوّضها الجولة الجاية"];
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
    $('roundModal').addEventListener('click', e => { if (e.target.id === 'roundModal') closeModal('roundModal'); });
    $('skipModal').addEventListener('click', e => { if (e.target.id === 'skipModal' && !wheelSpinning) closeModal('skipModal'); });
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

let pfSelected = null;
window.editMyProfile = function () {
    pfSelected = currentUser.avatar || AVATARS[0];
    $('pfName').value = currentUser.name || '';
    $('pfAvatar').innerText = pfSelected;
    const grid = $('pfAvatarList');
    grid.innerHTML = '';
    AVATARS.forEach(a => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `av ${a === pfSelected ? 'selected' : ''}`;
        b.innerText = a;
        b.onclick = () => {
            pfSelected = a;
            grid.querySelectorAll('.av').forEach(x => x.classList.toggle('selected', x === b));
            const p = $('pfAvatar'); p.innerText = a;
            p.classList.remove('boing'); void p.offsetWidth; p.classList.add('boing');
            haptic();
        };
        grid.appendChild(b);
    });
    openSheet('profileSheet');
};

window.saveProfile = async function () {
    const name = $('pfName').value.trim().slice(0, 20);
    if (!name) return toast("اكتب اسمك الأول");
    const upd = {};
    if (name !== currentUser.name) upd.name = name;
    if (pfSelected && pfSelected !== currentUser.avatar) upd.avatar = pfSelected;
    closeSheet('profileSheet');
    if (!Object.keys(upd).length) return;
    try {
        await db.collection('users').doc(currentUser.uid).update(upd);
        toast(upd.avatar ? `شكلك الجديد ${upd.avatar} ✅` : "تم تغيير الاسم ✅");
        haptic(20);
    } catch (e) { console.error(e); toast("الحفظ فشل ❌"); }
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
        gameLoaded = true;
        renderAll();
        onSkipSpinUpdate(gameData.skipSpin);
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
        if (prevRanks.lion && prevRanks.lion !== lion) { toast(`🦁 الأسد الجديد: ${usersCache[lion].name}`); }
        if (prevRanks.sheep && prevRanks.sheep !== sheep) { toast(`🐑 الخروف الجديد: ${usersCache[sheep].name}`); }
        prevRanks = { lion, sheep };
    }

    // إعلان الأسد والخروف لما الكل يسجّل سكور الجولة
    checkRoundResult(sorted, r);

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

// ---------- إعلان نهاية الجولة ----------
let roundShown = null;
let gameLoaded = false; // مفتاح آخر جولة اتعرض إعلانها
function checkRoundResult(sorted, r) {
    const n = sorted.length;
    // نستنى لحد ما بيانات الماتش واللاعبين يوصلوا كاملين
    if (!gameLoaded || n !== Object.keys(gameData.players || {}).length) return;
    const allIn = n >= 2 && sorted.every(p => p.scores[r] !== undefined);
    const key = `${r}|${sorted.map(p => p.uid).sort().join(',')}`;
    if (roundShown === null) { roundShown = allIn ? key : ''; return; } // أول تحميل للصفحة: ما نعيدش إعلان قديم
    if (!allIn) return;
    if (roundShown === key) return;
    roundShown = key;
    if (gameData.state !== 'active') return;
    showRoundResult(sorted, r);
}

function pickLine(list, r, uid) {
    let h = r * 17;
    for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return list[h % list.length];
}

function showRoundResult(sorted, r) {
    const lion = sorted[0], sheep = sorted[sorted.length - 1];
    $('rrTitle').innerText = `نتيجة الجولة ${r} 🃏`;
    $('rrLionAva').innerText = lion.avatar || '🦁';
    $('rrLionName').innerText = lion.name;
    $('rrLionTotal').innerText = `${lion.total} نقطة`;
    $('rrLionLine').innerText = pickLine(ROUND_LION_LINES, r, lion.uid);
    $('rrSheepAva').innerText = sheep.avatar || '🐑';
    $('rrSheepName').innerText = sheep.name;
    $('rrSheepTotal').innerText = `${sheep.total} نقطة`;
    $('rrSheepLine').innerText = pickLine(ROUND_SHEEP_LINES, r, sheep.uid);
    const card = document.querySelector('.round-card');
    card.classList.remove('go'); void card.offsetWidth; card.classList.add('go');
    closeSheet('scoreSheet');
    openModal('roundModal');
    sfxRoar(0.25);
    sfxBaa(1.9);
    haptic([40, 60, 40]);
    if (currentUser.uid === lion.uid) fireConfetti(120);
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

// ---------- عجلة السكيب ----------
const WHEEL_COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6', '#d946ef', '#84cc16', '#f97316'];
let wheelSpinning = false;

function drawWheel(names, rot) {
    const cv = $('skipWheel'), ctx = cv.getContext('2d');
    const W = cv.width, c = W / 2, R = c - 6, n = names.length, seg = (Math.PI * 2) / n;
    const font = getComputedStyle(document.body).fontFamily;
    ctx.clearRect(0, 0, W, W);
    for (let i = 0; i < n; i++) {
        // الشريحة i تبدأ من فوق (-90°) وتلف مع عقارب الساعة
        const a0 = rot - Math.PI / 2 + i * seg;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, a0, a0 + seg); ctx.closePath();
        let ci = i % WHEEL_COLORS.length;
        if (n > 1 && i === n - 1 && ci === 0) ci = 1; // ما تبقاش آخر شريحة بنفس لون الأولى
        ctx.fillStyle = WHEEL_COLORS[ci];
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 3; ctx.stroke();
        // الاسم
        ctx.save();
        const mid = a0 + seg / 2;
        const flip = Math.cos(mid) < 0; // في النص الشمال من العجلة نقلب الكلام عشان ما يبقاش بالمقلوب
        ctx.translate(c, c); ctx.rotate(flip ? mid + Math.PI : mid);
        ctx.direction = 'rtl'; ctx.textAlign = flip ? 'left' : 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        const fs = Math.max(18, Math.min(34, 260 / n + 8));
        ctx.font = `700 ${fs}px ${font}`;
        ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 4;
        let label = names[i];
        const maxW = R - 70;
        while (ctx.measureText(label).width > maxW && label.length > 2) label = label.slice(0, -1);
        if (label !== names[i]) label += '…';
        ctx.fillText(label, flip ? -(R - 18) : R - 18, 0);
        ctx.restore();
    }
}

// اللي بيدوس يختار النتيجة ويكتبها في الماتش، وكل الأجهزة (هو منهم) بتلف نفس اللفة بالظبط
let lastSpinId;
// اختيار مين يدخل العجلة قبل اللف
let skipPick = new Set();
let skipExcluded = new Set(); // بنفتكر اللي شلته المرة اللي فاتت
window.randomSkip = function () {
    if (wheelSpinning) return;
    const all = Object.keys(gameData.players || {}).filter(uid => usersCache[uid]);
    if (all.length < 2) return toast("مفيش حد غيرك!");
    // افتراضياً: الكل ما عدا أنت واللي شلتهم قبل كده
    skipPick = new Set(all.filter(uid => uid !== currentUser.uid && !skipExcluded.has(uid)));
    renderSkipPick();
    openSheet('skipPickSheet');
};

function renderSkipPick() {
    const all = Object.keys(gameData.players || {}).filter(uid => usersCache[uid])
        .sort((a, b) => (a === currentUser.uid) - (b === currentUser.uid) || (usersCache[a].name || '').localeCompare(usersCache[b].name || '', 'ar'));
    $('skipPickList').innerHTML = all.map(uid => {
        const u = usersCache[uid], on = skipPick.has(uid);
        return `<div class="row tappable ${on ? 'selected' : 'out'}" onclick="toggleSkipPick('${uid}')">
            <div class="avatar">${esc(u.avatar)}</div>
            <div class="row-main"><div class="row-title">${esc(u.name)}${uid === currentUser.uid ? ' <span class="tag me">أنت</span>' : ''}</div>
            <div class="row-sub">${on ? 'جوه العجلة 🎯' : 'برّه العجلة 😌'}</div></div>
            <span class="check ${on ? 'on' : ''}">✓</span>
        </div>`;
    }).join('');
    const n = skipPick.size;
    $('skipPickCount').innerText = `${n} في العجلة`;
    $('skipPickGo').disabled = n < 1;
    $('skipPickGo').innerText = n === 1 ? `🎯 السكيب لـ ${usersCache[[...skipPick][0]]?.name} على طول` : `🎡 لفّ العجلة (${n})`;
}
window.toggleSkipPick = uid => { haptic(); skipPick.has(uid) ? skipPick.delete(uid) : skipPick.add(uid); renderSkipPick(); };
window.skipPickAll = on => {
    haptic();
    skipPick = new Set(on ? Object.keys(gameData.players || {}).filter(uid => usersCache[uid] && uid !== currentUser.uid) : []);
    renderSkipPick();
};
window.confirmSkipPick = function () {
    if (!skipPick.size) return toast("اختار لاعب واحد على الأقل");
    const all = Object.keys(gameData.players || {}).filter(uid => usersCache[uid] && uid !== currentUser.uid);
    skipExcluded = new Set(all.filter(uid => !skipPick.has(uid)));
    closeSheet('skipPickSheet');
    startSkipSpin([...skipPick]);
};

async function startSkipSpin(c) {
    if (wheelSpinning) return;
    c = c.filter(uid => usersCache[uid]);
    if (!c.length) return toast("مفيش حد في العجلة!");
    const spin = {
        id: `${Date.now()}_${currentUser.uid}`,
        ts: Date.now(),
        by: currentUser.uid,
        byName: currentUser.name || '',
        cands: c,
        labels: c.map(uid => `${usersCache[uid].avatar || ''} ${usersCache[uid].name}`.trim()),
        names: c.map(uid => usersCache[uid].name),
        winner: Math.floor(Math.random() * c.length),
        turns: 6 + Math.floor(Math.random() * 3),
        jitter: Math.random() - 0.5,
        duration: Math.round(5200 + Math.random() * 1200),
        comment: Math.floor(Math.random() * SKIP_COMMENTS.length)
    };
    try { await gameRef().update({ skipSpin: spin }); }
    catch (e) {
        // لو الكتابة اتمنعت (مثلاً قواعد Firestore مش متحدثة) نلف عندي أنا بس
        console.error(e);
        if (lastSpinId !== spin.id) { lastSpinId = spin.id; playSkipSpin(spin); }
    }
};

function onSkipSpinUpdate(sp) {
    if (!sp || !sp.id) { if (lastSpinId === undefined) lastSpinId = null; return; }
    if (sp.id === lastSpinId) return;
    const firstLoad = lastSpinId === undefined;
    lastSpinId = sp.id;
    // أول ما الصفحة تفتح ما نعيدش لفة قديمة خلصت
    if (firstLoad && Date.now() - Number(sp.ts || 0) > (sp.duration || 6000) + 3000) return;
    playSkipSpin(sp);
}

function playSkipSpin(sp) {
    const labels = sp.labels || [];
    const n = labels.length;
    if (!n) return;
    const seg = (Math.PI * 2) / n;
    const target = (Math.PI * 2) * sp.turns - (sp.winner * seg + seg / 2 + sp.jitter * seg * 0.7);
    const duration = sp.duration;
    const myId = sp.id;

    $('skipResult').classList.remove('show');
    $('skipCloseBtn').disabled = true;
    $('skipSpinner').innerText = sp.by === currentUser?.uid ? 'أنت اللي بتلف 🎡' : `${sp.byName || 'حد'} بيلف العجلة 🎡`;
    closeSheet('scoreSheet');
    drawWheel(labels, 0);
    openModal('skipModal');
    wheelSpinning = true;

    const ease = t => 1 - Math.pow(1 - t, 4);
    let start = null, lastSeg = -1;
    const frame = ts => {
        if (lastSpinId !== myId) return; // لفة أجدد بدأت
        if (start === null) start = ts;
        const t = Math.min(1, (ts - start) / duration);
        const rot = target * ease(t);
        drawWheel(labels, rot);
        const under = Math.floor((((-rot) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / seg);
        if (under !== lastSeg) { lastSeg = under; haptic(4); }
        if (t < 1) return requestAnimationFrame(frame);
        wheelSpinning = false;
        const loser = sp.cands?.[sp.winner];
        $('skipTargetName').innerText = (loser && usersCache[loser]?.name) || sp.names?.[sp.winner] || '';
        $('skipComment').innerText = SKIP_COMMENTS[(sp.comment || 0) % SKIP_COMMENTS.length];
        $('skipSpinner').innerText = loser === currentUser?.uid ? '😱 العجلة وقفت عليك!' : `${sp.by === currentUser?.uid ? 'أنت' : (sp.byName || 'حد')} لف العجلة`;
        $('skipResult').classList.add('show');
        $('skipCloseBtn').disabled = false;
        playSound('soundSkip');
        haptic(loser === currentUser?.uid ? [60, 40, 60, 40, 60] : [30, 40, 30]);
        fireConfetti(60);
    };
    requestAnimationFrame(frame);
}

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
// نقاط لوحة الشرف: أسد +2 • نمر +1 • معزة −1 • خروف −2
// والترتيب بالمعدل (النقاط ÷ عدد الماتشات) عشان اللي لعب كتير ما ياخدش ميزة لمجرد إنه لعب كتير
const FAME_POINTS = { lion: 2, tiger: 1, goat: -1, sheep: -2 };
const FAME_MIN_GAMES = 10; // أقل من كده = لسه تحت التقييم وبيترتب بعد الباقيين
function famePoints(u) {
    return (u.lionCount || 0) * FAME_POINTS.lion + (u.tigerCount || 0) * FAME_POINTS.tiger
        + (u.goatCount || 0) * FAME_POINTS.goat + (u.sheepCount || 0) * FAME_POINTS.sheep;
}
const signed = (n, d = 0) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d);

function renderFame() {
    const users = Object.entries(usersCache).map(([uid, u]) => {
        const g = u.gamesPlayed || 0, pts = famePoints(u);
        return { uid, ...u, g, pts, avg: g ? pts / g : 0, qualified: g >= FAME_MIN_GAMES };
    }).sort((a, b) => (b.qualified - a.qualified) || b.avg - a.avg || b.pts - a.pts
        || (b.lionCount || 0) - (a.lionCount || 0) || (a.name || '').localeCompare(b.name || '', 'ar'));

    const pod = $('famePodium');
    const top = users.filter(u => u.qualified);
    if (top.length >= 3) {
        const slot = (u, place) => `<div class="pod p${place}">
            <div class="pod-avatar">${esc(u.avatar)}<span class="pod-badge">${['', '🥇', '🥈', '🥉'][place]}</span></div>
            <div class="pod-name">${esc(u.name)}</div>
            <div class="pod-block"><b dir="ltr">${signed(u.avg, 2)}</b><small>للماتش</small></div></div>`;
        pod.innerHTML = slot(top[1], 2) + slot(top[0], 1) + slot(top[2], 3);
        pod.hidden = false;
    } else pod.hidden = true;

    const maxAvg = Math.max(0.01, ...users.map(u => Math.abs(u.avg)));
    let shownDivider = false;
    $('fameList').innerHTML = users.map((u, i) => {
        const wr = u.g ? Math.round(((u.lionCount || 0) / u.g) * 100) : 0;
        const bar = Math.round((Math.abs(u.avg) / maxAvg) * 100);
        let divider = '';
        if (!u.qualified && !shownDivider) {
            shownDivider = true;
            divider = `<div class="fame-divider">لسه تحت التقييم (أقل من ${FAME_MIN_GAMES} ماتشات)</div>`;
        }
        return `${divider}<div class="row ${u.uid === currentUser.uid ? 'me' : ''} ${u.qualified ? '' : 'provisional'}">
            <div class="pos">${u.qualified ? i + 1 : '–'}</div>
            <div class="avatar">${esc(u.avatar)}</div>
            <div class="row-main">
                <div class="row-title">${esc(u.name)} <span class="fame-pts ${u.avg < 0 ? 'neg' : ''}" dir="ltr">${signed(u.avg, 2)}</span></div>
                <div class="row-sub">${signed(u.pts)} نقطة • ${u.g} ماتش • فوز ${wr}%</div>
                <div class="winbar ${u.avg < 0 ? 'neg' : ''}"><i style="width:${bar}%"></i></div>
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

// ---------- أصوات متولّدة (أسد وخروف) — بتشتغل من غير أي ملفات ----------
let actx = null;
function audioCtx() {
    try {
        if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
    return actx;
}
// المتصفحات بتطلب لمسة من المستخدم قبل أي صوت، فنفتح الصوت مع أول لمسة
['pointerdown', 'touchstart', 'keydown'].forEach(ev => document.addEventListener(ev, () => audioCtx(), { once: true, passive: true }));

function sfxRoar(at = 0) {
    const c = audioCtx(); if (!c) return;
    const t = c.currentTime + at, dur = 1.5;
    const out = c.createGain(); out.connect(c.destination);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.9, t + 0.12);
    out.gain.setValueAtTime(0.9, t + 0.5);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // زئير: ضوضاء مفلترة + موجة خشنة نازلة
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource(); noise.buffer = buf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const ng = c.createGain(); ng.gain.value = 0.7;
    noise.connect(lp).connect(ng).connect(out);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + dur);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 23; lg.gain.value = 18;
    lfo.connect(lg).connect(o.frequency);
    const sh = c.createWaveShaper(), curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 6); }
    sh.curve = curve;
    const og = c.createGain(); og.gain.value = 0.35;
    o.connect(sh).connect(og).connect(out);
    [noise, o, lfo].forEach(n => { n.start(t); n.stop(t + dur); });
}

function sfxBaa(at = 0) {
    const c = audioCtx(); if (!c) return;
    // «مااااء» مرتين بصوت مهزوز — كوميدي
    [[0, 0.75, 1], [0.85, 1.1, 0.92]].forEach(([off, dur, p]) => {
        const t = c.currentTime + at + off;
        const out = c.createGain(); out.connect(c.destination);
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
        out.gain.setValueAtTime(0.45, t + dur * 0.6);
        out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(330 * p, t);
        o.frequency.linearRampToValueAtTime(300 * p, t + dur * 0.3);
        o.frequency.linearRampToValueAtTime(270 * p, t + dur);
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = 9; lg.gain.value = 22;
        lfo.connect(lg).connect(o.frequency);
        const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 3;
        const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1350; f2.Q.value = 4;
        const g1 = c.createGain(), g2 = c.createGain(); g1.gain.value = 1.4; g2.gain.value = 0.8;
        o.connect(f1).connect(g1).connect(out);
        o.connect(f2).connect(g2).connect(out);
        [o, lfo].forEach(n => { n.start(t); n.stop(t + dur); });
    });
}

function playSound(id) {
    if (id === 'soundLion') return sfxRoar();
    if (id === 'soundSheep') return sfxBaa();
    const a = $(id); if (a) { a.currentTime = 0; a.play().catch(() => {}); }
}
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
