// ==========================================
// 1. إعدادات Firebase والاتصال
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
// 2. المتغيرات العامة
// ==========================================
const GAME_DOC_ID = "game_session_v1";
const gameRef = () => db.collection('game_session').doc(GAME_DOC_ID);
const EMPTY_GAME = () => ({ round: 1, players: {}, state: 'active' });
const TOTAL_ROUNDS = 10;

const AVATARS = ["🦁", "🐯", "🐻", "🐼", "🐨", "🐸", "🐔", "🦄", "🐉", "👽", "🤖", "🤠", "😎", "👻", "🦊", "🐺", "🦅", "🐙"];
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

let currentUser = null;
let usersCache = {};
let gameData = EMPTY_GAME();
let listeners = [];
let localSelection = new Set();
let playerToSub = null;
let prevRanks = { lion: null, sheep: null };
let localFinalResults = null;
let dismissedCertId = null;
let drafts = {};            // قيم مكتوبة لسه ما اتحفظتش (عشان الريفريش ما يمسحهاش)
let calcState = { uid: null, items: [] };

// ==========================================
// 3. البداية
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initAvatars();
    auth.onAuthStateChanged(async (user) => {
        if (user) await loadUserData(user.uid);
        else { cleanupListeners(); showScreen('authScreen'); }
    });

    // قفل المودال لما تدوس برا
    document.querySelectorAll('.modal').forEach(m => {
        if (m.id === 'certModal') return;
        m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') document.querySelectorAll('.modal.open').forEach(m => { if (m.id !== 'certModal') closeModal(m.id); });
    });
    try { dismissedCertId = localStorage.getItem('p10_dismissedCert'); } catch (e) {}
});

// ==========================================
// 4. إدارة المستخدمين
// ==========================================
async function loadUserData(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (!doc.exists) { toast("الحساب ده اتمسح 🤷"); await auth.signOut(); return; }
        currentUser = { uid, ...doc.data() };
        applyUserUI();
        setupRealtimeListeners();
    } catch (e) { console.error(e); toast("مشكلة في الاتصال ❌"); }
}

function applyUserUI() {
    if (!currentUser) return;
    document.getElementById('myName').innerText = currentUser.name;
    document.getElementById('myAvatar').innerText = currentUser.avatar;
    const s = currentUser;
    document.getElementById('myStats').innerText =
        `🎮 ${s.gamesPlayed || 0}  •  🦁 ${s.lionCount || 0}  •  🐑 ${s.sheepCount || 0}`;
    document.body.classList.toggle('is-admin', !!currentUser.isAdmin);
    document.getElementById('adminSettingsBtn').style.display = currentUser.isAdmin ? 'flex' : 'none';
    document.getElementById('adminQuickControls').style.display = currentUser.isAdmin ? 'block' : 'none';
}

async function login() {
    const email = document.getElementById('loginEmail').value.trim();
    const pass = document.getElementById('loginPass').value;
    if (!email || !pass) return toast("بيانات ناقصة ❌");
    try { await auth.signInWithEmailAndPassword(email, pass); }
    catch (e) { toast("الإيميل أو الباسورد غلط ❌"); }
}

async function register() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const pass = document.getElementById('regPass').value;
    const avatar = document.getElementById('selectedAvatar').value;
    if (!name || !email || !pass) return toast("أكمل البيانات");
    if (pass.length < 6) return toast("الباسورد لازم 6 حروف على الأقل");
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection('users').doc(cred.user.uid).set({
            name, avatar, email, isAdmin: false,
            gamesPlayed: 0, lionCount: 0, tigerCount: 0, goatCount: 0, sheepCount: 0,
            createdAt: FV.serverTimestamp()
        });
        await loadUserData(cred.user.uid);
        toast("أهلاً بيك يا " + name + " 👋");
    } catch (e) {
        const msgs = {
            'auth/email-already-in-use': 'الإيميل ده متسجل قبل كده',
            'auth/invalid-email': 'الإيميل مش مظبوط',
            'auth/weak-password': 'الباسورد ضعيف'
        };
        toast(msgs[e.code] || e.message);
    }
}

window.editMyProfile = async function () {
    const newName = prompt("أدخل اسمك الجديد:", currentUser.name);
    if (newName && newName.trim() !== "") {
        await db.collection('users').doc(currentUser.uid).update({ name: newName.trim().slice(0, 20) });
        toast("تم تغيير الاسم ✅");
    }
};

window.logout = async function () { cleanupListeners(); await auth.signOut(); location.reload(); };

// ==========================================
// 5. الاستماع اللحظي
// ==========================================
function cleanupListeners() { listeners.forEach(unsub => unsub()); listeners = []; }

function setupRealtimeListeners() {
    cleanupListeners();

    listeners.push(db.collection('users').onSnapshot(snap => {
        usersCache = {};
        snap.forEach(doc => usersCache[doc.id] = doc.data());
        if (currentUser && usersCache[currentUser.uid]) {
            const wasAdmin = currentUser.isAdmin;
            currentUser = { uid: currentUser.uid, ...usersCache[currentUser.uid] };
            applyUserUI();
            if (wasAdmin !== currentUser.isAdmin) renderGame();
        }
        renderLobby();
        renderGame();
        if (isOpen('managePlayersModal')) openManagePlayers();
        if (isOpen('fameModal')) openFameModal();
    }));

    gameRef().get().then(doc => { if (!doc.exists) gameRef().set(EMPTY_GAME()); });

    listeners.push(gameRef().onSnapshot(doc => {
        if (!doc.exists) return;
        gameData = doc.data();
        if (!gameData.players) gameData.players = {};
        renderGame();
        renderLobby();

        if (gameData.state === 'finished' && gameData.finalResults) {
            localFinalResults = gameData.finalResults;
            const id = String(localFinalResults.id || localFinalResults.date);
            if (!isOpen('certModal') && dismissedCertId !== id) showCertificate('lion');
        } else if (gameData.state === 'active') {
            closeModal('certModal');
        }
    }));

    if (!document.getElementById('gameScreen').classList.contains('active')) showScreen('lobbyScreen');
}

// ==========================================
// 6. اللوبي
// ==========================================
function renderLobby() {
    const list = document.getElementById('lobbyPlayersList');
    if (!list || !currentUser) return;

    const activePlayers = gameData.players || {};
    const inGameCount = Object.keys(activePlayers).length;
    document.getElementById('lobbyCount').innerText = `${Object.keys(usersCache).length} لاعب • ${inGameCount} بالملعب`;

    const uids = Object.keys(usersCache).sort((a, b) => {
        const ia = activePlayers[a] ? 0 : 1, ib = activePlayers[b] ? 0 : 1;
        return ia - ib || (usersCache[a].name || '').localeCompare(usersCache[b].name || '', 'ar');
    });

    list.innerHTML = uids.map(uid => {
        const u = usersCache[uid];
        const isInGame = activePlayers[uid] !== undefined;
        const isSelected = localSelection.has(uid);
        let rowClass = '', icon = '<div class="check-icon"></div>';
        if (isInGame) { rowClass = 'already-in-game'; icon = '<span class="in-game-tag">بالملعب ⚽</span>'; }
        else if (isSelected) { rowClass = 'local-selected'; icon = '<div class="check-icon">✔</div>'; }
        const clickable = currentUser.isAdmin && !isInGame;
        const action = clickable ? `onclick="toggleSelect('${uid}')"` : '';
        return `<div class="player-row ${rowClass} ${clickable ? 'clickable' : ''}" ${action}>
            <div class="row-main">
                <span class="big-emoji">${esc(u.avatar)}</span>
                <b>${esc(u.name)}</b>${u.isAdmin ? ' <span title="الأدمن">👑</span>' : ''}
                ${uid === currentUser.uid ? '<span class="me-tag">أنا</span>' : ''}
            </div>
            <div>${currentUser.isAdmin || isInGame ? icon : ''}</div>
        </div>`;
    }).join('');

    const btn = document.getElementById('mainGameBtn');
    if (localSelection.size > 0) btn.innerHTML = `⚽ إدخال (${localSelection.size}) لاعب للملعب`;
    else btn.innerHTML = inGameCount > 0 ? "⚽ روح للملعب" : "⚽ بدء المباراة";

    const amInGame = !!activePlayers[currentUser.uid];
    document.getElementById('returnToGamePanel').style.display = (amInGame || (inGameCount > 0 && !currentUser.isAdmin)) ? 'block' : 'none';
    document.getElementById('returnRoundInfo').innerText = inGameCount ? `(الجولة ${gameData.round || 1})` : '';
}

window.toggleSelect = function (uid) {
    if (localSelection.has(uid)) localSelection.delete(uid); else localSelection.add(uid);
    renderLobby();
};

window.handleGameBtn = async function () {
    if (localSelection.size === 0) return showScreen('gameScreen');

    const currentPlayers = gameData.players || {};
    const pIds = Object.keys(currentPlayers);
    let maxTotal = 0;
    if (pIds.length > 0) {
        maxTotal = Math.max(...pIds.map(id => calculateTotal(currentPlayers[id].scores || {})));
        if (!isFinite(maxTotal)) maxTotal = 0;
    }
    const lateMsg = maxTotal > 0 ? `\nهيبدأوا بـ ${maxTotal} نقطة (زي الأخير) عشان دخلوا متأخر.` : '';
    if (!confirm(`إدخال ${localSelection.size} لاعب؟${lateMsg}`)) return;

    const updates = {};
    localSelection.forEach(uid => {
        const scores = {};
        if (maxTotal > 0) scores.penalty = maxTotal;
        updates[`players.${uid}`] = { scores };
    });
    if (gameData.state !== 'active') Object.assign(updates, { state: 'active' });

    try {
        await gameRef().update(updates);
        localSelection.clear();
        toast("تم الإدخال ✅");
        showScreen('gameScreen');
    } catch (e) { console.error(e); toast("حصلت مشكلة ❌"); }
};

// ==========================================
// 7. الملعب
// ==========================================
function getSortedPlayers() {
    const playersObj = gameData.players || {};
    return Object.keys(playersObj).map(uid => {
        const uInfo = usersCache[uid];
        if (!uInfo) return null;
        const scores = playersObj[uid].scores || {};
        return { uid, ...uInfo, scores, total: calculateTotal(scores) };
    }).filter(Boolean).sort((a, b) => a.total - b.total || (a.name || '').localeCompare(b.name || '', 'ar'));
}

function rankOf(index, n) {
    if (n < 2) return null;
    if (index === 0) return 'lion';
    if (index === n - 1) return 'sheep';
    if (index === 1 && n > 2) return 'tiger';
    if (index === n - 2 && n > 3) return 'goat';
    return 'normal';
}
const RANK_BADGE = { lion: '🦁', tiger: '🐯', goat: '🐐', sheep: '🐑' };

function renderGame() {
    if (!currentUser) return;
    const r = gameData.round || 1;
    document.getElementById('currentRoundDisplay').innerText = r;
    document.getElementById('roundPhaseDesc').innerText = PHASES[r - 1] || "نهاية";
    document.getElementById('roundDots').innerHTML = Array.from({ length: TOTAL_ROUNDS }, (_, i) =>
        `<span class="dot ${i + 1 < r ? 'done' : ''} ${i + 1 === r ? 'current' : ''}"></span>`).join('');

    const container = document.getElementById('gamePlayersContainer');
    const sorted = getSortedPlayers();

    // إعلانات الأسد والخروف
    if (sorted.length >= 2) {
        const currentLion = sorted[0].uid, currentSheep = sorted[sorted.length - 1].uid;
        if (prevRanks.lion && prevRanks.lion !== currentLion) {
            toast(`🦁 الأسد الجديد: ${usersCache[currentLion].name}`);
            if (currentUser.uid === currentLion) playSound('soundLion');
        }
        if (prevRanks.sheep && prevRanks.sheep !== currentSheep) {
            toast(`🐑 الخروف الجديد: ${usersCache[currentSheep].name}`);
            if (currentUser.uid === currentSheep) playSound('soundSheep');
        }
        prevRanks = { lion: currentLion, sheep: currentSheep };
    }

    // تقدم الجولة
    const enteredCount = sorted.filter(p => p.scores[r] !== undefined).length;
    const allIn = sorted.length > 0 && enteredCount === sorted.length;
    let prog = '';
    if (sorted.length === 0) {
        prog = `<div class="empty-state">مفيش حد في الملعب لسه 🏟️<br><small>${currentUser.isAdmin ? 'ارجع للوبي ودخّل اللاعبين' : 'استنى الأدمن يدخلكم'}</small></div>`;
    } else {
        prog = `<div class="progress-bar"><div style="width:${(enteredCount / sorted.length) * 100}%"></div></div>
                <div class="progress-text">سجّل ${enteredCount} من ${sorted.length} ${allIn ? '✅' : '⏳'}</div>`;
        if (currentUser.isAdmin && allIn) {
            prog += r < TOTAL_ROUNDS
                ? `<button class="btn-primary full-width next-round-btn" onclick="changeRound(1)">➡️ كله سجّل — يلا الجولة ${r + 1}</button>`
                : `<button class="btn-success full-width next-round-btn" onclick="finishGameAndArchive()">🏁 خلصت الـ 10 جولات — وزّع الشهادات</button>`;
        }
    }
    document.getElementById('roundProgress').innerHTML = prog;

    // حفظ حالة الفوكس قبل إعادة الرسم
    const active = document.activeElement;
    const focusId = active && active.id && active.id.startsWith('score-input-') ? active.id : null;
    const selStart = focusId ? active.selectionStart : null;

    container.innerHTML = sorted.map((p, index) => {
        const rank = rankOf(index, sorted.length);
        const comment = rank ? stableComment(rank, p.uid, r) : '';
        const canEdit = currentUser.uid === p.uid || currentUser.isAdmin;
        const saved = p.scores[r];
        const entered = saved !== undefined;
        const val = drafts[p.uid] !== undefined ? drafts[p.uid] : (entered ? saved : '');
        const dirty = drafts[p.uid] !== undefined && String(drafts[p.uid]) !== String(entered ? saved : '');

        let inputHtml;
        if (canEdit) {
            inputHtml = `
            <div class="score-edit">
                <input type="number" inputmode="numeric" min="0" step="5" id="score-input-${p.uid}" class="score-input ${entered ? 'saved' : ''} ${dirty ? 'dirty' : ''}"
                    value="${esc(val)}" placeholder="-"
                    oninput="onDraft('${p.uid}', this.value)" onkeydown="if(event.key==='Enter'){this.blur(); manualSaveScore('${p.uid}', ${r});}">
                <div class="score-btns">
                    <button onclick="manualSaveScore('${p.uid}', ${r})" class="mini-btn save ${dirty ? 'attention' : ''}" title="حفظ">✅</button>
                    <button onclick="openCalc('${p.uid}')" class="mini-btn" title="احسب">🧮</button>
                </div>
            </div>`;
        } else {
            inputHtml = `<div class="score-display ${entered ? 'saved' : ''}">${entered ? esc(saved) : '⏳'}</div>`;
        }

        const subBtn = currentUser.isAdmin ? `<button onclick="openSubModal('${p.uid}')" class="link-btn" title="تبديل">🔄</button>` : '';
        const history = [];
        for (let i = 1; i < r; i++) history.push(p.scores[i] !== undefined ? p.scores[i] : '–');

        return `
        <div class="game-card ${currentUser.uid === p.uid ? 'is-me' : ''} ${rank ? 'rank-' + rank : ''}">
            ${rank && RANK_BADGE[rank] ? `<span class="badge">${RANK_BADGE[rank]}</span>` : ''}
            <div class="rank-num">${index + 1}</div>
            <div class="card-info">
                <div class="card-avatar">${esc(p.avatar)}</div>
                <div class="card-text">
                    <div class="card-name">${esc(p.name)} ${entered ? '<span class="ok-dot" title="سجّل">●</span>' : ''} ${subBtn}</div>
                    ${comment ? `<span class="card-comment">${comment}</span>` : ''}
                    <div class="card-meta">
                        <span class="card-total">المجموع <b>${p.total}</b></span>
                        ${history.length ? `<span class="card-history" dir="ltr">${history.slice(-4).join(' · ')}</span>` : ''}
                    </div>
                </div>
            </div>
            ${inputHtml}
        </div>`;
    }).join('');

    if (focusId) {
        const el = document.getElementById(focusId);
        if (el) { el.focus(); try { if (selStart !== null) el.setSelectionRange(selStart, selStart); } catch (e) {} }
    }
    if (isOpen('fullTableModal')) renderFullTable(sorted, r);
}

window.onDraft = function (uid, value) {
    drafts[uid] = value;
    const el = document.getElementById(`score-input-${uid}`);
    if (el) el.classList.add('dirty');
};

window.manualSaveScore = async function (uid, round) {
    const inputEl = document.getElementById(`score-input-${uid}`);
    const val = inputEl ? inputEl.value.trim() : (drafts[uid] ?? '');
    if (val !== '' && (isNaN(Number(val)) || Number(val) < 0)) return toast("رقم مش مظبوط ❌");
    try {
        await saveScore(uid, round, val);
        delete drafts[uid];
        if (val === '0') { toast("خلّص ورقه! 🎉"); try { confetti({ particleCount: 60, spread: 60, origin: { y: 0.8 } }); } catch (e) {} }
        else toast(val === '' ? "اتمسح السكور 🗑️" : "اتحفظ ✅");
        renderGame();
    } catch (e) { console.error(e); toast("الحفظ فشل ❌ جرب تاني"); }
};

// ---------- حاسبة الكروت ----------
window.openCalc = function (uid) {
    calcState = { uid, items: [] };
    document.getElementById('calcTitle').innerText = `🧮 ورق ${usersCache[uid]?.name || ''}`;
    updateCalc();
    openModal('calcModal');
};
window.calcAdd = function (pts, label) { calcState.items.push({ pts, label }); updateCalc(); if (navigator.vibrate) navigator.vibrate(15); };
window.calcUndo = function () { calcState.items.pop(); updateCalc(); };
function updateCalc() {
    const sum = calcState.items.reduce((a, b) => a + b.pts, 0);
    document.getElementById('calcSum').innerText = sum;
    const counts = {};
    calcState.items.forEach(i => counts[i.label] = (counts[i.label] || 0) + 1);
    const parts = Object.entries(counts).map(([l, c]) => `${c}× ${l}`);
    document.getElementById('calcBreakdown').innerText = parts.length ? parts.join('  +  ') : 'اضغط على الكروت اللي فاضلة في إيدك';
}
window.calcSave = function () {
    const sum = calcState.items.reduce((a, b) => a + b.pts, 0);
    finishCalc(String(sum));
};
window.calcSaveZero = function () { finishCalc('0'); };
function finishCalc(val) {
    const uid = calcState.uid;
    drafts[uid] = val;
    const el = document.getElementById(`score-input-${uid}`);
    if (el) el.value = val;
    closeModal('calcModal');
    manualSaveScore(uid, gameData.round || 1);
}

function playSound(id) {
    const audio = document.getElementById(id);
    if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
}

// كومنت ثابت لكل لاعب في كل جولة (مش بيتغير مع كل ريفريش)
function stableComment(type, uid, round) {
    const list = FUNNY_COMMENTS[type] || FUNNY_COMMENTS.normal;
    let h = round * 31;
    for (const ch of uid) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    return list[h % list.length];
}

window.randomSkip = function () {
    const pIds = Object.keys(gameData.players || {});
    const candidates = pIds.filter(uid => uid !== currentUser.uid && usersCache[uid]);
    if (candidates.length === 0) return toast("مفيش حد غيرك!");
    const victimUid = candidates[Math.floor(Math.random() * candidates.length)];
    document.getElementById('skipTargetName').innerText = usersCache[victimUid]?.name || "مجهول";
    document.getElementById('skipComment').innerText = SKIP_COMMENTS[Math.floor(Math.random() * SKIP_COMMENTS.length)];
    openModal('skipModal');
    playSound('soundSkip');
};

// ==========================================
// 8. لوحة الشرف
// ==========================================
window.openFameModal = function () {
    const list = document.getElementById('fameList');
    const users = Object.entries(usersCache).map(([uid, u]) => ({ uid, ...u }))
        .sort((a, b) => (b.lionCount || 0) - (a.lionCount || 0)
            || (b.tigerCount || 0) - (a.tigerCount || 0)
            || (a.sheepCount || 0) - (b.sheepCount || 0)
            || (b.gamesPlayed || 0) - (a.gamesPlayed || 0));

    if (!users.length) { list.innerHTML = '<p class="empty-state">لسه مفيش حد</p>'; }
    else {
        const medals = ['🥇', '🥈', '🥉'];
        list.innerHTML = users.map((u, i) => {
            const g = u.gamesPlayed || 0;
            const winRate = g ? Math.round(((u.lionCount || 0) / g) * 100) : 0;
            return `<div class="fame-row ${u.uid === currentUser?.uid ? 'is-me' : ''}">
                <div class="fame-pos">${medals[i] || i + 1}</div>
                <div class="fame-who"><span class="big-emoji">${esc(u.avatar)}</span><div><b>${esc(u.name)}</b><small>${g} ماتش • فوز ${winRate}%</small></div></div>
                <div class="fame-stats">
                    <span title="أسد">🦁${u.lionCount || 0}</span><span title="نمر">🐯${u.tigerCount || 0}</span>
                    <span title="معزة">🐐${u.goatCount || 0}</span><span title="خروف">🐑${u.sheepCount || 0}</span>
                </div>
            </div>`;
        }).join('');
    }
    openModal('fameModal');
};

// ==========================================
// 9. إعدادات الأدمن
// ==========================================
window.resetGameCompletely = async function () {
    if (!confirm("⚠️ تحذير نهائي: مسح اللعبة الحالية + مسح تاريخ لوحة الشرف للجميع!\nهل أنت متأكد؟")) return;
    if (prompt('اكتب "مسح" للتأكيد') !== 'مسح') return toast("اتلغى 👍");
    const batch = db.batch();
    batch.set(gameRef(), EMPTY_GAME());
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach(doc => batch.update(doc.ref, { gamesPlayed: 0, lionCount: 0, tigerCount: 0, goatCount: 0, sheepCount: 0 }));
    await batch.commit();
    drafts = {};
    prevRanks = { lion: null, sheep: null };
    toast("تم فورمات النظام بالكامل ☢️");
    closeModal('adminModal');
};

window.cancelCurrentGame = async function () {
    if (!confirm("إلغاء المباراة الحالية ومسح السكور بتاعها؟ (لوحة الشرف مش هتتأثر)")) return;
    await gameRef().set(EMPTY_GAME());
    drafts = {};
    prevRanks = { lion: null, sheep: null };
    closeModal('adminModal');
    toast("المباراة اتلغت 🧹");
};

window.openTransferAdmin = function () {
    document.getElementById('adminCandidatesList').innerHTML = Object.keys(usersCache)
        .filter(uid => uid !== currentUser.uid)
        .map(uid => `<div class="player-row clickable" onclick="transferAdmin('${uid}')"><div class="row-main"><span class="big-emoji">${esc(usersCache[uid].avatar)}</span><b>${esc(usersCache[uid].name)}</b></div></div>`)
        .join('') || '<p class="empty-state">مفيش حد تاني</p>';
    openModal('transferAdminModal');
};
window.transferAdmin = async function (newAdminUid) {
    if (!confirm(`نقل القيادة لـ ${usersCache[newAdminUid].name}؟`)) return;
    const batch = db.batch();
    batch.update(db.collection('users').doc(newAdminUid), { isAdmin: true });
    batch.update(db.collection('users').doc(currentUser.uid), { isAdmin: false });
    await batch.commit();
    location.reload();
};

window.openManagePlayers = function () {
    document.getElementById('manageList').innerHTML = Object.keys(usersCache).map(uid => {
        const u = usersCache[uid];
        return `<div class="player-row">
            <div class="row-main"><span class="big-emoji">${esc(u.avatar)}</span><b>${esc(u.name)}</b></div>
            <div class="row-actions">
                <button onclick="editPlayerName('${uid}')" class="mini-btn">✏️</button>
                ${uid !== currentUser.uid ? `<button onclick="deleteUser('${uid}')" class="mini-btn danger">🗑️</button>` : ''}
            </div>
        </div>`;
    }).join('');
    openModal('managePlayersModal');
};

window.editPlayerName = async function (uid) {
    const newName = prompt("تعديل اسم اللاعب:", usersCache[uid]?.name || '');
    if (newName && newName.trim() !== "") {
        await db.collection('users').doc(uid).update({ name: newName.trim().slice(0, 20) });
        toast("تم تعديل الاسم");
    }
};
window.deleteUser = async function (uid) {
    if (!confirm(`مسح ${usersCache[uid]?.name} نهائياً؟`)) return;
    if (gameData.players && gameData.players[uid]) await gameRef().update({ [`players.${uid}`]: FV.delete() });
    await db.collection('users').doc(uid).delete();
    toast("اتمسح 🗑️");
};

// ==========================================
// 10. إنهاء وحفظ
// ==========================================
window.finishGameAndArchive = async function () {
    const sorted = getSortedPlayers();
    if (sorted.length < 2) return toast("عدد اللاعبين قليل!");
    const r = gameData.round || 1;
    const missing = sorted.filter(p => p.scores[r] === undefined).map(p => p.name);
    let msg = "⚠️ إنهاء اللعبة وتوزيع الشهادات؟";
    if (missing.length) msg += `\n\nلسه مسجلوش الجولة ${r}: ${missing.join('، ')}`;
    if (!confirm(msg)) return;

    const n = sorted.length;
    const lion = sorted[0], sheep = sorted[n - 1];

    const batch = db.batch();
    sorted.forEach((p, index) => {
        const upd = { gamesPlayed: FV.increment(1) };
        const rank = rankOf(index, n);
        if (rank && rank !== 'normal') upd[`${rank}Count`] = FV.increment(1);
        batch.update(db.collection('users').doc(p.uid), upd);
    });

    const resultsData = {
        id: Date.now(),
        lion: { name: lion.name, total: lion.total, victims: sorted.slice(1).map(p => p.name).join(" - ") },
        sheep: { name: sheep.name, total: sheep.total, witnesses: sorted.slice(0, -1).map(p => p.name).join(" - ") },
        standings: sorted.map(p => ({ name: p.name, avatar: p.avatar, total: p.total })),
        date: new Date().toLocaleDateString('ar-EG')
    };
    batch.update(gameRef(), { state: 'finished', finalResults: resultsData });

    try {
        await batch.commit();
        localSelection.clear();
        drafts = {};
        prevRanks = { lion: null, sheep: null };
    } catch (e) { console.error(e); toast("الحفظ فشل ❌"); }
};

window.showCertificate = function (type) {
    if (!localFinalResults) return;
    const card = document.getElementById('certCard');
    const nextBtn = document.getElementById('nextCertBtn');
    const closeBtn = document.getElementById('closeCertBtn');
    const R = localFinalResults;

    openModal('certModal');
    document.getElementById('certDate').innerText = R.date;

    if (type === 'lion') {
        card.className = 'cert-card cert-theme-lion';
        document.getElementById('certIcon').innerText = '🦁👑';
        document.getElementById('certTitle').innerText = 'وثيقة هيمنة وسيطرة';
        document.getElementById('certText').innerHTML = `نقر ونعترف نحن (ضحايا الجيم) أن<br><span class="cert-name lion">${esc(R.lion.name)}</span>${R.lion.total !== undefined ? `<small class="cert-score">(${R.lion.total} نقطة بس)</small>` : ''}<br>هو عمهم وحارق دمهم، وقد فاز بجدارة واكتسح الجميع!`;
        document.getElementById('certListLabel').innerText = 'على رقاب كل من:';
        document.getElementById('certList').innerText = R.lion.victims;
        playSound('soundLion');
        try { confetti({ particleCount: 200, spread: 100, zIndex: 4000 }); } catch (e) {}
        nextBtn.style.display = 'flex';
        nextBtn.onclick = () => showCertificate('sheep');
        closeBtn.style.display = 'none';
    } else {
        card.className = 'cert-card cert-theme-sheep';
        document.getElementById('certIcon').innerText = '🐑🌿';
        document.getElementById('certTitle').innerText = 'شهادة تقدير (بالخيبة)';
        document.getElementById('certText').innerHTML = `تتشرف إدارة اللعبة بمنح اللاعب<br><span class="cert-name sheep">${esc(R.sheep.name)}</span>${R.sheep.total !== undefined ? `<small class="cert-score">(${R.sheep.total} نقطة 😬)</small>` : ''}<br>لقب "ملك البرسيم" لهذا المساء، مع تمنياتنا له بتعلم اللعب مستقبلاً!`;
        document.getElementById('certListLabel').innerText = 'الشهود على الفضيحة:';
        document.getElementById('certList').innerText = R.sheep.witnesses;
        playSound('soundSheep');
        nextBtn.style.display = 'none';
        closeBtn.style.display = 'flex';
        closeBtn.innerText = currentUser?.isAdmin ? 'إغلاق وبدء موسم جديد 🚀' : 'إغلاق';
    }
};

window.closeCert = async function () {
    const id = String(localFinalResults?.id || localFinalResults?.date || '');
    dismissedCertId = id;
    try { localStorage.setItem('p10_dismissedCert', id); } catch (e) {}
    closeModal('certModal');
    if (currentUser && currentUser.isAdmin) {
        await gameRef().set(EMPTY_GAME());
        showScreen('lobbyScreen');
        toast("تم تصفير اللعبة وبدء موسم جديد 🚀");
    } else {
        toast("في انتظار الأدمن لبدء جيم جديد...");
    }
};

// ==========================================
// 11. المساعدات
// ==========================================
function calculateTotal(s) { return Object.values(s || {}).reduce((a, b) => a + (Number(b) || 0), 0); }

window.saveScore = async function (uid, round, val) {
    const key = `players.${uid}.scores.${round}`;
    const op = val === '' ? FV.delete() : Number(val);
    await gameRef().update({ [key]: op });
};

window.changeRound = async function (d) {
    if (!currentUser.isAdmin) return;
    const cur = gameData.round || 1;
    const next = Math.max(1, Math.min(TOTAL_ROUNDS, cur + d));
    if (next === cur) return;
    if (d > 0) {
        const missing = getSortedPlayers().filter(p => p.scores[cur] === undefined).map(p => p.name);
        if (missing.length && !confirm(`لسه مسجلوش: ${missing.join('، ')}\nتكمل برضه؟`)) return;
    }
    drafts = {};
    await gameRef().update({ round: next });
};

window.openSubModal = function (uidOut) {
    playerToSub = uidOut;
    const activePlayers = gameData.players || {};
    const html = Object.keys(usersCache).filter(uid => !activePlayers[uid])
        .map(uid => `<div class="player-row clickable" onclick="performSub('${uid}')"><div class="row-main"><span class="big-emoji">${esc(usersCache[uid].avatar)}</span><b>${esc(usersCache[uid].name)}</b></div><span>⬅️ يدخل مكانه</span></div>`)
        .join('');
    document.getElementById('subCandidatesList').innerHTML = html || '<p class="empty-state">مفيش بدلاء</p>';
    openModal('subModal');
};
window.performSub = async function (uidIn) {
    if (!confirm(`${usersCache[uidIn]?.name} يدخل مكان ${usersCache[playerToSub]?.name} وياخد سكوره؟`)) return;
    const scores = gameData.players[playerToSub].scores || {};
    await gameRef().update({
        [`players.${playerToSub}`]: FV.delete(),
        [`players.${uidIn}`]: { scores }
    });
    closeModal('subModal');
};
window.removeFromGame = async function () {
    if (!playerToSub || !confirm(`إخراج ${usersCache[playerToSub]?.name} من المباراة؟ (السكور بتاعه هيتمسح)`)) return;
    await gameRef().update({ [`players.${playerToSub}`]: FV.delete() });
    closeModal('subModal');
};

window.openTableModal = () => { renderFullTable(getSortedPlayers(), gameData.round || 1); openModal('fullTableModal'); };

function renderFullTable(sorted, r) {
    const hasPenalty = sorted.some(p => p.scores.penalty);
    let h = '<th>#</th><th>اللاعب</th><th>المجموع</th>';
    if (hasPenalty) h += '<th>⚖️</th>';
    for (let i = 1; i <= TOTAL_ROUNDS; i++) h += `<th class="${i === r ? 'cur' : ''}">${i}</th>`;
    document.querySelector('#scoreTable thead tr').innerHTML = h;

    const minPerRound = {};
    for (let i = 1; i <= TOTAL_ROUNDS; i++) {
        const vals = sorted.map(p => p.scores[i]).filter(v => v !== undefined).map(Number);
        if (vals.length > 1) minPerRound[i] = Math.min(...vals);
    }
    document.getElementById('tableBody').innerHTML = sorted.map((p, idx) => {
        const rank = rankOf(idx, sorted.length);
        let row = `<td>${RANK_BADGE[rank] || idx + 1}</td><td class="name-cell">${esc(p.avatar)} ${esc(p.name)}</td><td><b>${p.total}</b></td>`;
        if (hasPenalty) row += `<td class="muted">${p.scores.penalty || ''}</td>`;
        for (let i = 1; i <= TOTAL_ROUNDS; i++) {
            const v = p.scores[i];
            const best = v !== undefined && minPerRound[i] !== undefined && Number(v) === minPerRound[i];
            row += `<td class="${best ? 'best' : ''} ${i === r ? 'cur' : ''}">${v !== undefined ? v : ''}</td>`;
        }
        return `<tr class="${p.uid === currentUser?.uid ? 'me-row' : ''}">${row}</tr>`;
    }).join('');
}

function isOpen(id) { const m = document.getElementById(id); return m && m.classList.contains('open'); }
window.openModal = id => document.getElementById(id)?.classList.add('open');
window.closeModal = id => document.getElementById(id)?.classList.remove('open');

window.showScreen = function (id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
};

let toastTimer = null;
function toast(m) {
    const t = document.getElementById('toast');
    t.innerText = m; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.toggleAuthMode = (m) => {
    document.getElementById('loginForm').style.display = m === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = m === 'register' ? 'block' : 'none';
};

function initAvatars() {
    const c = document.getElementById('avatarList');
    if (!c) return;
    AVATARS.forEach((a, i) => {
        const s = document.createElement('span');
        s.className = `av-item ${i === 0 ? 'selected' : ''}`;
        s.innerText = a;
        s.onclick = () => {
            document.querySelectorAll('.av-item').forEach(x => x.classList.remove('selected'));
            s.classList.add('selected');
            document.getElementById('selectedAvatar').value = a;
        };
        c.appendChild(s);
    });
}
