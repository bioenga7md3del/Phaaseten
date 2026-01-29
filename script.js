/* =========================================
   1. إعدادات Firebase
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

/* =========================================
   2. الثوابت والقواميس
   ========================================= */
const ROUNDS = 10;
const PHASE_RULES = [
    "2 مجموعات (3)", "مجموعة (3) + تسلسل (4)", "مجموعة (4) + تسلسل (4)", "تسلسل (7)",
    "تسلسل (8)", "تسلسل (9)", "2 مجموعات (4)", "7 كروت لون واحد",
    "مجموعة (5) + مجموعة (2)", "مجموعة (5) + مجموعة (3)"
];

const STATUS_MSGS = {
    lion: ["يا عم الناس.. محدش قدك 🦁", "القمة بتاعتك وبس 👑", "مسيطر على السيرفر 🔥"],
    tiger: ["النمر بيخربش.. فاضل تكه 🐯", "عينك على اللي فوق 👀"],
    normal: ["خليك في الأمان 😐", "العب بذكاء 🎲", "جمع كروتك صح 🃏"],
    goat: ["يا معزة اهربي 🐐", "الوضع مش مطمن ⚠️"],
    sheep: ["فوق يا اسطى.. البرسيم نازل 🐑🌿", "يا فضيحتك وسط القبائل 😂", "الخروف وصل 👏"]
};

// المتغيرات
let state = { me: null, name: null, room: null, owner: null, round: 1, status: 'waiting', players: [] };
let unsubRoom = null;
let unsubPlayers = null;
let wakeLock = null;
const timers = new Map();
let playerToSubId = null; // اللاعب المراد استبداله

/* =========================================
   3. التهيئة والتحقق من التسجيل
   ========================================= */
document.addEventListener('DOMContentLoaded', () => {
    // 1. تسجيل مجهول في فايربيس
    firebase.auth().onAuthStateChanged(async u => {
        if(!u) await firebase.auth().signInAnonymously();
        else state.me = u.uid;
        checkLocalProfile();
    });

    // Wake Lock
    document.addEventListener('click', requestWakeLock, { once: true });

    // أزرار التسجيل واللوبي
    document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
    document.getElementById('createBtn').addEventListener('click', createRoom);
    document.getElementById('joinBtn').addEventListener('click', joinRoom);
    document.getElementById('cleanBtn').addEventListener('click', cleanOldRooms);
    document.getElementById('exitLobbyBtn').addEventListener('click', exitRoom);
    document.getElementById('startGameBtn').addEventListener('click', startGame);

    // أزرار اللعب
    document.getElementById('copyCodeBtn').addEventListener('click', copyCode);
    document.getElementById('waBtn').addEventListener('click', shareWa);
    document.getElementById('endGameBtn').addEventListener('click', exitRoom);
    document.getElementById('prevRoundBtn').addEventListener('click', () => changeRound(-1));
    document.getElementById('nextRoundBtn').addEventListener('click', () => changeRound(1));
    document.getElementById('leaderBtn').addEventListener('click', calcLeader);
    document.getElementById('randomSkipBtn').addEventListener('click', randomSkip);
    document.getElementById('smartSkipBtn').addEventListener('click', smartSkip);
    
    // المودال
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('closeSubModalBtn').addEventListener('click', () => document.getElementById('subModal').style.display = 'none');

    // كود الغرفة من الرابط
    const params = new URLSearchParams(window.location.search);
    if(params.get('room')) document.getElementById('roomInput').value = params.get('room');
});

function checkLocalProfile() {
    const savedName = localStorage.getItem('phase10_name');
    if (savedName) {
        state.name = savedName;
        document.getElementById('welcomeMsg').textContent = `أهلاً، ${savedName} 👋`;
        switchScreen('landing');
    } else {
        switchScreen('register');
    }
}

function saveProfile() {
    const name = document.getElementById('regNameInput').value.trim();
    if(!name) return toast('اكتب اسمك الأول', true);
    localStorage.setItem('phase10_name', name);
    state.name = name;
    document.getElementById('welcomeMsg').textContent = `أهلاً، ${name} 👋`;
    switchScreen('landing');
}

/* =========================================
   4. إدارة الغرفة واللوبي (Lobby)
   ========================================= */
async function createRoom() {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        // إنشاء الغرفة بحالة waiting
        await db.collection('rooms').doc(code).set({
            owner: state.me, round: 1, status: 'waiting', 
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        joinRoomLogic(code); // الانضمام التلقائي
    } catch(e) { console.error(e); toast('خطأ في الإنشاء', true); }
}

async function joinRoom() {
    const code = document.getElementById('roomInput').value.trim();
    if(!code) return toast('اكتب الكود', true);
    // تأكد الغرفة موجودة
    const doc = await db.collection('rooms').doc(code).get();
    if(!doc.exists) return toast('غرفة غير موجودة', true);
    joinRoomLogic(code);
}

async function joinRoomLogic(code) {
    state.room = code;
    // إضافة اللاعب لقائمة الانتظار (waiting)
    await db.collection('rooms').doc(code).collection('players').doc(state.me).set({
        name: state.name, uid: state.me, scores: [], status: 'waiting',
        joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    subscribe(code);
}

function subscribe(code) {
    if(unsubRoom) unsubRoom();
    if(unsubPlayers) unsubPlayers();

    // الاستماع للغرفة
    unsubRoom = db.collection('rooms').doc(code).onSnapshot(doc => {
        if(!doc.exists) { exitRoom(); return toast('الغرفة أغلقت', true); }
        const d = doc.data();
        state.owner = d.owner;
        state.status = d.status || 'waiting';

        // تنبيه تغيير الجولة
        if(state.round !== (d.round || 1) && state.status === 'playing') {
            playSound('winAudio');
            toast(`بدأت الجولة ${d.round || 1}`);
        }
        state.round = d.round || 1;

        // توجيه الشاشات
        if(state.status === 'waiting') {
            switchScreen('lobby');
            renderLobby();
        } else {
            switchScreen('game');
            renderGameUI();
        }
    });

    // الاستماع للاعبين
    unsubPlayers = db.collection('rooms').doc(code).collection('players').onSnapshot(snap => {
        state.players = [];
        snap.forEach(d => state.players.push({ id: d.id, ...d.data() }));
        
        if(state.status === 'waiting') renderLobby();
        else renderGameUI();
    });
}

/* =========================================
   5. منطق اللوبي (Lobby Logic)
   ========================================= */
function renderLobby() {
    document.getElementById('lobbyCodeDisplay').textContent = state.room;
    const list = document.getElementById('lobbyPlayersList');
    list.innerHTML = '';
    
    const isAdmin = (state.me === state.owner);
    document.getElementById('startGameBtn').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('lobbyMsg').textContent = isAdmin ? 'اختر التشكيلة الأساسية ثم ابدأ:' : 'في انتظار الأدمن ليختار التشكيلة...';

    state.players.forEach(p => {
        const item = document.createElement('div');
        item.className = `lobby-item ${p.status === 'active' ? 'selected' : ''}`;
        
        // الأيقونة حسب الحالة
        let icon = p.status === 'active' ? '✅' : '⏳';
        
        item.innerHTML = `
            <div class="lobby-name"><span>${icon}</span> ${p.name}</div>
            <div class="check-indicator">${p.status === 'active' ? '✓' : ''}</div>
        `;

        // الأدمن فقط يقدر يختار
        if(isAdmin) {
            item.onclick = () => togglePlayerStatus(p);
            item.style.cursor = 'pointer';
        }
        list.appendChild(item);
    });
}

async function togglePlayerStatus(player) {
    const newStatus = player.status === 'active' ? 'waiting' : 'active';
    await db.collection('rooms').doc(state.room).collection('players').doc(player.id).update({ status: newStatus });
}

async function startGame() {
    const activeCount = state.players.filter(p => p.status === 'active').length;
    if(activeCount < 1) return toast('اختر لاعب واحد على الأقل', true);
    await db.collection('rooms').doc(state.room).update({ status: 'playing' });
}

/* =========================================
   6. منطق اللعبة والتبديل (Substitution)
   ========================================= */
function renderGameUI() {
    const isAdmin = (state.me === state.owner);
    const activePlayers = state.players.filter(p => p.status === 'active');

    // إعدادات العرض
    document.getElementById('adminControls').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('viewerControls').style.display = isAdmin ? 'none' : 'block';
    document.getElementById('roundNum').textContent = state.round;
    document.getElementById('viewRoundNum').textContent = state.round;
    document.getElementById('roundDescAdmin').textContent = PHASE_RULES[state.round - 1] || "";
    document.getElementById('roundDescViewer').textContent = PHASE_RULES[state.round - 1] || "";

    // ترتيب اللاعبين النشطين
    const sortedData = activePlayers.map(p => ({
        ...p,
        scores: Array.isArray(p.scores) ? p.scores : [],
        total: (p.scores || []).reduce((a, b) => a + (Number(b) || 0), 0)
    })).sort((a, b) => a.total - b.total);

    // تحديث كارت الحالة (صامت)
    const myIndex = sortedData.findIndex(p => p.uid === state.me);
    if(myIndex !== -1) updateMyStatusCard(myIndex, sortedData.length);
    else document.getElementById('myStatusCard').style.display = 'none';

    // رسم الجدول
    const thead = document.getElementById('tHead');
    thead.innerHTML = ''; 
    const thName = document.createElement('th'); thName.textContent = 'اللاعب'; thead.appendChild(thName);
    const thTotal = document.createElement('th'); thTotal.textContent = 'مجموع'; thead.appendChild(thTotal);
    const thRank = document.createElement('th'); thRank.textContent = '#'; thead.appendChild(thRank);
    for(let i=1; i<=ROUNDS; i++) {
        const th = document.createElement('th'); th.textContent = i;
        if(i === state.round) th.className = 'active-col';
        thead.appendChild(th);
    }

    const tbody = document.getElementById('tBody');
    tbody.innerHTML = '';

    sortedData.forEach((p, idx) => {
        const animalInfo = getAnimalRank(idx, sortedData.length);
        const tr = document.createElement('tr');
        if(animalInfo.class) tr.className = animalInfo.class;

        // 1. الاسم (قابل للنقر للتبديل عند الأدمن)
        const tdName = document.createElement('td');
        tdName.innerHTML = `${animalInfo.icon} ${p.name}`;
        if(isAdmin) {
            tdName.style.cursor = 'pointer';
            tdName.title = "اضغط للتبديل";
            tdName.onclick = () => openSubModal(p);
        }
        tr.appendChild(tdName);

        // 2. المجموع
        const tdTotal = document.createElement('td');
        tdTotal.style.fontWeight = '900'; tdTotal.textContent = p.total;
        tr.appendChild(tdTotal);

        // 3. الترتيب
        const tdRank = document.createElement('td');
        tdRank.innerHTML = `<span style="font-size:12px; opacity:0.7">#${idx + 1}</span>`;
        tr.appendChild(tdRank);

        // 4. السكور
        for(let r=0; r<ROUNDS; r++) {
            const td = document.createElement('td');
            if(r === state.round - 1) {
                td.className = 'active-col';
                const inp = document.createElement('input');
                inp.type = 'number'; inp.pattern = '[0-9]*'; inp.className = 'score-inp';
                inp.value = (p.scores[r] !== undefined && p.scores[r] !== null) ? p.scores[r] : '';
                
                if(!isAdmin && p.uid !== state.me) { inp.disabled = true; inp.style.opacity = "0.5"; }
                
                inp.oninput = () => {
                    const key = `${p.id}-${r}`;
                    if(timers.has(key)) clearTimeout(timers.get(key));
                    timers.set(key, setTimeout(() => saveScore(p.id, r, inp.value), 600));
                };
                inp.onblur = () => saveScore(p.id, r, inp.value);
                td.appendChild(inp);
            } else {
                td.textContent = (p.scores[r] !== undefined && p.scores[r] !== null) ? p.scores[r] : '';
                td.style.opacity = '0.5';
            }
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });
}

// فتح مودال التبديل
function openSubModal(playerToOut) {
    playerToSubId = playerToOut.id;
    document.getElementById('subTargetName').textContent = `خروج: ${playerToOut.name}`;
    
    // جلب لاعبي الاحتياطي (waiting)
    const benchPlayers = state.players.filter(p => p.status === 'waiting');
    const list = document.getElementById('benchList');
    list.innerHTML = '';

    if(benchPlayers.length === 0) {
        list.innerHTML = '<div style="padding:10px; color:var(--text-muted)">لا يوجد بدلاء في الاحتياطي</div>';
    } else {
        benchPlayers.forEach(sub => {
            const item = document.createElement('div');
            item.className = 'bench-item';
            item.textContent = `نزول: ${sub.name}`;
            item.onclick = () => performSub(playerToOut, sub);
            list.appendChild(item);
        });
    }
    document.getElementById('subModal').style.display = 'flex';
}

// تنفيذ التبديل
async function performSub(playerOut, playerIn) {
    if(!confirm(`تأكيد: خروج ${playerOut.name} ونزول ${playerIn.name} بنفس النقاط؟`)) return;
    
    const batch = db.batch();
    const roomRef = db.collection('rooms').doc(state.room).collection('players');

    // 1. الخارج يروح انتظار (بدون سكور عشان ميتلخبطش لما يرجع)
    batch.update(roomRef.doc(playerOut.id), { status: 'waiting', scores: [] });

    // 2. الداخل يروح نشط (وياخد سكور اللي خرج)
    batch.update(roomRef.doc(playerIn.id), { status: 'active', scores: playerOut.scores });

    await batch.commit();
    document.getElementById('subModal').style.display = 'none';
    toast('تم التبديل بنجاح ✅');
}

/* =========================================
   7. الوظائف المساعدة
   ========================================= */
async function saveScore(pid, rIdx, val) {
    const num = (val === '' || val === '-') ? null : Number(val);
    // جلب السكور القديم
    const player = state.players.find(x => x.id === pid);
    let newScores = player.scores ? [...player.scores] : [];
    while(newScores.length < ROUNDS) newScores.push(null);
    newScores[rIdx] = num;
    
    await db.collection('rooms').doc(state.room).collection('players').doc(pid).update({ 
        scores: newScores, updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
    });
}

function updateMyStatusCard(myRank, total) {
    const card = document.getElementById('myStatusCard');
    const msg = document.getElementById('statusMsg');
    const emoji = document.getElementById('statusEmoji');
    const title = document.getElementById('statusTitle');

    let type = 'normal', icon = '😐', label = 'لاعب عادي', css = 'status-normal';
    
    if(total > 0 && myRank === 0) { type = 'lion'; icon = '🦁'; label = 'أنت الأسد'; css = 'status-lion'; }
    else if(total >= 2 && myRank === total - 1) { type = 'sheep'; icon = '🐑'; label = 'أنت الخروف'; css = 'status-sheep'; }
    else if(total >= 3 && myRank === 1) { type = 'tiger'; icon = '🐯'; label = 'أنت النمر'; css = 'status-tiger'; }
    else if(total >= 4 && myRank === total - 2) { type = 'goat'; icon = '🐐'; label = 'أنت المعزة'; css = 'status-goat'; }

    // تحديث النص عشوائياً عند إعادة الرسم
    const list = STATUS_MSGS[type] || STATUS_MSGS['normal'];
    msg.textContent = list[Math.floor(Math.random() * list.length)];
    
    card.style.display = 'flex';
    card.className = `glass-card status-card ${css}`;
    emoji.textContent = icon;
    title.textContent = label;
}

function getAnimalRank(index, total) {
    if(index === 0) return { icon: '🦁', class: 'rank-lion' };
    if(total >= 2 && index === total-1) return { icon: '🐑', class: 'rank-sheep' };
    if(total >= 3 && index === 1) return { icon: '🐯', class: 'rank-tiger' };
    if(total >= 4 && index === total-2) return { icon: '🐐', class: 'rank-goat' };
    return { icon: '', class: '' };
}

// باقي الدوال (أصوات، سكيب، تنظيف)
function playSound(id) { const a = document.getElementById(id); if(a) { a.currentTime=0; a.play().catch(()=>{}); } }
function toast(m, e=false) { const t=document.getElementById('toast'); t.innerHTML=m; t.className=e?'toast show error':'toast show'; setTimeout(()=>t.classList.remove('show'),3000); }
async function requestWakeLock() { try { if('wakeLock' in navigator) wakeLock=await navigator.wakeLock.request('screen'); } catch(e){} }
function switchScreen(s) {
    ['registerScreen','landingScreen','lobbyScreen','gameRoom'].forEach(id => document.getElementById(id).style.display='none');
    if(s==='register') document.getElementById('registerScreen').style.display='block';
    if(s==='landing') document.getElementById('landingScreen').style.display='block';
    if(s==='lobby') document.getElementById('lobbyScreen').style.display='block';
    if(s==='game') { document.getElementById('gameRoom').style.display='block'; requestWakeLock(); }
}

// ... (نفس دوال calcLeader, changeRound, etc القديمة)
async function changeRound(d) {
    const newR = Math.min(ROUNDS, Math.max(1, state.round + d));
    if(newR !== state.round) await db.collection('rooms').doc(state.room).update({ round: newR });
}
function calcLeader() {
    const active = state.players.filter(p => p.status === 'active');
    const sorted = active.sort((a,b) => {
        const sa = (a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
        const sb = (b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
        return sa - sb;
    });
    if(sorted.length) {
        toast(`👑 الأسد: ${sorted[0].name}`);
        playSound('lionAudio');
        if(sorted.length > 1) {
            setTimeout(() => {
                toast(`🐑 الخروف: ${sorted[sorted.length-1].name}`, true);
                playSound('sheepAudio');
            }, 2000);
        }
    }
}
function randomSkip() { /* نفس الكود القديم */ 
    const active = state.players.filter(p => p.status === 'active');
    if(!active.length) return;
    const r = active[Math.floor(Math.random() * active.length)];
    showModal(r.name, 'سكيب عشوائي 🎲');
}
function smartSkip() { /* نفس الكود القديم ولكن على active players فقط */
    const active = state.players.filter(p => p.status === 'active');
    if(!active.length) return;
    const sorted = [...active].sort((a,b) => {
        const sa = (a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
        const sb = (b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
        return sa - sb;
    });
    const myIdx = sorted.findIndex(p => p.uid === state.me);
    if(myIdx === -1) return randomSkip();
    // ... باقي لوجيك السكيب الذكي ...
    let target;
    if(myIdx === 0) target = sorted[1];
    else if(myIdx === sorted.length - 1) target = sorted[myIdx - 1];
    else {
        const prev = sorted[myIdx - 1];
        const next = sorted[myIdx + 1];
        const myScore = (sorted[myIdx].scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
        const prevScore = (prev.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
        const nextScore = (next.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
        if(Math.abs(myScore - prevScore) <= Math.abs(myScore - nextScore)) target = prev; else target = next;
    }
    showModal(target.name, 'سكيب ذكي 🧠');
}
function showModal(n,t) { document.getElementById('skipType').textContent=t; document.getElementById('skipTarget').textContent=n; document.getElementById('skipModal').style.display='flex'; playSound('skipAudio'); }
function closeModal() { document.getElementById('skipModal').style.display='none'; }
async function cleanOldRooms() { /* نفس الكود القديم */ 
  if(!confirm('حذف الغرف القديمة (24س)؟')) return;
  const cutoff = new Date(Date.now() - 86400000);
  try {
      const snap = await db.collection('rooms').where('createdAt', '<', cutoff).get();
      if(snap.empty) return toast('لا يوجد غرف قديمة');
      const batch = db.batch();
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
      toast(`تم حذف ${snap.size} غرفة`);
  } catch(e) { console.error(e); toast('فشل التنظيف', true); }
}
function exitRoom() {
    if(unsubRoom) unsubRoom(); if(unsubPlayers) unsubPlayers();
    state.room = null; switchScreen('landing');
}
function copyCode() { navigator.clipboard.writeText(state.room); toast('تم نسخ الكود'); }
function shareWa() { const u=window.location.href.split('?')[0]; window.open(`https://wa.me/?text=${encodeURIComponent(`يلا Phase 10 🔥\n${u}?room=${state.room}\nكود: *${state.room}*`)}`); }
