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

try { firebase.initializeApp(firebaseConfig); } catch (e) {}
const db = firebase.firestore();
const auth = firebase.auth();

// إعدادات الثبات (منع التقطيع)
db.settings({ experimentalForceLongPolling: true, merge: true });

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
    document.getElementById('btnLogin').onclick = login;
    document.getElementById('btnRegister').onclick = register;
    document.getElementById('btnLogout').onclick = logout;
    document.getElementById('btnPrevRound').onclick = () => changeRound(-1);
    document.getElementById('btnNextRound').onclick = () => changeRound(1);
});

// ==========================================
// 4. إدارة المستخدمين (Auth & Data)
// ==========================================
async function loadUserData(uid) {
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) {
        currentUser = { uid: uid, ...doc.data() };
        document.getElementById('myName').innerText = currentUser.name;
        document.getElementById('myAvatar').innerText = currentUser.avatar;
        
        // لو أدمن، اظهر لوحة التحكم
        if (currentUser.isAdmin) {
            document.getElementById('adminControls').style.display = 'block';
            document.getElementById('btnPrevRound').style.display = 'block';
            document.getElementById('btnNextRound').style.display = 'block';
        }

        // ابدأ الاستماع للتحديثات فوراً
        setupRealtimeListeners();
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
        renderLobby(); // تحديث اللوبي لما حد يسجل جديد
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
                // اللعبة اتصفرت
                gameData = { round: 1, players: {} };
                showScreen('lobbyScreen');
            }
            renderLobby(); // عشان نحدث علامة "مين بيلعب"
        });
    listeners.push(unsubGame);
    
    // افتراضياً ادخل اللوبي
    showScreen('lobbyScreen');
}

// ==========================================
// 6. منطق اللوبي والتحكم (Admin Logic)
// ==========================================
function renderLobby() {
    const list = document.getElementById('lobbyPlayersList');
    const filter = document.getElementById('searchPlayer').value.toLowerCase();
    
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
        if (currentUser.isAdmin) {
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

    const currentPlayers = gameData.players || {};
    
    if (currentPlayers[uid]) {
        // إخراج اللاعب (حذف من الجيم)
        if(!confirm("هل تريد إخراج هذا اللاعب من المباراة؟")) return;
        delete currentPlayers[uid];
    } else {
        // إدخال لاعب جديد (وهنا السحر!)
        // 1. نحسب أعلى سكور موجود حالياً (سكور الخروف)
        let maxTotal = 0;
        const pIds = Object.keys(currentPlayers);
        if (pIds.length > 0) {
            maxTotal = Math.max(...pIds.map(id => calculateTotal(currentPlayers[id].scores)));
        }

        // 2. نضيف اللاعب مع عقوبة = الماكس سكور
        // بنحط السكور كله في خانة "penalty" أو أول جولة عشان يظبط المجموع
        // هنا هنحطه في مصفوفة scores كقيمة مبدئية
        let initialScores = {};
        // لو اللعبة بادية، اديله الماكس في الجولة 0 (كعقوبة)
        if (maxTotal > 0) {
            initialScores["penalty"] = maxTotal; 
            toast(`تم دخول اللاعب بسكور الخروف: ${maxTotal} 🐑`);
        } else {
            toast("تم إضافة اللاعب للمباراة ✅");
        }

        currentPlayers[uid] = {
            scores: initialScores
        };
    }

    // تحديث الداتا بيز مرة واحدة
    await db.collection('game_session').doc(GAME_DOC_ID).set({
        players: currentPlayers
    }, { merge: true });
}

function startGame() {
    showScreen('gameScreen');
}

function goToLobby() {
    showScreen('lobbyScreen');
}

async function resetGameScores() {
    if(!confirm("⚠️ تحذير: سيتم مسح جميع النقاط والبدء من الصفر!")) return;
    await db.collection('game_session').doc(GAME_DOC_ID).set({
        round: 1,
        players: {} // فضينا اللاعبين، لازم الأدمن يختارهم تاني
    });
    toast("تم تصفير اللعبة 🗑️");
}

// ==========================================
// 7. منطق المباراة (Game Room)
// ==========================================
function updateGameUI() {
    // تحديث رقم الجولة
    const r = gameData.round || 1;
    document.getElementById('currentRoundDisplay').innerText = r;
    document.getElementById('roundPhaseDesc').innerText = PHASES[r-1] || "نهاية اللعبة";

    // رسم كروت اللاعبين
    const container = document.getElementById('gamePlayersContainer');
    const playersObj = gameData.players || {};
    const pIds = Object.keys(playersObj);

    // ترتيب اللاعبين حسب المجموع (الأقل هو الأول)
    const sorted = pIds.map(uid => {
        const scores = playersObj[uid].scores || {};
        const total = calculateTotal(scores);
        return { uid, ...usersCache[uid], scores, total };
    }).sort((a, b) => a.total - b.total);

    let html = '';
    sorted.forEach((p, index) => {
        // تحديد الرتبة (أسد / خروف)
        let rankClass = '';
        let badge = '';
        if (sorted.length > 1) {
            if (index === 0) { rankClass = 'rank-1'; badge = '<span class="badge">🦁</span>'; } // الأول
            if (index === sorted.length - 1) { rankClass = 'rank-last'; badge = '<span class="badge">🐑</span>'; } // الأخير
        }

        const isMe = p.uid === currentUser.uid;
        const canEdit = isMe || currentUser.isAdmin;
        const currentVal = p.scores[r] !== undefined ? p.scores[r] : '';

        // المدخل (Input) أو النص (Text)
        let inputField = '';
        if (canEdit) {
            // بنستخدم onblur للحفظ عشان ميعملش ريفريش وأنت بتكتب
            inputField = `<input type="number" class="score-input" value="${currentVal}" 
                onchange="saveScore('${p.uid}', ${r}, this.value)" placeholder="-">`;
        } else {
            inputField = `<div class="score-display">${currentVal === '' ? '-' : currentVal}</div>`;
        }

        html += `
        <div class="game-card ${isMe ? 'is-me' : ''} ${rankClass}">
            ${badge}
            <div class="card-info">
                <div class="card-avatar">${p.avatar || '👤'}</div>
                <div>
                    <div class="card-name">${p.name}</div>
                    <div class="card-total">المجموع: <b>${p.total}</b></div>
                </div>
            </div>
            <div>${inputField}</div>
        </div>`;
    });

    container.innerHTML = html;
    
    // تحديث الجدول لو مفتوح
    if(document.getElementById('tableModal').style.display === 'flex') {
        renderFullTable(sorted, r);
    }
}

async function saveScore(uid, round, val) {
    const players = gameData.players;
    if (!players[uid]) return;

    if (!players[uid].scores) players[uid].scores = {};
    
    if (val === '') delete players[uid].scores[round];
    else players[uid].scores[round] = Number(val);

    await db.collection('game_session').doc(GAME_DOC_ID).update({
        players: players
    });
}

async function changeRound(delta) {
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
function openTableModal() {
    document.getElementById('tableModal').style.display = 'flex';
    updateGameUI(); // عشان يرسم الجدول
}
function closeTableModal() {
    document.getElementById('tableModal').style.display = 'none';
}

function renderFullTable(sortedPlayers, currentRound) {
    const thead = document.querySelector('#scoreTable thead tr');
    const tbody = document.getElementById('tableBody');
    
    // بناء الهيدر
    let headHtml = '<th>اللاعب</th><th>T</th>';
    for(let i=1; i<=10; i++) {
        const mark = i === currentRound ? 'style="color:var(--gold)"' : '';
        headHtml += `<th ${mark}>${i}</th>`;
    }
    thead.innerHTML = headHtml;

    // بناء الصفوف
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

function toggleAuthMode(mode) {
    document.getElementById('loginForm').style.display = mode === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = mode === 'register' ? 'block' : 'none';
}

function initAvatars() {
    const container = document.getElementById('avatarList');
    AVATARS.forEach(av => {
        const span = document.createElement('span');
        span.className = 'av-item';
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

function resetPassword() {
    const email = prompt("أدخل بريدك الإلكتروني لإعادة تعيين كلمة المرور:");
    if(email) {
        auth.sendPasswordResetEmail(email)
            .then(() => alert("تم إرسال رابط التعيين لبريدك 📧"))
            .catch(e => alert("خطأ: " + e.message));
    }
}
