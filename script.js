/* =========================================
   1. تهيئة Firebase
   ========================================= */
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

/* =========================================
   2. الثوابت
   ========================================= */
const GAME_ID = "main_game_room";
const ROUNDS = 10;
const PHASE_RULES = [
    "2 مجموعات (3)", "مجموعة (3) + تسلسل (4)", "مجموعة (4) + تسلسل (4)", "تسلسل (7)",
    "تسلسل (8)", "تسلسل (9)", "2 مجموعات (4)", "7 كروت لون واحد",
    "مجموعة (5) + مجموعة (2)", "مجموعة (5) + مجموعة (3)"
];
const AVATARS = ["🦁", "🐯", "🐻", "🐼", "🐨", "🐸", "🐔", "🦄", "🐉", "👽", "🤖", "🤠", "😎", "👻", "🔥"];
const STATUS_MSGS = {
    lion: ["يا عم الناس.. محدش قدك 🦁", "القمة بتاعتك وبس 👑", "مسيطر على السيرفر 🔥", "ملك الغابة وصل 🦁"],
    sheep: ["فوق يا اسطى.. البرسيم نازل 🐑", "يا فضيحتك وسط القبائل 😂", "الخروف وصل 👏", "مكانك محجوز في القاع 📉"],
    normal: ["شد حيلك لسه بدري 💪", "ركز في ورقك 🃏", "العب بذكاء 🧠"]
};

let state = { me: null, userData: null, isAdmin: false, round: 1, status: 'lobby', players: [] };
let unsubGame = null;
let unsubPlayers = null;
const timers = new Map();

/* =========================================
   3. البداية والتحقق
   ========================================= */
document.addEventListener('DOMContentLoaded', () => {
    // مراقب الدخول
    auth.onAuthStateChanged(async user => {
        if(user) {
            state.me = user.uid;
            await loadUserProfile(user.uid); 
        } else {
            state.me = null; state.userData = null; switchScreen('login');
        }
    });

    // تعريف الأزرار (Event Listeners)
    // 1. Auth
    document.getElementById('doLoginBtn').addEventListener('click', loginUser);
    document.getElementById('doRegisterBtn').addEventListener('click', registerUser);
    document.getElementById('goToRegister').addEventListener('click', () => switchScreen('register'));
    document.getElementById('goToLogin').addEventListener('click', () => switchScreen('login'));
    document.getElementById('logoutBtn').addEventListener('click', logoutUser);

    // 2. Profile
    document.getElementById('openProfileBtn').addEventListener('click', openProfileModal);
    document.getElementById('saveProfileChangesBtn').addEventListener('click', saveProfileChanges);
    document.getElementById('closeProfileModalBtn').addEventListener('click', () => document.getElementById('profileModal').style.display='none');

    // 3. Lobby Actions
    document.getElementById('startGameBtn').addEventListener('click', startGame);
    document.getElementById('resetGameBtn').addEventListener('click', resetGame);
    document.getElementById('factoryResetBtn').addEventListener('click', adminFactoryReset);
    document.getElementById('showFameBtn').addEventListener('click', showHallOfFame);

    // 4. Game Actions
    document.getElementById('leaveGameBtn').addEventListener('click', () => switchScreen('lobby'));
    document.getElementById('finishGameBtn').addEventListener('click', finishGameAndSave);
    document.getElementById('viewFullTableBtn').addEventListener('click', openFullTable);
    
    // Round Nav
    document.getElementById('prevRoundBtn').addEventListener('click', () => changeRound(-1));
    document.getElementById('nextRoundBtn').addEventListener('click', () => changeRound(1));
    
    // Admin Switching
    document.getElementById('lobbyChangeAdminBtn').addEventListener('click', openAdminSelect);
    document.getElementById('gameChangeAdminBtn').addEventListener('click', openAdminSelect);

    // Modals Close Buttons
    document.getElementById('closeFullTableBtn').addEventListener('click', () => document.getElementById('fullTableModal').style.display='none');
    document.getElementById('closeModalBtn').addEventListener('click', () => document.getElementById('skipModal').style.display='none');
    document.getElementById('closeSubModalBtn').addEventListener('click', () => document.getElementById('subModal').style.display='none');
    document.getElementById('closeFameBtn').addEventListener('click', () => document.getElementById('fameModal').style.display='none');
    document.getElementById('closeAdminModalBtn').addEventListener('click', () => document.getElementById('adminSelectModal').style.display='none');
    
    // Share
    document.getElementById('waBtn').addEventListener('click', shareWa);

    initAvatarGrid(); initEditAvatarGrid();
});

/* =========================================
   4. دوال مساعدة (Init & Auth)
   ========================================= */
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

async function loginUser() {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    if(!email || !pass) return toast('ادخل البيانات', true);
    try { await auth.signInWithEmailAndPassword(email, pass); } 
    catch(e) { console.error(e); toast('بيانات خطأ (تأكد من تفعيل الايميل في الكونسول)', true); }
}

async function registerUser() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPass').value;
    const avatar = document.getElementById('selectedAvatar').value;
    if(!name || !email || !pass) return toast('أكمل البيانات', true);
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection('users').doc(cred.user.uid).set({ name, avatar, email, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        toast(`تم التسجيل! أهلاً ${name} 🎉`);
    } catch(e) { console.error(e); toast('خطأ في التسجيل', true); }
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

/* =========================================
   5. منطق اللوبي (Lobby Logic)
   ========================================= */
async function enterGlobalLobby() {
    const playerRef = db.collection('rooms').doc(GAME_ID).collection('players').doc(state.me);
    
    // 🔥 هنا التغيير: الدخول الافتراضي waiting عشان الأدمن يختار
    // لكن لو أنا الأدمن، هدخل active عشان مخرجش نفسي بالغلط
    const isMeAdmin = (state.me === state.userData?.adminUid); // check local logic later
    
    await playerRef.set({
        name: state.userData.name, avatar: state.userData.avatar, uid: state.me,
        scores: [], 
        status: 'waiting', // الكل يدخل انتظار
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
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

        if(state.status === 'playing') {
            // لو اللعبة بدأت، وأنا active، ادخل الجيم. لو أنا waiting أفضل في اللوبي
            const mePlayer = state.players.find(p => p.uid === state.me);
            if (mePlayer && mePlayer.status === 'active') {
                switchScreen('game');
                renderGameUI();
            } else {
                switchScreen('lobby');
                document.getElementById('lobbySubtitle').textContent = "المباراة جارية... (أنت لست مشاركاً)";
                renderLobby(); // عشان يشوف مين بيلعب
            }
        } else {
            switchScreen('lobby');
            renderLobby();
        }
    });

    unsubPlayers = db.collection('rooms').doc(GAME_ID).collection('players').onSnapshot(snap => {
        state.players = [];
        snap.forEach(d => state.players.push({ id: d.id, ...d.data() }));
        if(state.status === 'playing') renderGameUI(); else renderLobby();
    });
}

function renderLobby() {
    const list = document.getElementById('onlinePlayersList'); list.innerHTML = '';
    
    // إظهار تحكم الأدمن
    document.getElementById('adminLobbyControls').style.display = state.isAdmin ? 'flex' : 'none';
    document.getElementById('playerLobbyControls').style.display = state.isAdmin ? 'none' : 'flex'; // زر الشرف للاعبين
    
    const title = state.isAdmin ? '👑 اختر التشكيلة الأساسية:' : '📋 قائمة المتواجدين';
    document.getElementById('lobbySubtitle').textContent = title;

    // ترتيب: الأدمن فوق
    const sorted = [...state.players].sort((a,b) => (a.uid === state.me ? -1 : 0));

    sorted.forEach(p => {
        const item = document.createElement('div');
        const isActive = p.status === 'active';
        item.className = `lobby-item ${isActive ? 'selected' : ''}`;
        
        const adminIcon = (p.uid === state.me && state.isAdmin) ? '👑' : ''; 
        
        item.innerHTML = `
            <div class="lobby-name"><span>${p.avatar||'👤'}</span> ${p.name} ${adminIcon}</div>
            <div class="lobby-check">${isActive ? '✔' : ''}</div>
        `;
        
        if(state.isAdmin) {
            item.onclick = () => togglePlayerStatus(p);
        }
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
    
    // تأكد أن الأدمن نفسه active عشان يدخل معاهم
    const me = state.players.find(p => p.uid === state.me);
    if(me && me.status !== 'active') {
        if(!confirm('أنت (الأدمن) لم تختر نفسك! ستكون مشاهداً فقط. موافق؟')) return;
    }

    await db.collection('rooms').doc(GAME_ID).update({ status: 'playing' });
}

/* =========================================
   6. منطق اللعبة (Game UI)
   ========================================= */
function renderGameUI() {
    // إظهار أدوات الأدمن
    document.getElementById('adminGameControls').style.display = state.isAdmin ? 'flex' : 'none';
    document.getElementById('adminFinishControls').style.display = state.isAdmin ? 'flex' : 'none';
    
    // تحديث الهيدر
    document.getElementById('roundNum').textContent = state.round;
    document.getElementById('roundDesc').textContent = PHASE_RULES[state.round - 1] || "";

    // فلترة اللاعبين (Active Only)
    const active = state.players.filter(p => p.status === 'active');
    const sorted = active.map(p => ({
        ...p, scores: p.scores || [],
        total: (p.scores||[]).reduce((a,b)=>a+(Number(b)||0),0)
    })).sort((a,b)=>a.total - b.total);

    // كارت الحالة
    const myIdx = sorted.findIndex(p => p.uid === state.me);
    if(myIdx !== -1) updateMyStatusCard(myIdx, sorted.length); 
    else document.getElementById('myStatusCard').style.display = 'none';

    // رسم الكروت
    const container = document.getElementById('cardsContainer');
    container.innerHTML = '';

    sorted.forEach((p, idx) => {
        const animal = getAnimalRank(idx, sorted.length);
        const card = document.createElement('div');
        
        let rankClass = '';
        if(animal.class === 'rank-lion') rankClass = 'card-lion';
        if(animal.class === 'rank-sheep') rankClass = 'card-sheep';

        card.className = `player-card ${rankClass} ${p.uid === state.me ? 'is-me' : ''}`;
        
        const currentScore = (p.scores[state.round-1] !== null && p.scores[state.round-1] !== undefined) ? p.scores[state.round-1] : '';

        card.innerHTML = `
            <div class="card-header" onclick="toggleCard(this)">
                <div class="p-main">
                    <span class="p-avatar">${animal.icon || p.avatar}</span>
                    <span class="p-name">${p.name}</span>
                </div>
                <div class="p-score-box">${p.total}</div>
            </div>
            
            <div class="card-body ${p.uid === state.me ? 'open' : ''}">
                ${ (p.uid === state.me || state.isAdmin) ? `
                <div class="input-area">
                    <label class="input-label">سكور الجولة ${state.round}</label>
                    <input type="number" pattern="[0-9]*" class="big-score-input" value="${currentScore}" 
                           oninput="onScoreInput('${p.id}', ${state.round-1}, this.value)" placeholder="-">
                </div>
                ` : `
                <div style="text-align:center; padding:10px; opacity:0.6;">
                    ${currentScore === '' ? 'جاري اللعب...' : `سكور الجولة: <b>${currentScore}</b>`}
                </div>
                ` }

                <div class="history-row">
                    ${ renderHistoryPills(p.scores) }
                </div>
                
                ${ state.isAdmin ? `<button onclick="openSubModalById('${p.id}')" class="btn-text" style="font-size:11px">🔄 تبديل اللاعب</button>` : '' }
            </div>
        `;
        container.appendChild(card);
    });
}

function renderHistoryPills(scores) {
    let html = '';
    for(let i=0; i<ROUNDS; i++) {
        const val = (scores[i] !== null && scores[i] !== undefined) ? scores[i] : '-';
        const active = (i === state.round - 1) ? 'active' : '';
        html += `<div class="hist-pill ${active}"><span>${i+1}</span>${val}</div>`;
    }
    return html;
}

window.toggleCard = function(header) {
    const body = header.nextElementSibling;
    body.classList.toggle('open');
}

window.onScoreInput = function(pid, rIdx, val) {
    const key = `${pid}-${rIdx}`;
    if(timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => saveScore(pid, rIdx, val), 600));
}

// ... (باقي الدوال: openFullTable, finishGame, resetGame, profile ... زي ما هي) ...
async function saveScore(pid, rIdx, val) { const num = (val===''||val==='-') ? null : Number(val); const p = state.players.find(x => x.id === pid); let s = p.scores ? [...p.scores] : []; while(s.length < ROUNDS) s.push(null); s[rIdx] = num; await db.collection('rooms').doc(GAME_ID).collection('players').doc(pid).update({ scores: s }); }
async function changeRound(d) { const newR = Math.min(ROUNDS, Math.max(1, state.round + d)); if(newR !== state.round) await db.collection('rooms').doc(GAME_ID).update({ round: newR }); }
function getAnimalRank(i, t) { if(i===0) return {icon:'🦁', class:'rank-lion'}; if(t>=2 && i===t-1) return {icon:'🐑', class:'rank-sheep'}; return {icon:'', class:''}; }
function updateMyStatusCard(idx, total) { const c=document.getElementById('myStatusCard'); const m=document.getElementById('statusMsg'); const e=document.getElementById('statusEmoji'); const t=document.getElementById('statusTitle'); let type='normal', icon='😐', lbl='عادي'; if(total>0 && idx===0) { type='lion'; icon='🦁'; lbl='الأسد'; } else if(total>=2 && idx===total-1) { type='sheep'; icon='🐑'; lbl='الخروف'; } const txts = STATUS_MSGS[type] || STATUS_MSGS['normal']; m.textContent = txts[Math.floor(Math.random()*txts.length)]; e.textContent=icon; t.textContent=lbl; c.style.display='flex'; }
function openFullTable() { const active = state.players.filter(p => p.status === 'active').sort((a,b)=>((a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)-(b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0))); const thead = document.getElementById('tHead'); thead.innerHTML = ''; ['اللاعب','مجموع'].forEach(t=>{const th=document.createElement('th'); th.textContent=t; thead.appendChild(th)}); for(let i=1; i<=ROUNDS; i++) { const th=document.createElement('th'); th.textContent=i; if(i===state.round) th.className='active-col'; thead.appendChild(th); } const tbody = document.getElementById('tBody'); tbody.innerHTML = ''; active.forEach((p, idx) => { const tr = document.createElement('tr'); const tdName = document.createElement('td'); tdName.textContent = p.name; tr.appendChild(tdName); const tdTotal = document.createElement('td'); tdTotal.textContent = (p.scores||[]).reduce((a,b)=>a+(Number(b)||0),0); tr.appendChild(tdTotal); for(let r=0; r<ROUNDS; r++) { const td = document.createElement('td'); td.textContent = (p.scores[r]!==null && p.scores[r]!==undefined) ? p.scores[r] : ''; tr.appendChild(td); } tbody.appendChild(tr); }); document.getElementById('fullTableModal').style.display = 'flex'; }
async function finishGameAndSave() { if(!confirm('حفظ وإنهاء؟'))return; const active = state.players.filter(p=>p.status==='active').sort((a,b)=>((a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)-(b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0))); const gd={date:firebase.firestore.FieldValue.serverTimestamp(),owner:state.me,lionName:active[0].name,lionScore:(active[0].scores||[]).reduce((x,y)=>x+(Number(y)||0),0),sheepName:active[active.length-1].name,sheepScore:(active[active.length-1].scores||[]).reduce((x,y)=>x+(Number(y)||0),0),playersCount:active.length}; await db.collection('history').add(gd); toast('تم الحفظ 🏆'); await db.collection('rooms').doc(GAME_ID).update({status:'lobby',round:1}); const b=db.batch(); state.players.forEach(p=>b.update(db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id),{scores:[],status:'waiting'})); await b.commit(); }
async function resetGame() { if(!confirm('تصفير؟'))return; const b=db.batch(); b.update(db.collection('rooms').doc(GAME_ID),{round:1,status:'lobby'}); state.players.forEach(p=>b.update(db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id),{scores:[],status:'waiting'})); await b.commit(); }
async function adminFactoryReset() { if(!confirm('مسح شامل؟'))return; const b=db.batch(); (await db.collection('history').get()).forEach(d=>b.delete(d.ref)); b.update(db.collection('rooms').doc(GAME_ID),{round:1,status:'lobby'}); (await db.collection('rooms').doc(GAME_ID).collection('players').get()).forEach(d=>b.delete(d.ref)); await b.commit(); toast('تم المسح'); }
function showHallOfFame() { const l=document.getElementById('fameList'); l.innerHTML='...'; document.getElementById('fameModal').style.display='flex'; db.collection('history').orderBy('date','desc').limit(20).get().then(s=>{l.innerHTML=''; s.forEach(d=>{const r=d.data(); const el=document.createElement('div'); el.className='fame-item'; el.innerHTML=`<div class="fame-date">${r.date?r.date.toDate().toLocaleDateString('ar-EG'):''}</div><div class="fame-row"><span class="lion-badge">🦁 ${r.lionName}</span> <span class="score-badge">${r.lionScore}</span></div><div class="fame-row"><span class="sheep-badge">🐑 ${r.sheepName}</span> <span class="score-badge">${r.sheepScore}</span></div>`; l.appendChild(el);});}).catch(e=>l.innerHTML='خطأ'); }
function openProfileModal() { document.getElementById('editName').value=state.userData.name; document.getElementById('editSelectedAvatar').value=state.userData.avatar; document.getElementById('profileModal').style.display='flex'; }
async function saveProfileChanges() { const n=document.getElementById('editName').value.trim(); const a=document.getElementById('editSelectedAvatar').value; const p=document.getElementById('editPass').value; try{await db.collection('users').doc(state.me).update({name:n,avatar:a}); await db.collection('rooms').doc(GAME_ID).collection('players').doc(state.me).update({name:n,avatar:a}); if(p)await auth.currentUser.updatePassword(p); state.userData.name=n; state.userData.avatar=a; document.getElementById('userNameDisplay').textContent=n; document.getElementById('userAvatarDisplay').textContent=a; document.getElementById('profileModal').style.display='none'; toast('تم الحفظ');}catch(e){toast('خطأ',true);} }
function openAdminSelect() { const l=document.getElementById('adminCandidatesList'); l.innerHTML=''; state.players.forEach(p=>{if(p.uid===state.me)return; const d=document.createElement('div'); d.className='lobby-item'; d.textContent=p.name; d.onclick=()=>transferAdmin(p); l.appendChild(d);}); document.getElementById('adminSelectModal').style.display='flex'; }
async function transferAdmin(p) { if(confirm('نقل الأدمن؟')) { await db.collection('rooms').doc(GAME_ID).update({admin:p.uid}); document.getElementById('adminSelectModal').style.display='none'; } }
window.openSubModalById = function(pid) { const p = state.players.find(x => x.id === pid); if(p) openSubModal(p); }
function openSubModal(pOut) { playerToSubId = pOut.id; document.getElementById('subTargetName').textContent = `خروج: ${pOut.name}`; const bench = state.players.filter(p => p.status === 'waiting'); const list = document.getElementById('benchList'); list.innerHTML = ''; if(!bench.length) list.innerHTML = '<div style="color:#aaa">لا يوجد بدلاء</div>'; bench.forEach(sub => { const el = document.createElement('div'); el.className='lobby-item'; el.textContent=`نزول: ${sub.name}`; el.onclick = () => performSub(pOut, sub); list.appendChild(el); }); document.getElementById('subModal').style.display = 'flex'; }
async function performSub(outP, inP) { if(!confirm(`تبديل ${outP.name} بـ ${inP.name}؟`)) return; const batch = db.batch(); const ref = db.collection('rooms').doc(GAME_ID).collection('players'); batch.update(ref.doc(outP.id), { status: 'waiting', scores: [] }); batch.update(ref.doc(inP.id), { status: 'active', scores: outP.scores }); await batch.commit(); document.getElementById('subModal').style.display = 'none'; }
function calcLeader() { const sorted=state.players.filter(p=>p.status==='active').sort((a,b)=>((a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)-(b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0))); if(sorted.length){toast(`🦁 ${sorted[0].name}`); if(sorted.length>1)setTimeout(()=>toast(`🐑 ${sorted[sorted.length-1].name}`,true),2000);} }
function randomSkip() { const a=state.players.filter(p=>p.status==='active'); if(a.length) showModal(a[Math.floor(Math.random()*a.length)].name, 'سكيب عشوائي'); }
function smartSkip() { const a=state.players.filter(p=>p.status==='active'); if(!a.length)return; const s=a.sort((a,b)=>((a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)-(b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0))); const i=s.findIndex(p=>p.uid===state.me); if(i===-1)return randomSkip(); let t; if(i===0)t=s[1]; else if(i===s.length-1)t=s[i-1]; else t=(Math.abs(((s[i].scores||[]).reduce((x,y)=>x+(Number(y)||0),0))-((s[i-1].scores||[]).reduce((x,y)=>x+(Number(y)||0),0)))<=Math.abs(((s[i].scores||[]).reduce((x,y)=>x+(Number(y)||0),0))-((s[i+1].scores||[]).reduce((x,y)=>x+(Number(y)||0),0))))?s[i-1]:s[i+1]; showModal(t.name,'سكيب ذكي'); }
function showModal(n,t) { document.getElementById('skipType').textContent=t; document.getElementById('skipTarget').textContent=n; document.getElementById('skipModal').style.display='flex'; document.getElementById('skipAudio').play(); }
function toast(m, e=false) { const t=document.getElementById('toast'); t.innerHTML=m; t.className=e?'toast show error':'toast show'; setTimeout(()=>t.classList.remove('show'),3000); }
function shareWa() { window.open(`https://wa.me/?text=${encodeURIComponent(`يلا Phase 10 🔥\n${window.location.href}`)}`); }
function switchScreen(s) { ['loginScreen','registerScreen','lobbyScreen','gameRoom'].forEach(id => document.getElementById(id).style.display='none'); if(s==='login') document.getElementById('loginScreen').style.display='block'; if(s==='register') document.getElementById('registerScreen').style.display='block'; if(s==='lobby') document.getElementById('lobbyScreen').style.display='block'; if(s==='game') document.getElementById('gameRoom').style.display='block'; }
