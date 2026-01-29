const firebaseConfig = {
  apiKey: "AIzaSyC5Dh7bJzPqLaZl4djKCgpzaHHSeeD1aHU",
  authDomain: "phaseten-435bf.firebaseapp.com",
  projectId: "phaseten-435bf",
  storageBucket: "phaseten-435bf.firebasestorage.app",
  messagingSenderId: "780298483879",
  appId: "1:780298483879:web:6b6627e673d4808e098382"
};

try { firebase.initializeApp(firebaseConfig); } catch(e){ console.error(e); }
const db = firebase.firestore();
const auth = firebase.auth();

const GAME_ID = "main_game_room";
const ROUNDS = 10;
const PHASE_RULES = [
    "2 مجموعات (3)", "مجموعة (3) + تسلسل (4)", "مجموعة (4) + تسلسل (4)", "تسلسل (7)",
    "تسلسل (8)", "تسلسل (9)", "2 مجموعات (4)", "7 كروت لون واحد",
    "مجموعة (5) + مجموعة (2)", "مجموعة (5) + مجموعة (3)"
];
const AVATARS = ["🦁", "🐯", "🐻", "🐼", "🐨", "🐸", "🐔", "🦄", "🐉", "👽", "🤖", "🤠", "😎", "👻", "🔥"];
const STATUS_MSGS = {
    lion: ["يا عم الناس.. محدش قدك 🦁", "القمة بتاعتك وبس 👑", "مسيطر على السيرفر 🔥"],
    tiger: ["النمر بيخربش.. فاضل تكه 🐯", "عينك على اللي فوق 👀"],
    normal: ["خليك في الأمان 😐", "العب بذكاء 🎲", "جمع كروتك صح 🃏"],
    goat: ["يا معزة اهربي 🐐", "الوضع مش مطمن ⚠️"],
    sheep: ["فوق يا اسطى.. البرسيم نازل 🐑", "يا فضيحتك وسط القبائل 😂", "الخروف وصل 👏"]
};

let state = { me: null, userData: null, isAdmin: false, round: 1, status: 'lobby', players: [] };
let unsubGame = null;
let unsubPlayers = null;
let wakeLock = null;
const timers = new Map();
let playerToSubId = null;

document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged(async user => {
        if(user) {
            state.me = user.uid;
            await loadUserProfile(user.uid); 
        } else {
            state.me = null;
            state.userData = null;
            switchScreen('login');
        }
    });

    document.addEventListener('click', async () => { try { if('wakeLock' in navigator) wakeLock=await navigator.wakeLock.request('screen'); } catch(e){} }, { once: true });

    document.getElementById('doLoginBtn').addEventListener('click', loginUser);
    document.getElementById('doRegisterBtn').addEventListener('click', registerUser);
    document.getElementById('goToRegister').addEventListener('click', () => switchScreen('register'));
    document.getElementById('goToLogin').addEventListener('click', () => switchScreen('login'));
    document.getElementById('logoutBtn').addEventListener('click', logoutUser);
    document.getElementById('openProfileBtn').addEventListener('click', openProfileModal);
    document.getElementById('saveProfileChangesBtn').addEventListener('click', saveProfileChanges);
    document.getElementById('closeProfileModalBtn').addEventListener('click', () => document.getElementById('profileModal').style.display='none');

    document.getElementById('startGameBtn').addEventListener('click', startGame);
    document.getElementById('resetGameBtn').addEventListener('click', resetGame);
    document.getElementById('factoryResetBtn').addEventListener('click', adminFactoryReset); // 🔴 زر التصفير الشامل
    
    document.getElementById('leaveGameBtn').addEventListener('click', () => switchScreen('lobby'));
    document.getElementById('finishGameBtn').addEventListener('click', finishGameAndSave);
    document.getElementById('prevRoundBtn').addEventListener('click', () => changeRound(-1));
    document.getElementById('nextRoundBtn').addEventListener('click', () => changeRound(1));
    document.getElementById('leaderBtn').addEventListener('click', calcLeader);
    document.getElementById('randomSkipBtn').addEventListener('click', randomSkip);
    document.getElementById('smartSkipBtn').addEventListener('click', smartSkip);
    
    // نقل الأدمن
    document.getElementById('changeAdminBtn').addEventListener('click', openAdminSelect);
    document.getElementById('lobbyChangeAdminBtn').addEventListener('click', openAdminSelect); // نقل الأدمن في اللوبي

    document.getElementById('closeModalBtn').addEventListener('click', () => document.getElementById('skipModal').style.display='none');
    document.getElementById('closeSubModalBtn').addEventListener('click', () => document.getElementById('subModal').style.display='none');
    document.getElementById('showFameBtn').addEventListener('click', showHallOfFame);
    document.getElementById('closeFameBtn').addEventListener('click', () => document.getElementById('fameModal').style.display='none');
    document.getElementById('closeAdminModalBtn').addEventListener('click', () => document.getElementById('adminSelectModal').style.display='none');
    document.getElementById('waBtn').addEventListener('click', shareWa);

    initAvatarGrid();
    initEditAvatarGrid();
});

function initAvatarGrid() {
    const grid = document.getElementById('avatarGrid');
    AVATARS.forEach((av, idx) => {
        const div = document.createElement('div'); div.className = `avatar-option ${idx === 0 ? 'selected' : ''}`; div.textContent = av;
        div.onclick = () => { document.querySelectorAll('#avatarGrid .avatar-option').forEach(el => el.classList.remove('selected')); div.classList.add('selected'); document.getElementById('selectedAvatar').value = av; };
        grid.appendChild(div);
    });
}
function initEditAvatarGrid() {
    const grid = document.getElementById('editAvatarGrid');
    AVATARS.forEach((av) => {
        const div = document.createElement('div'); div.className = 'avatar-option'; div.textContent = av;
        div.onclick = () => { document.querySelectorAll('#editAvatarGrid .avatar-option').forEach(el => el.classList.remove('selected')); div.classList.add('selected'); document.getElementById('editSelectedAvatar').value = av; };
        grid.appendChild(div);
    });
}

// Auth Logic
async function loginUser() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    if(!email || !pass) return toast('ادخل البيانات', true);
    try { await auth.signInWithEmailAndPassword(email, pass); } catch(e) { console.error(e); toast('بيانات خطأ', true); }
}

async function registerUser() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPass').value;
    const avatar = document.getElementById('selectedAvatar').value;
    if(!name || !email || !pass) return toast('أكمل البيانات', true);
    const nameCheck = await db.collection('users').where('name', '==', name).get();
    if(!nameCheck.empty) return toast('الاسم مستخدم بالفعل', true);
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection('users').doc(cred.user.uid).set({ name: name, avatar: avatar, email: email, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        toast(`تم التسجيل! أهلاً ${name} 🎉`);
    } catch(e) { console.error(e); if(e.code === 'auth/email-already-in-use') toast('البريد مسجل بالفعل', true); else toast('خطأ في التسجيل', true); }
}

async function loadUserProfile(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        if(doc.exists) {
            state.userData = doc.data();
            document.getElementById('userNameDisplay').textContent = state.userData.name;
            document.getElementById('userAvatarDisplay').textContent = state.userData.avatar;
            enterGlobalLobby();
        }
    } catch(e) { console.error(e); }
}

async function logoutUser() {
    if(state.me) await db.collection('rooms').doc(GAME_ID).collection('players').doc(state.me).delete();
    await auth.signOut(); switchScreen('login');
}

// Profile Editing
function openProfileModal() {
    document.getElementById('editName').value = state.userData.name;
    document.getElementById('editSelectedAvatar').value = state.userData.avatar;
    document.getElementById('profileModal').style.display = 'flex';
}
async function saveProfileChanges() {
    const newName = document.getElementById('editName').value.trim();
    const newAv = document.getElementById('editSelectedAvatar').value;
    const newPass = document.getElementById('editPass').value;

    if(!newName) return toast('الاسم مطلوب', true);

    try {
        // تحديث في Firestore
        await db.collection('users').doc(state.me).update({ name: newName, avatar: newAv });
        
        // تحديث في الغرفة لو موجود
        await db.collection('rooms').doc(GAME_ID).collection('players').doc(state.me).update({ name: newName, avatar: newAv });

        // تحديث الباسورد لو انكتب
        if(newPass) {
            const user = auth.currentUser;
            await user.updatePassword(newPass);
            toast('تم تحديث كلمة المرور');
        }

        state.userData.name = newName;
        state.userData.avatar = newAv;
        document.getElementById('userNameDisplay').textContent = newName;
        document.getElementById('userAvatarDisplay').textContent = newAv;
        
        document.getElementById('profileModal').style.display = 'none';
        toast('تم حفظ التعديلات ✅');
    } catch(e) {
        console.error(e);
        toast('حدث خطأ (ربما تحتاج إعادة تسجيل الدخول لتغيير الباسورد)', true);
    }
}

// Admin Factory Reset (تصفير شامل)
async function adminFactoryReset() {
    if(!confirm('🚨 تحذير خطير 🚨\nسيتم مسح سجل التاريخ بالكامل!\nسيتم تصفير اللعبة وإخراج جميع اللاعبين!\nهل أنت متأكد تماماً؟')) return;
    
    try {
        toast('جاري المسح الشامل... 🧹');
        
        // 1. مسح التاريخ (History)
        const historySnap = await db.collection('history').get();
        const batch = db.batch();
        historySnap.forEach(doc => batch.delete(doc.ref));
        
        // 2. تصفير الغرفة
        batch.update(db.collection('rooms').doc(GAME_ID), { round: 1, status: 'lobby' });
        
        // 3. مسح اللاعبين من الغرفة (وليس المستخدمين)
        const playersSnap = await db.collection('rooms').doc(GAME_ID).collection('players').get();
        playersSnap.forEach(doc => batch.delete(doc.ref));

        await batch.commit();
        toast('تم فرمتة اللعبة بنجاح ✨');
    } catch(e) {
        console.error(e);
        toast('فشل التصفير', true);
    }
}


/* =========================================
   Lobby & Logic
   ========================================= */
async function enterGlobalLobby() {
    const playerRef = db.collection('rooms').doc(GAME_ID).collection('players').doc(state.me);
    await playerRef.set({
        name: state.userData.name, avatar: state.userData.avatar, uid: state.me,
        scores: [], status: 'waiting', lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const gameDoc = await db.collection('rooms').doc(GAME_ID).get();
    if(!gameDoc.exists) await db.collection('rooms').doc(GAME_ID).set({ admin: state.me, round: 1, status: 'lobby', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    subscribe();
}

function subscribe() {
    if(unsubGame) unsubGame(); if(unsubPlayers) unsubPlayers();

    unsubGame = db.collection('rooms').doc(GAME_ID).onSnapshot(doc => {
        if(!doc.exists) return;
        const d = doc.data();
        state.isAdmin = (d.admin === state.me);
        if(!d.admin) db.collection('rooms').doc(GAME_ID).update({ admin: state.me });
        state.round = d.round || 1;
        state.status = d.status || 'lobby';
        if(state.status === 'playing') { switchScreen('game'); renderGameUI(); } else { switchScreen('lobby'); renderLobby(); }
    });

    unsubPlayers = db.collection('rooms').doc(GAME_ID).collection('players').onSnapshot(snap => {
        state.players = [];
        snap.forEach(d => state.players.push({ id: d.id, ...d.data() }));
        if(state.status === 'playing') renderGameUI(); else renderLobby();
    });
}

function renderLobby() {
    const list = document.getElementById('onlinePlayersList'); list.innerHTML = '';
    document.getElementById('adminLobbyPanel').style.display = state.isAdmin ? 'block' : 'none';
    document.getElementById('playerWaitingMsg').style.display = state.isAdmin ? 'none' : 'block';
    document.getElementById('lobbyHeaderMsg').textContent = state.isAdmin ? '👑 أنت الأدمن، اختر التشكيلة:' : '👋 أهلاً في ساحة الانتظار';
    state.players.forEach(p => {
        const item = document.createElement('div'); item.className = `lobby-item ${p.status === 'active' ? 'selected' : ''}`;
        const av = p.avatar || '👤';
        item.innerHTML = `<div class="lobby-name"><span>${av}</span> ${p.name}</div><div class="check-indicator">${p.status === 'active' ? '✓' : ''}</div>`;
        if(state.isAdmin) item.onclick = () => togglePlayerStatus(p);
        list.appendChild(item);
    });
}

async function togglePlayerStatus(p) {
    const newS = p.status === 'active' ? 'waiting' : 'active';
    await db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id).update({ status: newS });
}
async function startGame() {
    const activeCount = state.players.filter(p => p.status === 'active').length;
    if(activeCount < 1) return toast('اختر لاعب واحد على الأقل', true);
    await db.collection('rooms').doc(GAME_ID).update({ status: 'playing' });
}
async function resetGame() {
    if(!confirm('تصفير الجولة والرجوع للبداية؟')) return;
    const batch = db.batch(); batch.update(db.collection('rooms').doc(GAME_ID), { round: 1, status: 'lobby' });
    state.players.forEach(p => batch.update(db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id), { scores: [], status: 'waiting' }));
    await batch.commit();
}

/* =========================================
   Game UI & Logic
   ========================================= */
function renderGameUI() {
    document.getElementById('adminControls').style.display = state.isAdmin ? 'block' : 'none';
    document.getElementById('viewerControls').style.display = state.isAdmin ? 'none' : 'block';
    document.getElementById('finishGameBtn').style.display = state.isAdmin ? 'block' : 'none';
    document.getElementById('roundNum').textContent = state.round;
    document.getElementById('viewRoundNum').textContent = state.round;
    document.getElementById('roundDescAdmin').textContent = PHASE_RULES[state.round - 1] || "";
    document.getElementById('roundDescViewer').textContent = PHASE_RULES[state.round - 1] || "";

    const active = state.players.filter(p => p.status === 'active');
    const sorted = active.map(p => ({ ...p, scores: p.scores || [], total: (p.scores||[]).reduce((a,b)=>a+(Number(b)||0),0) })).sort((a,b)=>a.total - b.total);

    const myIdx = sorted.findIndex(p => p.uid === state.me);
    if(myIdx !== -1) updateMyStatusCard(myIdx, sorted.length); else document.getElementById('myStatusCard').style.display = 'none';

    const thead = document.getElementById('tHead'); thead.innerHTML = '';
    ['اللاعب','مجموع','#'].forEach(t=>{const th=document.createElement('th'); th.textContent=t; thead.appendChild(th)});
    for(let i=1; i<=ROUNDS; i++) { const th=document.createElement('th'); th.textContent=i; if(i===state.round) th.className='active-col'; thead.appendChild(th); }
    const tbody = document.getElementById('tBody'); tbody.innerHTML = '';

    sorted.forEach((p, idx) => {
        const animal = getAnimalRank(idx, sorted.length);
        const tr = document.createElement('tr'); if(animal.class) tr.className = animal.class;
        const tdName = document.createElement('td'); const av = p.avatar || '👤';
        tdName.innerHTML = `${animal.icon || av} ${p.name}`;
        if(state.isAdmin) { tdName.style.cursor = 'pointer'; tdName.onclick = () => openSubModal(p); }
        tr.appendChild(tdName);
        const tdTotal = document.createElement('td'); tdTotal.style.fontWeight='900'; tdTotal.textContent=p.total; tr.appendChild(tdTotal);
        const tdRank = document.createElement('td'); tdRank.innerHTML=`<small>#${idx+1}</small>`; tr.appendChild(tdRank);
        for(let r=0; r<ROUNDS; r++) {
            const td = document.createElement('td');
            if(r === state.round - 1) {
                td.className = 'active-col'; const inp = document.createElement('input'); inp.type = 'number'; inp.className = 'score-inp';
                inp.value = (p.scores[r]!==null && p.scores[r]!==undefined) ? p.scores[r] : '';
                if(!state.isAdmin && p.uid !== state.me) { inp.disabled = true; inp.style.opacity = "0.5"; }
                inp.oninput = () => { const k = `${p.id}-${r}`; if(timers.has(k)) clearTimeout(timers.get(k)); timers.set(k, setTimeout(() => saveScore(p.id, r, inp.value), 600)); };
                td.appendChild(inp);
            } else { td.textContent = (p.scores[r]!==null && p.scores[r]!==undefined) ? p.scores[r] : ''; td.style.opacity='0.5'; }
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });
}

// Sub & Score
function openSubModal(pOut) { playerToSubId = pOut.id; document.getElementById('subTargetName').textContent = `خروج: ${pOut.name}`; const bench = state.players.filter(p => p.status === 'waiting'); const list = document.getElementById('benchList'); list.innerHTML = ''; if(!bench.length) list.innerHTML = '<div style="color:#aaa">لا يوجد بدلاء</div>'; bench.forEach(sub => { const el = document.createElement('div'); el.className='bench-item'; el.textContent=`نزول: ${sub.name}`; el.onclick = () => performSub(pOut, sub); list.appendChild(el); }); document.getElementById('subModal').style.display = 'flex'; }
async function performSub(outP, inP) { if(!confirm(`تبديل ${outP.name} بـ ${inP.name}؟`)) return; const batch = db.batch(); const ref = db.collection('rooms').doc(GAME_ID).collection('players'); batch.update(ref.doc(outP.id), { status: 'waiting', scores: [] }); batch.update(ref.doc(inP.id), { status: 'active', scores: outP.scores }); await batch.commit(); document.getElementById('subModal').style.display = 'none'; }
async function saveScore(pid, rIdx, val) { const num = (val===''||val==='-') ? null : Number(val); const p = state.players.find(x => x.id === pid); let s = p.scores ? [...p.scores] : []; while(s.length < ROUNDS) s.push(null); s[rIdx] = num; await db.collection('rooms').doc(GAME_ID).collection('players').doc(pid).update({ scores: s }); }

// Finish & Hall of Fame (المعدلة بالتعليقات المضحكة)
async function finishGameAndSave() {
    if(!confirm('حفظ النتيجة في السجل وإنهاء اللعبة؟')) return;
    const active = state.players.filter(p => p.status === 'active');
    if(active.length < 2) return toast('لا يوجد لاعبين', true);
    const sorted = active.sort((a,b) => { const sa = (a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0); const sb = (b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0); return sa - sb; });

    // تحديد الحيوانات
    const lion = sorted[0];
    const sheep = sorted[sorted.length-1];
    let tiger = null, goat = null;
    if(sorted.length >= 3) tiger = sorted[1];
    if(sorted.length >= 4) goat = sorted[sorted.length-2];

    const gameData = {
        date: firebase.firestore.FieldValue.serverTimestamp(),
        owner: state.me,
        lionName: lion.name, lionScore: getSum(lion),
        sheepName: sheep.name, sheepScore: getSum(sheep),
        tigerName: tiger ? tiger.name : null, tigerScore: tiger ? getSum(tiger) : null,
        goatName: goat ? goat.name : null, goatScore: goat ? getSum(goat) : null,
        playersCount: active.length
    };

    try {
        await db.collection('history').add(gameData);
        playSound('winAudio'); toast('تم الحفظ 🏆');
        await db.collection('rooms').doc(GAME_ID).update({ status: 'lobby', round: 1 });
        const batch = db.batch();
        state.players.forEach(p => batch.update(db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id), { scores: [], status: 'waiting' }));
        await batch.commit();
    } catch(e) { console.error(e); }
}

function getSum(p) { return (p.scores||[]).reduce((x,y)=>x+(Number(y)||0),0); }

async function showHallOfFame() {
    const list = document.getElementById('fameList'); list.innerHTML = 'جاري التحميل...'; document.getElementById('fameModal').style.display = 'flex';
    try {
        const snap = await db.collection('history').orderBy('date', 'desc').limit(20).get();
        list.innerHTML = ''; if(snap.empty) list.innerHTML = '<div style="text-align:center">لا يوجد سجلات</div>';
        snap.forEach(d => {
            const r = d.data(); const date = r.date ? r.date.toDate().toLocaleDateString('ar-EG') : '';
            const el = document.createElement('div'); el.className='fame-item';
            
            let extraHTML = '';
            if(r.tigerName) extraHTML += `<div class="fame-row"><div class="tiger-badge">🐯 ${r.tigerName} <span class="fame-comment">"الوصيف الشرس"</span></div><span class="score-badge">${r.tigerScore}</span></div>`;
            if(r.goatName) extraHTML += `<div class="fame-row"><div class="goat-badge">🐐 ${r.goatName} <span class="fame-comment">"نجا من الهبوط"</span></div><span class="score-badge">${r.goatScore}</span></div>`;

            el.innerHTML = `
                <div class="fame-date">${date}</div>
                <div class="fame-row"><div class="lion-badge">🦁 ${r.lionName} <span class="fame-comment">"الأسد الهصور"</span></div><span class="score-badge">${r.lionScore}</span></div>
                ${extraHTML}
                <div class="fame-row"><div class="sheep-badge">🐑 ${r.sheepName} <span class="fame-comment">"ملك البرسيم"</span></div><span class="score-badge">${r.sheepScore}</span></div>
            `;
            list.appendChild(el);
        });
    } catch(e) { list.innerHTML = 'خطأ في التحميل'; }
}

// Helpers
function openAdminSelect() {
    const list = document.getElementById('adminCandidatesList'); list.innerHTML = '';
    state.players.forEach(p => { if(p.uid === state.me) return; const item = document.createElement('div'); item.className = 'lobby-item'; item.textContent = p.name; item.onclick = () => transferAdmin(p); list.appendChild(item); });
    document.getElementById('adminSelectModal').style.display = 'flex';
}
async function transferAdmin(newAdmin) { if(!confirm(`تسليم الأدمن لـ ${newAdmin.name}؟`)) return; await db.collection('rooms').doc(GAME_ID).update({ admin: newAdmin.uid }); document.getElementById('adminSelectModal').style.display = 'none'; toast(`تم التسليم لـ ${newAdmin.name}`); }
function updateMyStatusCard(idx, total) { const c=document.getElementById('myStatusCard'); const m=document.getElementById('statusMsg'); const e=document.getElementById('statusEmoji'); const t=document.getElementById('statusTitle'); let type='normal', icon='😐', lbl='عادي', cls='status-normal'; if(total>0 && idx===0) { type='lion'; icon='🦁'; lbl='الأسد'; cls='status-lion'; } else if(total>=2 && idx===total-1) { type='sheep'; icon='🐑'; lbl='الخروف'; cls='status-sheep'; } const txts = STATUS_MSGS[type] || STATUS_MSGS['normal']; m.textContent = txts[Math.floor(Math.random()*txts.length)]; c.className=`glass-card status-card ${cls}`; e.textContent=icon; t.textContent=lbl; c.style.display='flex'; }
function getAnimalRank(i, t) { if(i===0) return {icon:'🦁', class:'rank-lion'}; if(t>=2 && i===t-1) return {icon:'🐑', class:'rank-sheep'}; if(t>=3 && i===1) return {icon:'🐯', class:'rank-tiger'}; if(t>=4 && i===t-2) return {icon:'🐐', class:'rank-goat'}; return {icon:'', class:''}; }
async function changeRound(d) { const newR = Math.min(ROUNDS, Math.max(1, state.round + d)); if(newR !== state.round) await db.collection('rooms').doc(GAME_ID).update({ round: newR }); }
function calcLeader() { const active = state.players.filter(p => p.status === 'active'); const sorted = active.sort((a,b) => { const sa = (a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0); const sb = (b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0); return sa - sb; }); if(sorted.length) { toast(`👑 الأسد: ${sorted[0].name}`); playSound('lionAudio'); if(sorted.length>1) setTimeout(()=>{ toast(`🐑 الخروف: ${sorted[sorted.length-1].name}`, true); playSound('sheepAudio'); }, 2000); } }
function randomSkip() { const active = state.players.filter(p => p.status === 'active'); if(active.length) showModal(active[Math.floor(Math.random()*active.length)].name, 'سكيب عشوائي 🎲'); }
function smartSkip() { const active = state.players.filter(p => p.status === 'active'); if(!active.length) return; const sorted = [...active].sort((a,b) => { const sa = (a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0); const sb = (b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0); return sa - sb; }); const myIdx = sorted.findIndex(p => p.uid === state.me); if(myIdx === -1) return randomSkip(); let t; if(myIdx === 0) t = sorted[1]; else if(myIdx === sorted.length - 1) t = sorted[myIdx - 1]; else { const pS = (sorted[myIdx-1].scores||[]).reduce((x,y)=>x+(Number(y)||0),0); const nS = (sorted[myIdx+1].scores||[]).reduce((x,y)=>x+(Number(y)||0),0); const mS = (sorted[myIdx].scores||[]).reduce((x,y)=>x+(Number(y)||0),0); t = (Math.abs(mS-pS) <= Math.abs(mS-nS)) ? sorted[myIdx-1] : sorted[myIdx+1]; } showModal(t.name, 'سكيب ذكي 🧠'); }
function showModal(n,t) { document.getElementById('skipType').textContent=t; document.getElementById('skipTarget').textContent=n; document.getElementById('skipModal').style.display='flex'; playSound('skipAudio'); }
function playSound(id) { const a=document.getElementById(id); if(a){a.currentTime=0; a.play().catch(()=>{});} }
function toast(m, e=false) { const t=document.getElementById('toast'); t.innerHTML=m; t.className=e?'toast show error':'toast show'; setTimeout(()=>t.classList.remove('show'),3000); }
function shareWa() { window.open(`https://wa.me/?text=${encodeURIComponent(`يلا Phase 10 🔥\nرابط اللعبة: ${window.location.href}`)}`); }
function switchScreen(s) { ['loginScreen','registerScreen','lobbyScreen','gameRoom'].forEach(id => document.getElementById(id).style.display='none'); if(s==='login') document.getElementById('loginScreen').style.display='block'; if(s==='register') document.getElementById('registerScreen').style.display='block'; if(s==='lobby') document.getElementById('lobbyScreen').style.display='block'; if(s==='game') document.getElementById('gameRoom').style.display='block'; }
