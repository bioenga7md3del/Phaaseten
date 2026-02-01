// ==========================================
// 1. الإعدادات والاتصال
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

db.settings({ 
    experimentalForceLongPolling: true, 
    experimentalAutoDetectLongPolling: false, 
    merge: true 
});

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
let gameData = { round: 1, players: {}, state: 'active' }; // ضفنا state عشان نعرف اللعبة خلصت ولا لأ
let listeners = [];
let localSelection = new Set();
let playerToSub = null;
let prevRanks = { lion: null, sheep: null };
// متغير محلي لتخزين النتائج للعرض
let localFinalResults = null;

// ==========================================
// 3. البداية
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initAvatars();
    auth.onAuthStateChanged(async (user) => {
        if (user) await loadUserData(user.uid);
        else showScreen('authScreen');
    });

    const click = (id, func) => { const el = document.getElementById(id); if(el) el.onclick = func; };
    click('btnLogin', login);
    click('btnRegister', register);
    click('btnLogout', logout);
    click('btnPrevRound', () => changeRound(-1));
    click('btnNextRound', () => changeRound(1));
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
                document.getElementById('adminSettingsBtn').style.display = 'block';
                document.getElementById('adminEndGamePanel').style.display = 'block';
                document.getElementById('btnPrevRound').style.display = 'block';
                document.getElementById('btnNextRound').style.display = 'block';
                document.getElementById('adminQuickControls').style.display = 'block';
            } else {
                document.getElementById('adminSettingsBtn').style.display = 'none';
                document.getElementById('adminEndGamePanel').style.display = 'none';
                document.getElementById('adminQuickControls').style.display = 'none';
            }
            setupRealtimeListeners();
        } else { auth.signOut(); location.reload(); }
    } catch(e) { console.error(e); }
}

async function login() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    if(!email||!pass) return toast("بيانات ناقصة ❌");
    try { await auth.signInWithEmailAndPassword(email, pass); } catch(e) { toast("خطأ في البيانات"); }
}

async function register() {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPass').value;
    const avatar = document.getElementById('selectedAvatar').value;
    if(!name||!email||!pass) return toast("أكمل البيانات");
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection('users').doc(cred.user.uid).set({
            name, avatar, email, isAdmin: false,
            gamesPlayed: 0, lionCount: 0, tigerCount: 0, goatCount: 0, sheepCount: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast("تم التسجيل");
    } catch(e) { toast(e.message); }
}

window.editMyProfile = async function() {
    const newName = prompt("أدخل اسمك الجديد:", currentUser.name);
    if(newName && newName.trim() !== "") {
        await db.collection('users').doc(currentUser.uid).update({ name: newName });
        document.getElementById('myName').innerText = newName;
        toast("تم تغيير الاسم ✅");
    }
}

async function logout() { await auth.signOut(); location.reload(); }

// ==========================================
// 5. الاستماع اللحظي (المعدل للمزامنة) 🔥
// ==========================================
function setupRealtimeListeners() {
    listeners.push(db.collection('users').onSnapshot(snap => {
        snap.forEach(doc => usersCache[doc.id] = doc.data());
        if(document.getElementById('lobbyScreen').classList.contains('active')) renderLobby();
        if(document.getElementById('managePlayersModal').style.display==='block') openManagePlayers();
    }));

    const gameRef = db.collection('game_session').doc(GAME_DOC_ID);
    gameRef.get().then(doc => { if(!doc.exists) gameRef.set({ round: 1, players: {}, state: 'active' }); });

    listeners.push(gameRef.onSnapshot(doc => {
        if (doc.exists) {
            gameData = doc.data();
            
            // 1. تحديث واجهة اللعبة
            updateGameUI();
            
            // 2. فحص حالة "الاحتفال" (الشهادات)
            // لو الحالة 'finished' والشهادات مش معروضة، اعرضها
            if (gameData.state === 'finished' && gameData.finalResults) {
                // حفظ النتائج محلياً عشان العرض
                localFinalResults = gameData.finalResults;
                
                // لو المودال مش مفتوح، افتحه
                if(document.getElementById('certModal').style.display !== 'flex') {
                    showCertificate('lion'); // ابدأ بعرض الأسد للكل
                }
            } else if (gameData.state === 'active') {
                // لو الحالة رجعت active، اقفل الشهادات فوراً
                document.getElementById('certModal').style.display = 'none';
            }

            // 3. زرار العودة
            const amInGame = gameData.players && gameData.players[currentUser.uid];
            const returnBtn = document.getElementById('returnToGamePanel');
            if (amInGame) returnBtn.style.display = 'block';
            else returnBtn.style.display = 'none';
        }
        renderLobby();
    }));
    
    if(!document.getElementById('gameScreen').classList.contains('active')) showScreen('lobbyScreen');
}

// ==========================================
// 6. اللوبي
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
        
        let rowClass = '', icon = '';
        if (isInGame) { rowClass = 'already-in-game'; icon = '<span style="color:var(--success)">بالملعب</span>'; }
        else if (isSelected) { rowClass = 'local-selected'; icon = '<div class="check-icon">✔</div>'; }
        else { icon = '<div class="check-icon"></div>'; }

        const action = (currentUser?.isAdmin && !isInGame) ? `onclick="toggleSelect('${uid}')"` : '';

        html += `<div class="player-row ${rowClass}" ${action}>
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:24px">${u.avatar}</span><b>${u.name}</b>
                ${u.isAdmin ? '👑' : ''}
            </div>
            <div>${icon}</div>
        </div>`;
    });
    list.innerHTML = html;
    
    const btn = document.getElementById('mainGameBtn');
    if(localSelection.size > 0) btn.innerHTML = `⚽ إدخال (${localSelection.size}) لاعب`;
    else btn.innerHTML = "⚽ بدء المباراة";
}

window.toggleSelect = function(uid) {
    if(localSelection.has(uid)) localSelection.delete(uid); else localSelection.add(uid);
    renderLobby();
}

window.handleGameBtn = async function() {
    if (localSelection.size > 0) {
        if(!confirm(`إدخال ${localSelection.size} لاعبين؟`)) return;
        const currentPlayers = gameData.players || {};
        let maxTotal = 0;
        const pIds = Object.keys(currentPlayers);
        if (pIds.length > 0) {
            maxTotal = Math.max(...pIds.map(id => calculateTotal(currentPlayers[id].scores || {})));
            if(!isFinite(maxTotal)) maxTotal = 0;
        }
        
        const updates = {};
        localSelection.forEach(uid => {
            let scores = {};
            if (maxTotal > 0) scores["penalty"] = maxTotal;
            updates[`players.${uid}`] = { scores: scores };
        });

        try {
            await db.collection('game_session').doc(GAME_DOC_ID).update(updates);
            localSelection.clear();
            toast("تم الإدخال!");
            showScreen('gameScreen');
        } catch(e) { console.error(e); }
    } else {
        showScreen('gameScreen');
    }
}

// ==========================================
// 7. الملعب
// ==========================================
function updateGameUI() {
    const r = gameData.round || 1;
    document.getElementById('currentRoundDisplay').innerText = r;
    document.getElementById('roundPhaseDesc').innerText = PHASES[r-1] || "نهاية";

    const container = document.getElementById('gamePlayersContainer');
    if(!container) return;

    const playersObj = gameData.players || {};
    const pIds = Object.keys(playersObj);

    const sorted = pIds.map(uid => {
        const scores = playersObj[uid].scores || {};
        const total = calculateTotal(scores);
        const uInfo = usersCache[uid]; 
        if (!uInfo) return null;
        return { uid, ...uInfo, scores, total };
    }).filter(p => p !== null).sort((a, b) => a.total - b.total);

    // منطق الأصوات (محلي)
    if (sorted.length >= 2) {
        const currentLion = sorted[0].uid;
        const currentSheep = sorted[sorted.length-1].uid;

        if (prevRanks.lion && prevRanks.lion !== currentLion) {
            toast(`🦁 الأسد الجديد: ${usersCache[currentLion].name}`);
            if (currentUser.uid === currentLion) { playSound('soundLion'); toast("أنت الأسد! 🦁"); }
        }
        if (prevRanks.sheep && prevRanks.sheep !== currentSheep) {
            toast(`🐑 الخروف الجديد: ${usersCache[currentSheep].name}`);
            if (currentUser.uid === currentSheep) { playSound('soundSheep'); toast("أنت الخروف! 🐑"); }
        }
        prevRanks.lion = currentLion;
        prevRanks.sheep = currentSheep;
    }

    let html = '';
    sorted.forEach((p, index) => {
        let rankClass = '', badge = '', comment = '';
        if (sorted.length >= 2) {
            if (index === 0) { 
                rankClass = 'rank-lion'; badge = '<span class="badge">🦁</span>'; 
                comment = getRandomComment('lion');
            }
            else if (index === 1 && sorted.length > 2) {
                rankClass = 'rank-tiger'; badge = '<span class="badge">🐯</span>';
                comment = getRandomComment('tiger');
            }
            else if (index === sorted.length - 1) { 
                rankClass = 'rank-sheep'; badge = '<span class="badge">🐑</span>'; 
                comment = getRandomComment('sheep');
            }
            else if (index === sorted.length - 2 && sorted.length > 3) {
                rankClass = 'rank-goat'; badge = '<span class="badge">🐐</span>';
                comment = getRandomComment('goat');
            } else {
                comment = getRandomComment('normal');
            }
        }

        const canEdit = (currentUser?.uid === p.uid) || currentUser?.isAdmin;
        const val = (p.scores && p.scores[r] !== undefined) ? p.scores[r] : '';
        
        let inputHtml = canEdit ? 
            `<input type="number" class="score-input" value="${val}" onchange="saveScore('${p.uid}', ${r}, this.value)" placeholder="-">` : 
            `<div class="score-display">${val === '' ? '-' : val}</div>`;

        let subBtn = currentUser?.isAdmin ? `<button onclick="openSubModal('${p.uid}')" class="btn-glass" style="font-size:10px; padding:5px;">🔄</button>` : '';

        html += `
        <div class="game-card ${currentUser?.uid === p.uid ? 'is-me' : ''} ${rankClass}">
            ${badge}
            <div class="card-info">
                <div class="card-avatar">${p.avatar}</div>
                <div>
                    <div class="card-name">${p.name} ${subBtn}</div>
                    <span class="card-comment">${comment}</span>
                    <div class="card-total">T: <b>${p.total}</b></div>
                </div>
            </div>
            <div>${inputHtml}</div>
        </div>`;
    });
    container.innerHTML = html;
    if(document.getElementById('fullTableModal').style.display === 'block') renderFullTable(sorted, r);
}

function playSound(id) {
    const audio = document.getElementById(id);
    if(audio) { audio.currentTime = 0; audio.play().catch(e => {}); }
}
function getRandomComment(type) {
    const list = FUNNY_COMMENTS[type] || FUNNY_COMMENTS['normal'];
    return list[Math.floor(Math.random() * list.length)];
}

window.randomSkip = function() {
    const pIds = Object.keys(gameData.players || {});
    if (pIds.length < 2) return toast("مفيش حد غيرك!");
    const candidates = pIds.filter(uid => uid !== currentUser.uid);
    if (candidates.length === 0) return;

    const victimUid = candidates[Math.floor(Math.random() * candidates.length)];
    const victimName = usersCache[victimUid]?.name || "مجهول";
    const comment = SKIP_COMMENTS[Math.floor(Math.random() * SKIP_COMMENTS.length)];

    document.getElementById('skipTargetName').innerText = victimName;
    document.getElementById('skipComment').innerText = comment;
    document.getElementById('skipModal').style.display = 'flex';
    playSound('soundSkip');
}

// ==========================================
// 8. إعدادات الأدمن
// ==========================================
window.openAdminModal = () => document.getElementById('adminModal').style.display = 'block';

window.resetGameCompletely = async function() {
    if(!confirm("⚠️ تحذير نهائي: مسح اللعبة الحالية + مسح تاريخ لوحة الشرف للجميع!\nهل أنت متأكد؟")) return;
    const batch = db.batch();
    batch.set(db.collection('game_session').doc(GAME_DOC_ID), { round: 1, players: {}, state: 'active' });
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach(doc => {
        batch.update(doc.ref, { gamesPlayed: 0, lionCount: 0, tigerCount: 0, goatCount: 0, sheepCount: 0 });
    });
    await batch.commit();
    toast("تم فورمات النظام بالكامل ☢️");
    document.getElementById('adminModal').style.display = 'none';
}

window.openTransferAdmin = function() {
    const list = document.getElementById('adminCandidatesList');
    let html = '';
    Object.keys(usersCache).forEach(uid => {
        if(uid !== currentUser.uid) {
            html += `<div class="player-row" onclick="transferAdmin('${uid}')"><span>${usersCache[uid].name}</span></div>`;
        }
    });
    list.innerHTML = html;
    document.getElementById('transferAdminModal').style.display = 'block';
}
window.transferAdmin = async function(newAdminUid) {
    if(!confirm(`نقل القيادة لـ ${usersCache[newAdminUid].name}؟`)) return;
    const batch = db.batch();
    batch.update(db.collection('users').doc(currentUser.uid), { isAdmin: false });
    batch.update(db.collection('users').doc(newAdminUid), { isAdmin: true });
    await batch.commit();
    location.reload();
}

window.openManagePlayers = function() {
    const list = document.getElementById('manageList');
    let html = '';
    Object.keys(usersCache).forEach(uid => {
        const u = usersCache[uid];
        html += `<div class="player-row" style="cursor:default"><span>${u.name}</span><div style="display:flex; gap:5px;"><button onclick="editPlayerName('${uid}', '${u.name}')" class="btn-glass" style="padding:5px;">✏️</button><button onclick="deleteUser('${uid}')" class="btn-glass" style="color:red; border:1px solid red; padding:5px;">🗑️</button></div></div>`;
    });
    list.innerHTML = html;
    document.getElementById('managePlayersModal').style.display = 'block';
}

window.editPlayerName = async function(uid, oldName) {
    const newName = prompt("تعديل اسم اللاعب:", oldName);
    if(newName && newName.trim() !== "") {
        await db.collection('users').doc(uid).update({ name: newName });
        toast("تم تعديل الاسم");
    }
}
window.deleteUser = async function(uid) {
    if(!confirm("مسح المستخدم نهائياً؟")) return;
    const update = {}; update[`players.${uid}`] = firebase.firestore.FieldValue.delete();
    db.collection('game_session').doc(GAME_DOC_ID).update(update).catch(()=>{});
    await db.collection('users').doc(uid).delete();
    openManagePlayers();
}

// ==========================================
// 9. إنهاء وحفظ (مع الشهادات المتزامنة) 🦁🌍
// ==========================================
window.finishGameAndArchive = async function() {
    if(!confirm("⚠️ إنهاء اللعبة وتوزيع الشهادات؟")) return;
    
    const playersObj = gameData.players || {};
    const pIds = Object.keys(playersObj);
    if(pIds.length < 2) return toast("عدد اللاعبين قليل!");

    const sorted = pIds.map(uid => ({
        uid, 
        name: usersCache[uid]?.name || "مجهول",
        total: calculateTotal(playersObj[uid].scores || {})
    })).sort((a, b) => a.total - b.total);

    const lion = sorted[0]; 
    const sheep = sorted[sorted.length - 1]; 
    
    const victimsNames = sorted.filter(p => p.uid !== lion.uid).map(p => p.name).join(" - ");
    const witnessesNames = sorted.filter(p => p.uid !== sheep.uid).map(p => p.name).join(" - ");

    // 1. تحديث الأرقام
    const batch = db.batch();
    pIds.forEach((uid, index) => {
        const ref = db.collection('users').doc(uid);
        batch.update(ref, { gamesPlayed: firebase.firestore.FieldValue.increment(1) });
        if (index === 0) batch.update(ref, { lionCount: firebase.firestore.FieldValue.increment(1) });
        if (index === 1 && pIds.length > 2) batch.update(ref, { tigerCount: firebase.firestore.FieldValue.increment(1) });
        if (index === pIds.length - 1) batch.update(ref, { sheepCount: firebase.firestore.FieldValue.increment(1) });
        if (index === pIds.length - 2 && pIds.length > 3) batch.update(ref, { goatCount: firebase.firestore.FieldValue.increment(1) });
    });

    // 2. تغيير حالة اللعبة إلى finished وحفظ النتائج للعرض
    const resultsData = {
        lion: { name: lion.name, victims: victimsNames },
        sheep: { name: sheep.name, witnesses: witnessesNames },
        date: new Date().toLocaleDateString('ar-EG')
    };

    // تحديث الداتا بيز (ده اللي هيشغل المودال عند الكل)
    batch.update(db.collection('game_session').doc(GAME_DOC_ID), {
        state: 'finished',
        finalResults: resultsData
    });

    await batch.commit();
    localSelection.clear();
    prevRanks = { lion: null, sheep: null };
}

// دالة عرض الشهادة (بتشتغل تلقائي من Listener)
window.showCertificate = function(type) {
    if (!localFinalResults) return; // لو مفيش نتايج، متعملش حاجة

    const modal = document.getElementById('certModal');
    const card = document.getElementById('certCard');
    const title = document.getElementById('certTitle');
    const icon = document.getElementById('certIcon');
    const text = document.getElementById('certText');
    const list = document.getElementById('certList');
    const date = document.getElementById('certDate');
    const nextBtn = document.getElementById('nextCertBtn');
    const closeBtn = document.getElementById('closeCertBtn');

    modal.style.display = 'flex';
    date.innerText = localFinalResults.date;

    if (type === 'lion') {
        // شهادة الأسد
        card.className = 'cert-card cert-theme-lion';
        icon.innerText = '🦁👑';
        title.innerText = 'وثيقة هيمنة وسيطرة';
        text.innerHTML = `نقر ونعترف نحن (ضحايا الجيم) أن<br><span style="font-size:24px; color:#d97706;">${localFinalResults.lion.name}</span><br>هو عمهم وحارق دمهم، وقد فاز بجدارة واكتسح الجميع!`;
        list.innerText = localFinalResults.lion.victims;
        
        playSound('soundLion');
        confetti({ particleCount: 200, spread: 100 });

        nextBtn.style.display = 'block';
        nextBtn.innerText = 'عرض شهادة الخروف 🐑';
        nextBtn.onclick = () => showCertificate('sheep');
        closeBtn.style.display = 'none';

    } else {
        // شهادة الخروف
        card.className = 'cert-card cert-theme-sheep';
        icon.innerText = '🐑🌿';
        title.innerText = 'شهادة تقدير (بالخيبة)';
        text.innerHTML = `تتشرف إدارة اللعبة بمنح اللاعب<br><span style="font-size:24px; color:#059669;">${localFinalResults.sheep.name}</span><br>لقب "ملك البرسيم" لهذا المساء، مع تمنياتنا له بتعلم اللعب مستقبلاً!`;
        list.innerText = `الشهود على الفضيحة: ${localFinalResults.sheep.witnesses}`;
        
        playSound('soundSheep');

        nextBtn.style.display = 'none';
        closeBtn.style.display = 'block';
    }
}

// إغلاق الشهادة وتصفير اللعبة (للأدمن فقط هو اللي بيصفر)
window.closeCert = async function() {
    document.getElementById('certModal').style.display = 'none';
    
    // لو أنا الأدمن، أنا المسؤول عن تصفير اللعبة فعلياً
    if (currentUser && currentUser.isAdmin) {
        // تصفير اللعبة وإرجاع الحالة لـ active
        await db.collection('game_session').doc(GAME_DOC_ID).set({ 
            round: 1, 
            players: {}, 
            state: 'active' 
        });
        toast("تم تصفير اللعبة وبدء موسم جديد 🚀");
    } else {
        toast("في انتظار الأدمن لبدء جيم جديد...");
    }
}

// ==========================================
// 10. المساعدات
// ==========================================
function calculateTotal(s) { return Object.values(s).reduce((a,b)=>a+(Number(b)||0),0); }
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
window.openSubModal = function(uidOut) {
    playerToSub = uidOut;
    const list = document.getElementById('subCandidatesList');
    let html = '';
    const activePlayers = gameData.players || {};
    Object.keys(usersCache).forEach(uid => {
        if (!activePlayers[uid]) html += `<div class="player-row" onclick="performSub('${uid}')"><span>${usersCache[uid].avatar} ${usersCache[uid].name}</span></div>`;
    });
    if(html==='') html='<p style="text-align:center">مفيش بدلاء</p>';
    list.innerHTML = html;
    document.getElementById('subModal').style.display = 'block';
}
window.performSub = async function(uidIn) {
    if(!confirm("تبديل؟")) return;
    const scores = gameData.players[playerToSub].scores;
    const newP = { ...gameData.players };
    delete newP[playerToSub];
    newP[uidIn] = { scores: scores };
    await db.collection('game_session').doc(GAME_DOC_ID).update({ players: newP });
    document.getElementById('subModal').style.display = 'none';
}

window.goToLobby = () => showScreen('lobbyScreen');
window.openTableModal = () => { document.getElementById('fullTableModal').style.display='block'; updateGameUI(); };
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
