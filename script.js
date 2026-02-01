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

// 🔥🔥🔥 الحل النهائي لمشكلة الاتصال 🔥🔥🔥
// بنقفل الكشف التلقائي عشان ميضربش مع الإجبار
db.settings({ 
    experimentalForceLongPolling: true, 
    experimentalAutoDetectLongPolling: false, // السطر ده هو اللي حل المشكلة
    merge: true 
});

// ==========================================
// 2. المتغيرات العامة (State)
// ==========================================
const GAME_DOC_ID = "game_session_v1"; // وثيقة اللعبة الواحدة
const AVATARS = ["🦁", "🐯", "🐻", "🐼", "🐨", "🐸", "🐔", "🦄", "🐉", "👽", "🤖", "🤠", "😎", "👻"];
const PHASES = [
    "2 مجموعات (3)", "مجموعة (3) + تسلسل (4)", "مجموعة (4) + تسلسل (4)", "تسلسل (7)",
    "تسلسل (8)", "تسلسل (9)", "2 مجموعات (4)", "7 كروت لون واحد",
    "مجموعة (5) + مجموعة (2)", "مجموعة (5) + مجموعة (3)"
];

let currentUser = null; // بياناتي أنا
let usersCache = {};    // كل المستخدمين (للسرعة)
let gameData = { round: 1, players: {} }; // بيانات اللعبة الحية
let listeners = []; // لتنظيف الذاكرة

// ==========================================
// 3. البداية (Initialization)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initAvatars();
    
    // مراقب الدخول
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log("👤 مستخدم مسجل:", user.uid);
            await loadUserData(user.uid);
        } else {
            console.log("👤 لا يوجد مستخدم");
            showScreen('authScreen');
        }
    });

    // ربط الأزرار الأساسية
    const safeBind = (id, action) => {
        const el = document.getElementById(id);
        if(el) el.onclick = action;
    };

    safeBind('btnLogin', login);
    safeBind('btnRegister', register);
    safeBind('btnLogout', logout);
    safeBind('btnPrevRound', () => changeRound(-1));
    safeBind('btnNextRound', () => changeRound(1));
});

// ==========================================
// 4. إدارة المستخدمين (Auth & Data)
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
            
            // لو أدمن، اظهر لوحة التحكم
            if (currentUser.isAdmin) {
                const adminPanel = document.getElementById('adminControls');
                if(adminPanel) adminPanel.style.display = 'block';
                document.getElementById('btnPrevRound').style.display = 'block';
                document.getElementById('btnNextRound').style.display = 'block';
            }

            // ابدأ الاستماع للتحديثات فوراً
            setupRealtimeListeners();
        } else {
            // حالة نادرة: المستخدم مسجل في Auth بس ملوش داتا
            auth.signOut();
            location.reload();
        }
    } catch(e) {
        console.error("Error loading user:", e);
        toast("خطأ في تحميل البيانات، تأكد من النت");
    }
}

async function login() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    if(!email || !pass) return toast("بيانات ناقصة ❌");
    try { await auth.signInWithEmailAndPassword(email, pass); } 
    catch(e) { toast("خطأ في الدخول: تأكد من البيانات ❌"); }
}

async function register() {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPass').value;
    const avatar = document.getElementById('selectedAvatar').value;
    
    if(!name || !email || !pass) return toast("أكمل البيانات ❌");
    
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        // حفظ بيانات المستخدم
        await db.collection('users').doc(cred.user.uid).set({
            name, avatar, email,
            isAdmin: false, // أول واحد أنت غيره مانيوال في الكونسول
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast("تم التسجيل بنجاح 🎉");
    } catch(e) { toast("خطأ: " + e.message); }
}

async function logout() {
    await auth.signOut();
    currentUser = null;
    listeners.forEach(unsub => unsub()); // وقف الاستماع
    location.reload(); // ريفرش للنضافة
}

// ==========================================
// 5. الاستماع اللحظي (The Core Logic) 🧠
// ==========================================
function setupRealtimeListeners() {
    // 1. استمع لكل المستخدمين (عشان اللوبي)
    const unsubUsers = db.collection('users').onSnapshot(snap => {
        snap.forEach(doc => usersCache[doc.id] = doc.data());
        // لو احنا في اللوبي، حدث القائمة
        if(document.getElementById('lobbyScreen').classList.contains('active')) {
            renderLobby();
        }
    });
    listeners.push(unsubUsers);

    // 2. استمع لبيانات اللعبة (الجولة والسكورات)
    const unsubGame = db.collection('game_session').doc(GAME_DOC_ID)
        .onSnapshot(doc => {
            if (doc.exists) {
                gameData = doc.data();
                // لو أنا في اللعبة، حدث الشاشة
                updateGameUI(); 
                
                // لو أنا لسه داخل ولقيت نفسي في اللعبة، انقلني للملعب
                if (gameData.players && gameData.players[currentUser.uid] && document.getElementById('lobbyScreen').classList.contains('active')) {
                    showScreen('gameScreen');
                }
            } else {
                // اللعبة اتصفرت أو لسه بتبدأ
                gameData = { round: 1, players: {} };
                showScreen('lobbyScreen');
            }
            renderLobby(); // عشان نحدث علامة "مين بيلعب"
        });
    listeners.push(unsubGame);
    
    // افتراضياً ادخل اللوبي لو مفيش توجيه تاني
    if(!document.getElementById('gameScreen').classList.contains('active')) {
        showScreen('lobbyScreen');
    }
}

// ==========================================
// 6. منطق اللوبي والتحكم (Admin Logic)
// ==========================================
function renderLobby() {
    const list = document.getElementById('lobbyPlayersList');
    if(!list) return;

    const filterInput = document.getElementById('searchPlayer');
    const filter = filterInput ? filterInput.value.toLowerCase() : "";
    
    let html = '';
    const activePlayers = gameData.players || {};

    Object.keys(usersCache).forEach(uid => {
        const u = usersCache[uid];
        if (filter && !u.name.toLowerCase().includes(filter)) return;

        const isActive = activePlayers[uid] !== undefined;
        const statusIcon = isActive ? '✅' : '💤';
        const rowClass = isActive ? 'active-in-game' : '';
        
        // زرار التبديل (للأدمن فقط)
        let toggleBtn = '';
        if (currentUser && currentUser.isAdmin) {
            toggleBtn = `<div class="switch-toggle" onclick="togglePlayerInGame('${uid}')">${isActive ? '🟢' : '⚪'}</div>`;
        } else {
            toggleBtn = `<div>${statusIcon}</div>`;
        }

        html += `
        <div class="player-row ${rowClass}">
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:24px">${u.avatar}</span>
                <span style="font-weight:bold;">${u.name}</span>
            </div>
            ${toggleBtn}
        </div>`;
    });
    list.innerHTML = html;
}

// 🔥🔥 أهم دالة: إضافة لاعب + حسبة الخروف 🔥🔥
async function togglePlayerInGame(uid) {
    if (!currentUser.isAdmin) return;

    // نسخة محلية للتعديل
    let currentPlayers = gameData.players || {};
    
    // عشان نتأكد إننا مش بنمسح داتا قديمة بالغلط، لازم ناخد نسخة
    // (في الفايربيز التحديث بيبقى دقيق، بس هنا بنحسب لوجيك)
    
    if (currentPlayers[uid]) {
        // إخراج اللاعب
        if(!confirm("هل تريد إخراج هذا اللاعب من المباراة؟")) return;
        
        // الطريقة الصحيحة لحذف حقل في Firestore
        const updatePayload = {};
        updatePayload[`players.${uid}`] = firebase.firestore.FieldValue.delete();
        
        await db.collection('game_session').doc(GAME_DOC_ID).update(updatePayload);
        
    } else {
        // إدخال لاعب جديد
        let maxTotal = 0;
        const pIds = Object.keys(currentPlayers);
        
        // حساب أعلى سكور حالي
        if (pIds.length > 0) {
            maxTotal = Math.max(...pIds.map(id => calculateTotal(currentPlayers[id].scores)));
        }

        let initialScores = {};
        // لو اللعبة شغالة (في ناس وليهم سكور)، ضيف العقوبة
        if (maxTotal > 0) {
            // بنسجل العقوبة في خانة خاصة اسمها "penalty" عشان متدخلش في الجولات
            initialScores["penalty"] = maxTotal; 
            toast(`تم دخول اللاعب بسكور الخروف: ${maxTotal} 🐑`);
        } else {
            toast("تم إضافة اللاعب للمباراة ✅");
        }

        // تحديث الداتا بيز
        const updatePayload = {};
        updatePayload[`players.${uid}`] = { scores: initialScores };
        
        await db.collection('game_session').doc(GAME_DOC_ID).set({
            players: updatePayload[`players`] // هنا بنستخدم merge عشان منمسحش القديم
        }, { merge: true });
        
        // تصحيح: الطريقة اللي فوق معقدة شوية مع الـ merge في nested objects
        // الأسهل نقرأ ونكتب الكل لو العدد صغير، أو نستخدم Dot Notation
        // الطريقة الأضمن:
        db.collection('game_session').doc(GAME_DOC_ID).update({
            [`players.${uid}`]: { scores: initialScores }
        });
    }
}

// Helper to start game
window.startGame = function() {
    showScreen('gameScreen');
}

// Helper for reset
window.resetGameScores = async function() {
    if(!confirm("⚠️ تحذير: سيتم مسح جميع النقاط والبدء من الصفر!")) return;
    await db.collection('game_session').doc(GAME_DOC_ID).set({
        round: 1,
        players: {} 
    });
    toast("تم تصفير اللعبة 🗑️");
}

// ==========================================
// 7. منطق المباراة (Game Room)
// ==========================================
function updateGameUI() {
    // تحديث رقم الجولة
    const r = gameData.round || 1;
    const roundDisp = document.getElementById('currentRoundDisplay');
    const phaseDesc = document.getElementById('roundPhaseDesc');
    
    if(roundDisp) roundDisp.innerText = r;
    if(phaseDesc) phaseDesc.innerText = PHASES[r-1] || "نهاية اللعبة";

    // رسم كروت اللاعبين
    const container = document.getElementById('gamePlayersContainer');
    if(!container) return;

    const playersObj = gameData.players || {};
    const pIds = Object.keys(playersObj);

    // ترتيب اللاعبين حسب المجموع
    const sorted = pIds.map(uid => {
        const scores = playersObj[uid].scores || {};
        const total = calculateTotal(scores);
        // نتأكد إن بيانات اليوزر محملة، لو لأ (نادرة) نحط اسم مؤقت
        const uInfo = usersCache[uid] || { name: 'Loading...', avatar: '⏳' };
        return { uid, ...uInfo, scores, total };
    }).sort((a, b) => a.total - b.total);

    let html = '';
    sorted.forEach((p, index) => {
        let rankClass = '';
        let badge = '';
        if (sorted.length > 1) {
            if (index === 0) { rankClass = 'rank-1'; badge = '<span class="badge">🦁</span>'; } 
            if (index === sorted.length - 1) { rankClass = 'rank-last'; badge = '<span class="badge">🐑</span>'; }
        }

        const isMe = currentUser && p.uid === currentUser.uid;
        const isAdmin = currentUser && currentUser.isAdmin;
        const canEdit = isMe || isAdmin;
        
        // قيمة الجولة الحالية
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

// دالة حفظ السكور (Global scope عشان الـ HTML يشوفها)
window.saveScore = async function(uid, round, val) {
    // Dot Notation لتحديث حقل واحد بس في الداتا بيز
    const updateKey = `players.${uid}.scores.${round}`;
    
    let valueToSave = Number(val);
    if (val === '') {
        // لو مسح الرقم، بنستخدم delete
        await db.collection('game_session').doc(GAME_DOC_ID).update({
            [updateKey]: firebase.firestore.FieldValue.delete()
        });
    } else {
        await db.collection('game_session').doc(GAME_DOC_ID).update({
            [updateKey]: valueToSave
        });
    }
}

window.changeRound = async function(delta) {
    if (!currentUser.isAdmin) return;
    const current = gameData.round || 1;
    const next = Math.max(1, Math.min(10, current + delta));
    if (next !== current) {
        await db.collection('game_session').doc(GAME_DOC_ID).update({ round: next });
    }
}

function calculateTotal(scores) {
    if (!scores) return 0;
    return Object.values(scores).reduce((a, b) => a + (Number(b) || 0), 0);
}

// ==========================================
// 8. الجدول الكامل (Table)
// ==========================================
window.openTableModal = function() {
    document.getElementById('tableModal').style.display = 'flex';
    updateGameUI();
}
window.closeTableModal = function() {
    document.getElementById('tableModal').style.display = 'none';
}
window.goToLobby = function() {
    showScreen('lobbyScreen');
}
window.filterLobby = function() {
    renderLobby();
}

function renderFullTable(sortedPlayers, currentRound) {
    const thead = document.querySelector('#scoreTable thead tr');
    const tbody = document.getElementById('tableBody');
    
    let headHtml = '<th>اللاعب</th><th>T</th>';
    for(let i=1; i<=10; i++) {
        const mark = i === currentRound ? 'style="color:var(--gold)"' : '';
        headHtml += `<th ${mark}>${i}</th>`;
    }
    thead.innerHTML = headHtml;

    let bodyHtml = '';
    sortedPlayers.forEach(p => {
        let rows = `<td>${p.name}</td><td><b>${p.total}</b></td>`;
        for(let i=1; i<=10; i++) {
            rows += `<td>${p.scores[i] !== undefined ? p.scores[i] : ''}</td>`;
        }
        bodyHtml += `<tr>${rows}</tr>`;
    });
    tbody.innerHTML = bodyHtml;
}

// ==========================================
// 9. المساعدات (Utils)
// ==========================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

window.toggleAuthMode = function(mode) {
    document.getElementById('loginForm').style.display = mode === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = mode === 'register' ? 'block' : 'none';
}

function initAvatars() {
    const container = document.getElementById('avatarList');
    if(!container) return;
    AVATARS.forEach((av, idx) => {
        const span = document.createElement('span');
        span.className = `av-item ${idx === 0 ? 'selected' : ''}`;
        span.innerText = av;
        span.onclick = () => {
            document.querySelectorAll('.av-item').forEach(x => x.classList.remove('selected'));
            span.classList.add('selected');
            document.getElementById('selectedAvatar').value = av;
        };
        container.appendChild(span);
    });
}

function toast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

window.resetPassword = function() {
    const email = prompt("أدخل بريدك الإلكتروني:");
    if(email) {
        auth.sendPasswordResetEmail(email)
            .then(() => alert("تم إرسال الرابط 📧"))
            .catch(e => alert("خطأ: " + e.message));
    }
}
