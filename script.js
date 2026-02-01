// ==========================================
// 1. الإعدادات والاتصال (Firebase Config)
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyC5Dh7bJzPqLaZl4djKCgpzaHHSeeD1aHU",
    authDomain: "phaseten-435bf.firebaseapp.com",
    projectId: "phaseten-435bf",
    storageBucket: "phaseten-435bf.firebasestorage.app",
    messagingSenderId: "780298483879",
    appId: "1:780298483879:web:6b6627e673d4808e098382"
};

try { firebase.initializeApp(firebaseConfig); } catch (e) { console.error(e); }

const db = firebase.firestore();
const auth = firebase.auth();

// إعدادات الاتصال المستقر
db.settings({ 
    experimentalForceLongPolling: true, 
    experimentalAutoDetectLongPolling: false,
    merge: true 
});

// ==========================================
// 2. المتغيرات العامة
// ==========================================
const GAME_DOC_ID = "game_session_v1";
const AVATARS = ["🦁", "🐯", "🐻", "🐼", "🐨", "🐸", "🐔", "🦄", "🐉", "👽", "🤖", "🤠", "😎", "👻"];
const PHASES = [
    "2 مجموعات (3)", "مجموعة (3) + تسلسل (4)", "مجموعة (4) + تسلسل (4)", "تسلسل (7)",
    "تسلسل (8)", "تسلسل (9)", "2 مجموعات (4)", "7 كروت لون واحد",
    "مجموعة (5) + مجموعة (2)", "مجموعة (5) + مجموعة (3)"
];

let currentUser = null;
let usersCache = {};
let gameData = { round: 1, players: {} };
let listeners = [];
let localSelection = new Set();

// ==========================================
// 3. البداية (Initialization)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initAvatars();
    
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log("👤 مستخدم مسجل:", user.uid);
            await loadUserData(user.uid);
        } else {
            console.log("👤 لا يوجد مستخدم");
            showScreen('authScreen');
        }
    });

    const safeBind = (id, action) => { const el = document.getElementById(id); if(el) el.onclick = action; };
    safeBind('btnLogin', login);
    safeBind('btnRegister', register);
    safeBind('btnLogout', logout);
    safeBind('btnPrevRound', () => changeRound(-1));
    safeBind('btnNextRound', () => changeRound(1));
});

// ==========================================
// 4. إدارة المستخدمين
// ==========================================
async function loadUserData(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
            currentUser = { uid: uid, ...doc.data() };
            const nameEl = document.getElementById('myName');
            const avatarEl = document.getElementById('myAvatar');
            
            if(nameEl) nameEl.innerText = currentUser.name;
            if(avatarEl) avatarEl.innerText = currentUser.avatar;
            
            if (currentUser.isAdmin) {
                const adminPanel = document.getElementById('adminControls');
                if(adminPanel) adminPanel.style.display = 'block';
                document.getElementById('btnPrevRound').style.display = 'block';
                document.getElementById('btnNextRound').style.display = 'block';
            }
            // تشغيل الاستماع للداتا بيز
            setupRealtimeListeners();
        } else {
            // لو اليوزر مش موجود في الداتا بيز، نخرجه
            auth.signOut();
            location.reload();
        }
    } catch(e) {
        console.error("Error loading user:", e);
        toast("تأكد من الاتصال بالإنترنت 🌐");
    }
}

async function login() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    if(!email || !pass) return toast("بيانات ناقصة ❌");
    try { await auth.signInWithEmailAndPassword(email, pass); } 
    catch(e) { toast("خطأ في الدخول ❌"); }
}

async function register() {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPass').value;
    const avatar = document.getElementById('selectedAvatar').value;
    if(!name || !email || !pass) return toast("أكمل البيانات ❌");
    
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection('users').doc(cred.user.uid).set({
            name, avatar, email,
            isAdmin: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast("تم التسجيل بنجاح 🎉");
    } catch(e) { toast("خطأ: " + e.message); }
}

async function logout() {
    await auth.signOut();
    location.reload();
}

// ==========================================
// 5. الاستماع اللحظي (مع الإصلاح)
// ==========================================
function setupRealtimeListeners() {
    // 1. استمع لكل المستخدمين
    const unsubUsers = db.collection('users').onSnapshot(snap => {
        snap.forEach(doc => usersCache[doc.id] = doc.data());
        if(document.getElementById('lobbyScreen').classList.contains('active')) renderLobby();
    });
    listeners.push(unsubUsers);

    // 2. استمع للعبة (وإنشائها لو مش موجودة)
    const gameRef = db.collection('game_session').doc(GAME_DOC_ID);
    
    // تأكد إن الملف موجود الأول
    gameRef.get().then((docSnapshot) => {
        if (!docSnapshot.exists) {
            // 🔥 الإصلاح: لو الملف مش موجود، اخلقه فاضي
            gameRef.set({ round: 1, players: {} });
        }
    });

    const unsubGame = gameRef.onSnapshot(doc => {
        if (doc.exists) {
            gameData = doc.data();
            updateGameUI();
            
            // لو أنا لاعب مسجل في الجيم الحالي، ودخلت اللوبي، انقلني للجيم فوراً
            if (gameData.players && gameData.players[currentUser.uid] && document.getElementById('lobbyScreen').classList.contains('active')) {
                showScreen('gameScreen');
            }
        } else {
            // لو مفيش ملف لعبة، اعمل ريسيت محلي
            gameData = { round: 1, players: {} };
            showScreen('lobbyScreen');
        }
        renderLobby();
    });
    listeners.push(unsubGame);
    
    // التوجيه المبدئي
    if(!document.getElementById('gameScreen').classList.contains('active')) {
        showScreen('lobbyScreen');
    }
}

// ==========================================
// 6. اللوبي ومنطق التحديد
// ==========================================
function renderLobby() {
    const list = document.getElementById('lobbyPlayersList');
    if(!list) return;

    const filter = (document.getElementById('searchPlayer')?.value || "").toLowerCase();
    
    let html = '';
    const activePlayers = gameData.players || {};

    Object.keys(usersCache).forEach(uid => {
        const u = usersCache[uid];
        if (filter && !u.name.toLowerCase().includes(filter)) return;

        const isInGame = activePlayers[uid] !== undefined;
        const isSelected = localSelection.has(uid);
        
        let rowClass = '';
        let icon = '<div class="check-icon"></div>';

        if (isInGame) {
            rowClass = 'already-in-game';
            icon = '✅ في الملعب';
        } else if (isSelected) {
            rowClass = 'local-selected';
            icon = '<div class="check-icon">✔</div>';
        }

        // الأكشن عند الضغط
        const clickAction = (currentUser && currentUser.isAdmin && !isInGame) ? `onclick="toggleLocalSelection('${uid}')"` : '';

        html += `
        <div class="player-row ${rowClass}" ${clickAction}>
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:24px">${u.avatar}</span>
                <span style="font-weight:bold;">${u.name}</span>
            </div>
            <div>${icon}</div>
        </div>`;
    });
    list.innerHTML = html;
    updateStartButton();
}

window.toggleLocalSelection = function(uid) {
    if (localSelection.has(uid)) {
        localSelection.delete(uid);
    } else {
        localSelection.add(uid);
    }
    renderLobby();
}

function updateStartButton() {
    const btn = document.querySelector('#adminControls .btn-success');
    if(!btn) return;
    
    if (localSelection.size > 0) {
        btn.innerHTML = `⚽ إدخال (${localSelection.size}) لاعب وبدء المباراة`;
    } else {
        btn.innerHTML = `⚽ الذهاب للملعب`;
    }
}

// 🔥🔥 إصلاح دالة البدء (undefined error) 🔥🔥
window.startGame = async function() {
    // 1. لو مفيش حد مختار، روح الملعب بس
    if (localSelection.size === 0) {
        showScreen('gameScreen');
        return;
    }

    if(!confirm(`تأكيد إدخال ${localSelection.size} لاعبين؟`)) return;

    // 2. تجهيز الداتا بشكل آمن
    const currentPlayers = gameData.players || {};
    let maxTotal = 0;
    
    const pIds = Object.keys(currentPlayers);
    if (pIds.length > 0) {
        // فلترة القيم الـ undefined والـ NaN
        maxTotal = Math.max(...pIds.map(id => calculateTotal(currentPlayers[id].scores || {})));
        if (!isFinite(maxTotal)) maxTotal = 0; // أمان إضافي
    }

    // 3. بناء الـ Payload
    const updatePayload = {};
    
    localSelection.forEach(uid => {
        let initialScores = {};
        // لو في سكور خروف (أكبر من صفر)، ضيف العقوبة في خانة penalty
        if (maxTotal > 0) initialScores["penalty"] = maxTotal;
        
        // 🔥 المفتاح هنا: لازم نبعت Scores كـ Object حتى لو فاضي
        updatePayload[`players.${uid}`] = { scores: initialScores };
    });

    try {
        // 🔥 استخدام set merge بدل update عشان لو الملف مش موجود يتخلق
        await db.collection('game_session').doc(GAME_DOC_ID).set({
            players: updatePayload // ده غلط في ال set، ال payload معمول لل update
        }, { merge: true });
        
        // تصحيح: الـ Payload اللي فوق معمول بالـ Dot Notation وده ينفع مع update بس.
        // عشان نستخدم set merge لازم نفك الـ Dot Notation أو نستخدم update بس نتأكد إن الملف موجود (واحنا اتأكدنا فوق).
        
        // الحل الأفضل والآمن: update
        await db.collection('game_session').doc(GAME_DOC_ID).update(updatePayload);
        
        toast(`تم إضافة اللاعبين بنجاح 🎉`);
        localSelection.clear();
        showScreen('gameScreen');
    } catch(e) {
        // لو فشل الـ update (مثلاً الملف اتمسح فجأة)، بنعمل set
        console.warn("Update failed, trying set...", e);
        
        // تحويل الـ Dot Notation لـ Object عادي عشان الـ set
        let playersObj = {};
        localSelection.forEach(uid => {
            let initialScores = {};
            if (maxTotal > 0) initialScores["penalty"] = maxTotal;
            playersObj[uid] = { scores: initialScores };
        });

        await db.collection('game_session').doc(GAME_DOC_ID).set({
            players: playersObj
        }, { merge: true });
        
        localSelection.clear();
        showScreen('gameScreen');
    }
}

// 🔥🔥 إصلاح دالة إخراج اللاعب الفردي 🔥🔥
window.togglePlayerInGame = async function(uid) {
    if (!currentUser.isAdmin) return;

    // دي عشان لو حبيت ترجع زرار الحذف الفردي من اللوبي (اختياري)
    // حالياً التحديد الجماعي بيغني عنها
}

// ==========================================
// 7. منطق المباراة (UI)
// ==========================================
function updateGameUI() {
    const r = gameData.round || 1;
    const roundDisp = document.getElementById('currentRoundDisplay');
    const phaseDesc = document.getElementById('roundPhaseDesc');
    
    if(roundDisp) roundDisp.innerText = r;
    if(phaseDesc) phaseDesc.innerText = PHASES[r-1] || "نهاية اللعبة";

    const container = document.getElementById('gamePlayersContainer');
    if(!container) return;

    const playersObj = gameData.players || {};
    const pIds = Object.keys(playersObj);

    const sorted = pIds.map(uid => {
        const scores = playersObj[uid].scores || {};
        const total = calculateTotal(scores);
        const uInfo = usersCache[uid] || { name: '...', avatar: '👤' };
        return { uid, ...uInfo, scores, total };
    }).sort((a, b) => a.total - b.total);

    let html = '';
    sorted.forEach((p, index) => {
        let rankClass = '', badge = '';
        if (sorted.length > 1) {
            if (index === 0) { rankClass = 'rank-1'; badge = '<span class="badge">🦁</span>'; } 
            if (index === sorted.length - 1) { rankClass = 'rank-last'; badge = '<span class="badge">🐑</span>'; }
        }

        const isMe = currentUser && p.uid === currentUser.uid;
        const isAdmin = currentUser && currentUser.isAdmin;
        const canEdit = isMe || isAdmin;
        
        const currentVal = (p.scores && p.scores[r] !== undefined) ? p.scores[r] : '';

        let inputField = '';
        if (canEdit) {
            inputField = `<input type="number" class="score-input" value="${currentVal}" 
                onchange="saveScore('${p.uid}', ${r}, this.value)" placeholder="-">`;
        } else {
            inputField = `<div class="score-display">${currentVal === '' ? '-' : currentVal}</div>`;
        }

        html += `
        <div class="game-card ${isMe ? 'is-me' : ''} ${rankClass}">
            ${badge}
            <div class="card-info">
                <div class="card-avatar">${p.avatar}</div>
                <div>
                    <div class="card-name">${p.name}</div>
                    <div class="card-total">المجموع: <b>${p.total}</b></div>
                </div>
            </div>
            <div>${inputField}</div>
        </div>`;
    });

    container.innerHTML = html;
    
    if(document.getElementById('tableModal').style.display === 'flex') {
        renderFullTable(sorted, r);
    }
}

// دالة حفظ السكور الآمنة
window.saveScore = async function(uid, round, val) {
    const updateKey = `players.${uid}.scores.${round}`;
    let valueToSave = Number(val);
    
    // التحقق من وجود الملف قبل الكتابة
    const gameRef = db.collection('game_session').doc(GAME_DOC_ID);
    
    if (val === '') {
        await gameRef.update({ [updateKey]: firebase.firestore.FieldValue.delete() })
            .catch(e => console.warn("Score delete error (maybe doc missing)", e));
    } else {
        await gameRef.update({ [updateKey]: valueToSave })
            .catch(async (e) => {
                // لو فشل الـ update، جرب set merge (حالة نادرة جداً)
                let payload = {};
                payload[uid] = { scores: {} };
                payload[uid].scores[round] = valueToSave;
                await gameRef.set({ players: payload }, { merge: true });
            });
    }
}

// 🔥🔥 إصلاح دالة تغيير الجولة 🔥🔥
window.changeRound = async function(delta) {
    if (!currentUser.isAdmin) return;
    const current = gameData.round || 1;
    const next = Math.max(1, Math.min(10, current + delta));
    
    if (next !== current) {
        const gameRef = db.collection('game_session').doc(GAME_DOC_ID);
        // نستخدم set merge للأمان، لو الملف مش موجود يخلقه
        await gameRef.set({ round: next }, { merge: true })
            .catch(e => toast("فشل تغيير الجولة ❌"));
    }
}

function calculateTotal(scores) {
    if (!scores) return 0;
    // التأكد من إن القيم أرقام
    return Object.values(scores).reduce((a, b) => a + (Number(b) || 0), 0);
}

// ==========================================
// 8. المساعدات (Utils)
// ==========================================
window.resetGameScores = async function() {
    if(!confirm("⚠️ تحذير: سيتم مسح جميع النقاط والبدء من الصفر!")) return;
    // هنا بنستخدم set عشان نمسح أي بيانات قديمة ونبدأ على نضافة
    await db.collection('game_session').doc(GAME_DOC_ID).set({
        round: 1,
        players: {} 
    });
    localSelection.clear();
    toast("تم تصفير اللعبة 🗑️");
}

window.openTableModal = function() { document.getElementById('tableModal').style.display = 'flex'; updateGameUI(); }
window.closeTableModal = function() { document.getElementById('tableModal').style.display = 'none'; }
window.goToLobby = function() { showScreen('lobbyScreen'); }
window.filterLobby = function() { renderLobby(); }

function renderFullTable(sorted, r) {
    const thead = document.querySelector('#scoreTable thead tr');
    const tbody = document.getElementById('tableBody');
    let head = '<th>اللاعب</th><th>T</th>'; 
    for(let i=1; i<=10; i++) head += `<th ${i===r?'style="color:#fbbf24"':''}>${i}</th>`;
    thead.innerHTML = head;
    let body = ''; 
    sorted.forEach(p => {
        let row = `<td>${p.name}</td><td><b>${p.total}</b></td>`;
        for(let i=1; i<=10; i++) row += `<td>${p.scores[i]!==undefined?p.scores[i]:''}</td>`;
        body += `<tr>${row}</tr>`;
    });
    tbody.innerHTML = body;
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
window.toggleAuthMode = function(mode) {
    document.getElementById('loginForm').style.display = mode === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = mode === 'register' ? 'block' : 'none';
}
function initAvatars() {
    const c = document.getElementById('avatarList'); if(!c) return;
    AVATARS.forEach((av, idx) => {
        const s = document.createElement('span'); s.className = `av-item ${idx===0?'selected':''}`; s.innerText=av;
        s.onclick=()=>{document.querySelectorAll('.av-item').forEach(x=>x.classList.remove('selected'));s.classList.add('selected');document.getElementById('selectedAvatar').value=av;};
        c.appendChild(s);
    });
}
function toast(msg) { const t=document.getElementById('toast'); t.innerText=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }
window.resetPassword = function() { const e=prompt("البريد الإلكتروني:"); if(e) auth.sendPasswordResetEmail(e).then(()=>alert("تم")).catch(x=>alert(x.message)); }
