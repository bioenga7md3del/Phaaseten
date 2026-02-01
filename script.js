// ==========================================
// 1. الإعدادات (Firebase)
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyC5Dh7bJzPqLaZl4djKCgpzaHHSeeD1aHU",
    authDomain: "phaseten-435bf.firebaseapp.com",
    projectId: "phaseten-435bf",
    storageBucket: "phaseten-435bf.firebasestorage.app",
    messagingSenderId: "780298483879",
    appId: "1:780298483879:web:6b6627e673d4808e098382"
};

try { firebase.initializeApp(firebaseConfig); } catch (e) {}
const db = firebase.firestore();
const auth = firebase.auth();

db.settings({ experimentalForceLongPolling: true, experimentalAutoDetectLongPolling: false, merge: true });

// ==========================================
// 2. المتغيرات
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
let playerToSub = null; // عشان نخزن مين اللي هيتبدل

// ==========================================
// 3. البداية
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initAvatars();
    auth.onAuthStateChanged(async (user) => {
        if (user) await loadUserData(user.uid);
        else showScreen('authScreen');
    });

    const safeBind = (id, action) => { const el = document.getElementById(id); if(el) el.onclick = action; };
    safeBind('btnLogin', login);
    safeBind('btnRegister', register);
    safeBind('btnLogout', logout);
    safeBind('btnPrevRound', () => changeRound(-1));
    safeBind('btnNextRound', () => changeRound(1));
});

// ==========================================
// 4. المستخدمين
// ==========================================
async function loadUserData(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
            currentUser = { uid: uid, ...doc.data() };
            document.getElementById('myName').innerText = currentUser.name;
            document.getElementById('myAvatar').innerText = currentUser.avatar;
            
            if (currentUser.isAdmin) {
                document.getElementById('adminControls').style.display = 'block';
                document.getElementById('btnPrevRound').style.display = 'block';
                document.getElementById('btnNextRound').style.display = 'block';
            }
            setupRealtimeListeners();
        } else { auth.signOut(); location.reload(); }
    } catch(e) { console.error(e); }
}

async function login() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    if(!email || !pass) return toast("بيانات ناقصة ❌");
    try { await auth.signInWithEmailAndPassword(email, pass); } catch(e) { toast("خطأ دخول"); }
}

async function register() {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPass').value;
    const avatar = document.getElementById('selectedAvatar').value;
    if(!name || !email || !pass) return toast("أكمل البيانات");
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection('users').doc(cred.user.uid).set({
            name, avatar, email, isAdmin: false,
            gamesPlayed: 0, lionCount: 0, sheepCount: 0, // عدادات التاريخ
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast("تم التسجيل");
    } catch(e) { toast(e.message); }
}

async function logout() { await auth.signOut(); location.reload(); }

// ==========================================
// 5. الاستماع وتحديث الداتا
// ==========================================
function setupRealtimeListeners() {
    // مراقب المستخدمين
    listeners.push(db.collection('users').onSnapshot(snap => {
        snap.forEach(doc => usersCache[doc.id] = doc.data());
        if(document.getElementById('lobbyScreen').classList.contains('active')) renderLobby();
    }));

    // مراقب اللعبة (مع إنشاء المستند لو مش موجود)
    const gameRef = db.collection('game_session').doc(GAME_DOC_ID);
    gameRef.get().then(doc => { if(!doc.exists) gameRef.set({ round: 1, players: {} }); });

    listeners.push(gameRef.onSnapshot(doc => {
        if (doc.exists) {
            gameData = doc.data();
            updateGameUI();
            
            // نقل اللاعب للملعب تلقائياً لو تم إضافته
            const amIInGame = gameData.players && gameData.players[currentUser.uid];
            const isInLobby = document.getElementById('lobbyScreen').classList.contains('active');
            
            if (amIInGame && isInLobby) showScreen('gameScreen');
            // لو تم طرده أو اللعبة خلصت يرجع اللوبي
            if (!amIInGame && !isInLobby && document.getElementById('gameScreen').classList.contains('active')) {
                toast("تم إخراجك أو انتهت المباراة");
                showScreen('lobbyScreen');
            }
        } else {
            gameData = { round: 1, players: {} };
            showScreen('lobbyScreen');
        }
        renderLobby();
    }));
    
    if(!document.getElementById('gameScreen').classList.contains('active')) showScreen('lobbyScreen');
}

// ==========================================
// 6. اللوبي (اختيار اللاعبين)
// ==========================================
function renderLobby() {
    const list = document.getElementById('lobbyPlayersList');
    if(!list) return;
    
    let html = '';
    const activePlayers = gameData.players || {};

    Object.keys(usersCache).forEach(uid => {
        const u = usersCache[uid];
        const isInGame = activePlayers[uid] !== undefined;
        const isSelected = localSelection.has(uid);
        
        let rowClass = '', icon = '<div class="check-icon"></div>';
        if (isInGame) { rowClass = 'already-in-game'; icon = '✅ بالملعب'; }
        else if (isSelected) { rowClass = 'local-selected'; icon = '<div class="check-icon">✔</div>'; }

        // فقط الأدمن يختار، واللاعب اللي مش في الجيم
        const action = (currentUser?.isAdmin && !isInGame) ? `onclick="toggleSelect('${uid}')"` : '';

        html += `<div class="player-row ${rowClass}" ${action}>
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:24px">${u.avatar}</span><b>${u.name}</b>
            </div>
            <div>${icon}</div>
        </div>`;
    });
    list.innerHTML = html;
    updateStartBtn();
}

window.toggleSelect = function(uid) {
    if(localSelection.has(uid)) localSelection.delete(uid); else localSelection.add(uid);
    renderLobby();
}

function updateStartBtn() {
    const btn = document.querySelector('#adminControls .btn-success');
    if(!btn) return;
    btn.innerHTML = localSelection.size > 0 ? `⚽ إدخال (${localSelection.size}) وبدء` : `⚽ الذهاب للملعب`;
}

// زر البدء (يدخل اللاعبين الجدد + يحسب الخروف)
window.startGame = async function() {
    if (localSelection.size === 0) { showScreen('gameScreen'); return; }
    if(!confirm(`إدخال ${localSelection.size} لاعبين؟`)) return;

    const currentPlayers = gameData.players || {};
    let maxTotal = 0;
    const pIds = Object.keys(currentPlayers);
    if (pIds.length > 0) {
        maxTotal = Math.max(...pIds.map(id => calculateTotal(currentPlayers[id].scores || {})));
        if (!isFinite(maxTotal)) maxTotal = 0;
    }

    const updates = {};
    localSelection.forEach(uid => {
        let scores = {};
        if (maxTotal > 0) scores["penalty"] = maxTotal; // عقوبة التأخير
        updates[`players.${uid}`] = { scores: scores };
    });

    try {
        await db.collection('game_session').doc(GAME_DOC_ID).update(updates);
        localSelection.clear();
        toast("تم!");
        showScreen('gameScreen');
    } catch(e) {
        // لو المستند مش موجود، أنشئه
        let safePayload = {};
        localSelection.forEach(uid => safePayload[uid] = { scores: maxTotal > 0 ? {penalty:maxTotal} : {} });
        await db.collection('game_session').doc(GAME_DOC_ID).set({ players: safePayload }, { merge: true });
        showScreen('gameScreen');
    }
}

// ==========================================
// 7. الملعب والتحكم
// ==========================================
function updateGameUI() {
    const r = gameData.round || 1;
    document.getElementById('currentRoundDisplay').innerText = r;
    document.getElementById('roundPhaseDesc').innerText = PHASES[r-1] || "نهاية";

    const container = document.getElementById('gamePlayersContainer');
    const playersObj = gameData.players || {};
    const pIds = Object.keys(playersObj);

    // ترتيب اللاعبين
    const sorted = pIds.map(uid => {
        const scores = playersObj[uid].scores || {};
        const total = calculateTotal(scores);
        const uInfo = usersCache[uid]; 
        if (!uInfo) return null; // 🔥 حل مشكلة الكروت الفاضية
        return { uid, ...uInfo, scores, total };
    }).filter(p => p !== null).sort((a, b) => a.total - b.total);

    let html = '';
    sorted.forEach((p, index) => {
        let rankClass = '', badge = '';
        if (sorted.length > 1) {
            if (index === 0) { rankClass = 'rank-1'; badge = '<span class="badge">🦁</span>'; } 
            if (index === sorted.length - 1) { rankClass = 'rank-last'; badge = '<span class="badge">🐑</span>'; }
        }

        const canEdit = (currentUser?.uid === p.uid) || currentUser?.isAdmin;
        const val = (p.scores && p.scores[r] !== undefined) ? p.scores[r] : '';
        
        let inputHtml = canEdit ? 
            `<input type="number" class="score-input" value="${val}" onchange="saveScore('${p.uid}', ${r}, this.value)" placeholder="-">` : 
            `<div class="score-display">${val === '' ? '-' : val}</div>`;

        // زرار التبديل للأدمن
        let subBtn = currentUser?.isAdmin ? `<button onclick="openSubModal('${p.uid}')" class="btn-glass" style="font-size:10px; padding:5px;">🔄</button>` : '';

        html += `
        <div class="game-card ${currentUser?.uid === p.uid ? 'is-me' : ''} ${rankClass}">
            ${badge}
            <div class="card-info">
                <div class="card-avatar">${p.avatar}</div>
                <div>
                    <div class="card-name">${p.name} ${subBtn}</div>
                    <div class="card-total">T: <b>${p.total}</b></div>
                </div>
            </div>
            <div>${inputHtml}</div>
        </div>`;
    });
    container.innerHTML = html;
    if(document.getElementById('tableModal').style.display === 'flex') renderFullTable(sorted, r);
}

window.saveScore = async function(uid, round, val) {
    const key = `players.${uid}.scores.${round}`;
    const op = val === '' ? firebase.firestore.FieldValue.delete() : Number(val);
    await db.collection('game_session').doc(GAME_DOC_ID).update({ [key]: op });
}

window.changeRound = async function(d) {
    if (!currentUser.isAdmin) return;
    const next = Math.max(1, Math.min(10, (gameData.round || 1) + d));
    await db.collection('game_session').doc(GAME_DOC_ID).update({ round: next });
}

// ==========================================
// 8. الميزات الجديدة (الخروج، التبديل، الحفظ)
// ==========================================

// خروج اللاعب بنفسه
window.leaveGameCompletely = async function() {
    if(!confirm("هل أنت متأكد من الخروج النهائي من المباراة؟")) return;
    const key = `players.${currentUser.uid}`;
    await db.collection('game_session').doc(GAME_DOC_ID).update({
        [key]: firebase.firestore.FieldValue.delete()
    });
    showScreen('lobbyScreen');
}

// إنهاء وحفظ (Hall of Fame) 🔥
window.finishGameAndArchive = async function() {
    if(!confirm("⚠️ هل أنت متأكد من إنهاء اللعبة وحفظ النتائج في التاريخ؟")) return;
    
    const playersObj = gameData.players || {};
    const pIds = Object.keys(playersObj);
    if(pIds.length < 2) return toast("عدد اللاعبين قليل!");

    // حساب الترتيب
    const sorted = pIds.map(uid => ({
        uid, total: calculateTotal(playersObj[uid].scores || {})
    })).sort((a, b) => a.total - b.total);

    const winner = sorted[0]; // الأسد (أقل سكور)
    const loser = sorted[sorted.length - 1]; // الخروف (أعلى سكور)

    const batch = db.batch();

    // تحديث إحصائيات كل لاعب
    pIds.forEach(uid => {
        const ref = db.collection('users').doc(uid);
        batch.update(ref, { 
            gamesPlayed: firebase.firestore.FieldValue.increment(1) 
        });
        
        if (uid === winner.uid) {
            batch.update(ref, { lionCount: firebase.firestore.FieldValue.increment(1) });
        }
        if (uid === loser.uid) {
            batch.update(ref, { sheepCount: firebase.firestore.FieldValue.increment(1) });
        }
    });

    // تصفير اللعبة
    batch.set(db.collection('game_session').doc(GAME_DOC_ID), { round: 1, players: {} });

    await batch.commit();
    toast("🏆 تم حفظ الألقاب وتصفير اللعبة!");
    localSelection.clear();
}

// التبديل (Substitution)
window.openSubModal = function(uidOut) {
    playerToSub = uidOut;
    const list = document.getElementById('subCandidatesList');
    let html = '';
    const activePlayers = gameData.players || {};
    
    // هات الناس اللي مش بتلعب بس
    Object.keys(usersCache).forEach(uid => {
        if (!activePlayers[uid]) {
            const u = usersCache[uid];
            html += `<div class="player-row" onclick="performSub('${uid}')">
                <span>${u.avatar} ${u.name}</span>
            </div>`;
        }
    });
    
    if (html === '') html = '<p style="text-align:center">لا يوجد بدلاء</p>';
    list.innerHTML = html;
    document.getElementById('subModal').style.display = 'flex';
}

window.performSub = async function(uidIn) {
    if(!confirm("تبديل اللاعبين ونقل السكور؟")) return;
    
    const currentScores = gameData.players[playerToSub].scores;
    const batch = db.batch();
    const ref = db.collection('game_session').doc(GAME_DOC_ID);
    
    // مسح القديم واضافة الجديد بنفس السكور
    // ملاحظة: في Firestore Update لازم نستخدم Dot Notation للحذف والإضافة
    // للأمان هنعملها قراءة وتحديث كامل للـ map
    
    const newPlayers = { ...gameData.players };
    delete newPlayers[playerToSub];
    newPlayers[uidIn] = { scores: currentScores };
    
    await ref.update({ players: newPlayers });
    
    document.getElementById('subModal').style.display = 'none';
    toast("تم التبديل 🔄");
}

// ==========================================
// 9. المساعدات
// ==========================================
function calculateTotal(s) { return Object.values(s).reduce((a,b)=>a+(Number(b)||0),0); }
window.goToLobby = () => showScreen('lobbyScreen');
window.openTableModal = () => { document.getElementById('tableModal').style.display='flex'; updateGameUI(); };
window.closeTableModal = () => document.getElementById('tableModal').style.display='none';
function showScreen(id) { document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function toast(m) { const t=document.getElementById('toast'); t.innerText=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }
window.toggleAuthMode = (m) => { document.getElementById('loginForm').style.display=m==='login'?'block':'none'; document.getElementById('registerForm').style.display=m==='register'?'block':'none'; };
function initAvatars(){ const c=document.getElementById('avatarList'); if(c) AVATARS.forEach((a,i)=>{const s=document.createElement('span');s.className=`av-item ${i===0?'selected':''}`;s.innerText=a;s.onclick=()=>{document.querySelectorAll('.av-item').forEach(x=>x.classList.remove('selected'));s.classList.add('selected');document.getElementById('selectedAvatar').value=a;};c.appendChild(s);}); }
function renderFullTable(sorted, r) {
    let h='<th>اللاعب</th><th>T</th>'; for(let i=1;i<=10;i++) h+=`<th ${i===r?'style="color:var(--gold)"':''}>${i}</th>`;
    document.querySelector('#scoreTable thead tr').innerHTML=h;
    let b=''; sorted.forEach(p=>{ let row=`<td>${p.name}</td><td><b>${p.total}</b></td>`; for(let i=1;i<=10;i++) row+=`<td>${p.scores[i]!==undefined?p.scores[i]:''}</td>`; b+=`<tr>${row}</tr>`; });
    document.getElementById('tableBody').innerHTML=b;
}
