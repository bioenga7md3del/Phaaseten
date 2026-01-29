console.log("🚀 بدء تشغيل السكريبت (نسخة الاستقرار)...");

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
const auth = firebase.auth();

// 🔥 إعدادات الاستقرار (منع التقطيع) 🔥
db.settings({ 
    experimentalForceLongPolling: true, // عشان يشتغل غصب عن الشبكة
    experimentalAutoDetectLongPolling: false,
    merge: true 
});

/* =========================================
   2. المتغيرات
   ========================================= */
const GAME_ID = "main_game_room";
const ROUNDS = 10;
const PHASE_RULES = [
    "2 مجموعات (3)", "مجموعة (3) + تسلسل (4)", "مجموعة (4) + تسلسل (4)", "تسلسل (7)",
    "تسلسل (8)", "تسلسل (9)", "2 مجموعات (4)", "7 كروت لون واحد",
    "مجموعة (5) + مجموعة (2)", "مجموعة (5) + مجموعة (3)"
];
const AVATARS = ["🦁", "🐯", "🐻", "🐼", "🐨", "🐸", "🐔", "🦄", "🐉", "👽", "🤖", "🤠", "😎", "👻", "🔥"];

let state = { me: null, userData: null, isAdmin: false, round: 1, status: 'lobby', players: [] };
let unsubGame = null;
let unsubPlayers = null;
let wakeLock = null;
let isConnected = false; // 🔥 علم عشان نمنع التكرار

/* =========================================
   3. البداية (DOM Ready)
   ========================================= */
document.addEventListener('DOMContentLoaded', () => {
    console.log("📌 الصفحة جاهزة");

    // 🛑 منع التكرار في Auth Listener
    auth.onAuthStateChanged(async user => {
        if (user && state.me === user.uid && isConnected) {
            console.log("🔄 المستخدم موجود بالفعل، تجاهل التحديث.");
            return; 
        }

        if(user) { 
            console.log("👤 تم التعرف على المستخدم:", user.uid);
            state.me = user.uid; 
            await loadUserProfile(user.uid); 
        } else { 
            console.log("👤 لا يوجد مستخدم، العودة للدخول.");
            state.me = null; state.userData = null; 
            isConnected = false; // ريست للاتصال
            if(unsubGame) unsubGame(); 
            if(unsubPlayers) unsubPlayers();
            switchScreen('login'); 
        }
    });

    // منع انطفاء الشاشة
    document.addEventListener('click', async () => { try { if('wakeLock' in navigator) wakeLock=await navigator.wakeLock.request('screen'); } catch(e){} }, { once: true });

    // تعريف الأزرار (Safe Click)
    const safeClick = (id, func) => { 
        const el = document.getElementById(id); 
        if(el) el.addEventListener('click', func);
    };

    safeClick('doLoginBtn', loginUser);
    safeClick('doRegisterBtn', registerUser);
    safeClick('goToRegister', () => switchScreen('register'));
    safeClick('goToLogin', () => switchScreen('login'));
    safeClick('logoutBtn', logoutUser);
    
    safeClick('startGameBtn', handleStartOrResumeGame);
    safeClick('adminBackToLobbyBtn', () => { switchScreen('lobby'); renderLobby(); });
    safeClick('resetGameBtn', resetGame);
    safeClick('factoryResetBtn', adminFactoryReset);
    safeClick('syncPlayersBtn', syncPlayers);
    safeClick('showFameBtn', openFameModalForce);
    safeClick('leaveGameBtn', () => switchScreen('lobby'));
    safeClick('finishGameBtn', finishGameAndSave);
    safeClick('viewFullTableBtn', openFullTable);
    safeClick('leaderBtn', calcLeader);
    
    safeClick('prevRoundBtn', () => changeRound(-1));
    safeClick('nextRoundBtn', () => changeRound(1));
    safeClick('randomSkipBtn', randomSkip);
    safeClick('smartSkipBtn', smartSkip);
    safeClick('lobbyChangeAdminBtn', openAdminSelect);
    safeClick('gameChangeAdminBtn', openAdminSelect);
    
    safeClick('closeFullTableBtn', () => document.getElementById('fullTableModal').style.display='none');
    safeClick('closeModalBtn', () => document.getElementById('skipModal').style.display='none');
    safeClick('closeSubModalBtn', () => document.getElementById('subModal').style.display='none');
    safeClick('closeFameBtn', () => document.getElementById('fameModal').style.display='none');
    safeClick('closeAdminModalBtn', () => document.getElementById('adminSelectModal').style.display='none');
    safeClick('waBtn', shareWa);

    if(document.getElementById('avatarGrid')) initAvatarGrid();
    if(document.getElementById('editAvatarGrid')) initEditAvatarGrid();
});

/* =========================================
   4. دوال المستخدم
   ========================================= */
function initAvatarGrid() {
    const grid = document.getElementById('avatarGrid'); if(!grid) return;
    AVATARS.forEach((av, idx) => {
        const div = document.createElement('div'); div.className = `avatar-option ${idx === 0 ? 'selected' : ''}`; div.textContent = av;
        div.onclick = () => { document.querySelectorAll('#avatarGrid .avatar-option').forEach(el => el.classList.remove('selected')); div.classList.add('selected'); document.getElementById('selectedAvatar').value = av; };
        grid.appendChild(div);
    });
}
function initEditAvatarGrid() {
    const grid = document.getElementById('editAvatarGrid'); if(!grid) return;
    AVATARS.forEach((av) => {
        const div = document.createElement('div'); div.className = 'avatar-option'; div.textContent = av;
        div.onclick = () => { document.querySelectorAll('#editAvatarGrid .avatar-option').forEach(el => el.classList.remove('selected')); div.classList.add('selected'); document.getElementById('editSelectedAvatar').value = av; };
        grid.appendChild(div);
    });
}

async function loginUser() { 
    const email=document.getElementById('loginEmail').value; 
    const pass=document.getElementById('loginPass').value; 
    if(!email||!pass) return toast('بيانات ناقصة',true); 
    try{
        await auth.signInWithEmailAndPassword(email, pass);
    }catch(e){ toast('بيانات خطأ',true); } 
}

async function registerUser() { 
    const name=document.getElementById('regName').value.trim(); 
    const email=document.getElementById('regEmail').value; 
    const pass=document.getElementById('regPass').value; 
    const avatar=document.getElementById('selectedAvatar').value; 
    if(!name||!email||!pass) return toast('بيانات ناقصة',true); 
    try{
        const chk=await db.collection('users').where('name','==',name).get(); 
        if(!chk.empty)return toast('الاسم مأخوذ',true); 
        const c=await auth.createUserWithEmailAndPassword(email,pass); 
        await db.collection('users').doc(c.user.uid).set({
            name,avatar,email,createdAt:firebase.firestore.FieldValue.serverTimestamp(),
            lionCount:0, sheepCount:0, tigerCount:0, goatCount:0, gamesPlayed:0, accumulatedScore:0
        });
    }catch(e){toast('خطأ تسجيل',true);} 
}

async function loadUserProfile(uid) { 
    try{
        const d=await db.collection('users').doc(uid).get(); 
        if(d.exists){
            state.userData=d.data(); 
            document.getElementById('userNameDisplay').textContent=state.userData.name; 
            document.getElementById('userAvatarDisplay').textContent=state.userData.avatar; 
            enterGlobalLobby();
        }
    }catch(e){ console.error(e); } 
}

async function logoutUser() { await auth.signOut(); switchScreen('login'); }

/* =========================================
   5. اللوبي والاتصال (المنطقة المعدلة)
   ========================================= */
async function enterGlobalLobby() {
    // 🛑 لو احنا متصلين أصلاً، متعملش حاجة
    if (isConnected) {
        console.log("⚠️ تم تجاهل اتصال مكرر.");
        switchScreen('lobby');
        return;
    }

    console.log("🚀 جاري الاتصال باللوبي...");
    switchScreen('lobby'); 
    
    try {
        // تأكد من وجود الغرفة
        const gameDoc = await db.collection('rooms').doc(GAME_ID).get();
        if(!gameDoc.exists) await db.collection('rooms').doc(GAME_ID).set({ admin: state.me, round: 1, status: 'lobby', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        
        // سجل وجود اللاعب
        await db.collection('rooms').doc(GAME_ID).collection('players').doc(state.me).set({
            name: state.userData.name, avatar: state.userData.avatar, uid: state.me, scores: [], status: 'waiting', lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        isConnected = true; // ✅ علم إننا اتصلنا خلاص
        subscribe();
    } catch(e) {
        console.error("❌ خطأ اتصال:", e);
    }
}

function subscribe() {
    // 🛑 لو فيه مستمعين شغالين، متعملش جداد (ده اللي كان بيعمل الرعشة)
    if(unsubGame || unsubPlayers) {
        console.log("⚠️ المستمعين شغالين بالفعل، لن يتم إعادة التحميل.");
        return;
    }

    console.log("📡 بدء استقبال البيانات...");

    // 1. مراقب الغرفة
    unsubGame = db.collection('rooms').doc(GAME_ID).onSnapshot(doc => {
        if(!doc.exists) return; const d = doc.data();
        state.isAdmin = (d.admin === state.me);
        if(!d.admin) db.collection('rooms').doc(GAME_ID).update({ admin: state.me });
        
        state.round = d.round || 1; 
        state.status = d.status || 'lobby';
        
        if(state.status === 'playing') {
            const mePlayer = state.players.find(p => p.uid === state.me);
            if (!state.isAdmin && mePlayer && mePlayer.status === 'active') { 
                switchScreen('game');
            } 
        } 
    }, err => console.log("Game sync error", err));

    // 2. مراقب اللاعبين (المنطقة الحساسة للرعشة)
    unsubPlayers = db.collection('rooms').doc(GAME_ID).collection('players').onSnapshot(snap => {
        // 🛑 لو الداتا فاضية (بسبب قطع نت لحظي)، متسمحش القائمة عشان متعملش رعشة
        if (snap.empty && state.players.length > 0) {
            console.log("⚠️ تحذير: البيانات وصلت فارغة (تجاهل للحفاظ على الاستقرار)");
            return;
        }

        let tempPlayers = []; 
        snap.forEach(d => tempPlayers.push({ id: d.id, ...d.data() }));
        
        state.players = tempPlayers;
        
        renderLobby();
        renderGameUI();
        
        if(state.isAdmin && state.status === 'playing') {
            const waiting = state.players.filter(p => p.status === 'waiting');
            const dot = document.getElementById('adminNotificationDot');
            if(dot) dot.style.display = waiting.length > 0 ? 'block' : 'none';
        }
    }, err => console.log("Players sync error", err));
}

function renderLobby() {
    const list = document.getElementById('onlinePlayersList'); if(!list) return; 
    
    // 🛑 تحسين الأداء: لو القائمة هي هي، مترسمش تاني
    // (ده بيقلل الرعشة جداً)
    const currentHTML = list.innerHTML;
    
    // إنشاء HTML جديد في الذاكرة الأول
    const fragment = document.createDocumentFragment();
    const sorted = [...state.players].sort((a,b) => (a.uid === state.me ? -1 : 0));
    
    sorted.forEach(p => {
        const item = document.createElement('div');
        const isActive = p.status === 'active';
        item.className = `lobby-item ${isActive ? 'selected' : ''}`;
        const adminIcon = (p.uid === state.me && state.isAdmin) ? '👑' : ''; 
        item.innerHTML = `<div class="lobby-name"><span>${p.avatar||'👤'}</span> ${p.name} ${adminIcon}</div><div class="lobby-check">${isActive ? '✔' : ''}</div>`;
        if(state.isAdmin) item.onclick = () => togglePlayerStatus(p);
        fragment.appendChild(item);
    });

    // امسح وارسم الجديد (بسرعة)
    list.innerHTML = '';
    list.appendChild(fragment);

    // تحديث باقي الواجهة
    const adminPanel = document.getElementById('adminLobbyControls');
    const waitMsg = document.getElementById('playerWaitingMsg');
    
    if(adminPanel) adminPanel.style.display = state.isAdmin ? 'flex' : 'none';
    if(waitMsg) waitMsg.style.display = state.isAdmin ? 'none' : 'block';
    
    const startBtn = document.getElementById('startGameBtn');
    if (state.isAdmin && startBtn) {
        if (state.status === 'playing') {
            startBtn.textContent = "↩️ العودة للمباراة الجارية";
            startBtn.className = "btn-secondary flex-grow";
            document.getElementById('lobbySubtitle').textContent = "⚠️ المباراة جارية الآن";
        } else {
            startBtn.textContent = "⚽ ابدأ المباراة";
            startBtn.className = "btn-main flex-grow";
            document.getElementById('lobbySubtitle').textContent = "👑 اختر التشكيلة الأساسية:";
        }
    }
}

// دالة التبديل
function switchScreen(s) {
    ['loginScreen','registerScreen','lobbyScreen','gameRoom'].forEach(id => { 
        const el = document.getElementById(id); 
        if(el) el.style.display='none'; 
    }); 
    const target = document.getElementById(s === 'login' ? 'loginScreen' : s === 'register' ? 'registerScreen' : s === 'lobby' ? 'lobbyScreen' : 'gameRoom');
    if(target) target.style.display='block';
}

// ... باقي الدوال (بدون تغيير جوهري) ...
function handleStartOrResumeGame() { if (state.status === 'playing') { switchScreen('game'); } else { startGame(); } }
async function togglePlayerStatus(p) { if (state.status !== 'playing') { const newS = p.status === 'active' ? 'waiting' : 'active'; await db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id).update({ status: newS }); } else { if (p.status === 'active') { if(!confirm('إخراج اللاعب (دكة)؟')) return; await db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id).update({ status: 'waiting' }); } else { const activePlayers = state.players.filter(x => x.status === 'active'); let maxScore = 0; if (activePlayers.length > 0) maxScore = Math.max(...activePlayers.map(x => (x.scores || []).reduce((a,b) => a + (Number(b)||0), 0))); if(confirm(`⚠️ إدخال ${p.name} بعقوبة (${maxScore}) نقطة؟`)) { let penaltyScores = []; penaltyScores[0] = maxScore; await db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id).update({ status: 'active', scores: penaltyScores }); toast(`تم إدخال ${p.name}`); } } } }
async function startGame() { const activeCount = state.players.filter(p => p.status === 'active').length; if(activeCount < 1) return toast('اختر لاعب واحد', true); const me = state.players.find(p => p.uid === state.me); if(me && me.status !== 'active') if(!confirm('أنت (الأدمن) لم تختر نفسك! موافق؟')) return; await db.collection('rooms').doc(GAME_ID).update({ status: 'playing' }); }
function renderGameUI() { const adminBackBtn=document.getElementById('adminBackToLobbyBtn'); const normalLeaveBtn=document.getElementById('leaveGameBtn'); const adminFinish=document.getElementById('adminFinishControls'); const adminControls=document.getElementById('adminGameControls'); if(state.isAdmin){ adminBackBtn.style.display='flex'; normalLeaveBtn.style.display='none'; adminFinish.style.display='flex'; adminControls.style.display='flex'; }else{ adminBackBtn.style.display='none'; normalLeaveBtn.style.display='flex'; adminFinish.style.display='none'; adminControls.style.display='none'; } document.getElementById('roundNum').textContent=state.round; document.getElementById('roundDesc').textContent=PHASE_RULES[state.round-1]||""; const active=state.players.filter(p=>p.status==='active'); const sorted=active.map(p=>({...p,scores:p.scores||[],total:(p.scores||[]).reduce((a,b)=>a+(Number(b)||0),0)})).sort((a,b)=>a.total-b.total); const myIdx=sorted.findIndex(p=>p.uid===state.me); if(myIdx!==-1)updateMyStatusCard(myIdx,sorted.length);else{const c=document.getElementById('myStatusCard');if(c)c.style.display='none';} const container=document.getElementById('cardsContainer'); if(!container)return; container.innerHTML=''; sorted.forEach((p,idx)=>{ const animal=getAnimalRank(idx,sorted.length); const card=document.createElement('div'); let rankClass=''; if(animal.class==='rank-lion')rankClass='card-lion'; if(animal.class==='rank-sheep')rankClass='card-sheep'; if(animal.class==='rank-tiger')rankClass='card-tiger'; if(animal.class==='rank-goat')rankClass='card-goat'; card.className=`player-card ${rankClass} ${p.uid===state.me?'is-me':''}`; const currentScore=(p.scores[state.round-1]!==null&&p.scores[state.round-1]!==undefined)?p.scores[state.round-1]:''; card.innerHTML=`<div class="card-header" onclick="toggleCard(this)"><div class="p-main"><span class="p-avatar">${animal.icon||p.avatar}</span><span class="p-name">${p.name}</span></div><div class="p-score-box">${p.total}</div></div><div class="card-body ${p.uid===state.me?'open':''}">${(p.uid===state.me||state.isAdmin)?`<div class="input-area"><label class="input-label">سكور الجولة ${state.round}</label><input type="number" pattern="[0-9]*" class="big-score-input" value="${currentScore}" oninput="onScoreInput('${p.id}', ${state.round-1}, this.value)" placeholder="-"></div>`:`<div style="text-align:center; padding:10px; opacity:0.6;">${currentScore===''?'جاري اللعب...':`سكور الجولة: <b>${currentScore}</b>`}</div>`}<div class="history-row">${renderHistoryPills(p.scores)}</div>${state.isAdmin?`<button onclick="openSubModalById('${p.id}')" class="btn-text" style="font-size:11px">🔄 تبديل اللاعب</button>`:''}</div>`; container.appendChild(card); }); }
function renderHistoryPills(scores){let html='';for(let i=0;i<ROUNDS;i++){const val=(scores[i]!==null&&scores[i]!==undefined)?scores[i]:'-';const active=(i===state.round-1)?'active':'';html+=`<div class="hist-pill ${active}"><span>${i+1}</span>${val}</div>`;}return html;}
window.toggleCard=function(header){header.nextElementSibling.classList.toggle('open');}
window.onScoreInput=function(pid,rIdx,val){const key=`${pid}-${rIdx}`;if(timers.has(key))clearTimeout(timers.get(key));timers.set(key,setTimeout(()=>saveScore(pid,rIdx,val),600));}
async function saveScore(pid,rIdx,val){const num=(val===''||val==='-')?null:Number(val);const p=state.players.find(x=>x.id===pid);let s=p.scores?[...p.scores]:[];while(s.length<ROUNDS)s.push(null);s[rIdx]=num;await db.collection('rooms').doc(GAME_ID).collection('players').doc(pid).update({scores:s});}
async function changeRound(d){const newR=Math.min(ROUNDS,Math.max(1,state.round+d));if(newR!==state.round)await db.collection('rooms').doc(GAME_ID).update({round:newR});}
function getAnimalRank(i,t){if(i===0)return{icon:'🦁',class:'rank-lion'};if(t>=2&&i===t-1)return{icon:'🐑',class:'rank-sheep'};if(t>=3&&i===1)return{icon:'🐯',class:'rank-tiger'};if(t>=4&&i===t-2)return{icon:'🐐',class:'rank-goat'};return{icon:'',class:''};}
function updateMyStatusCard(idx,total){const c=document.getElementById('myStatusCard');const m=document.getElementById('statusMsg');const e=document.getElementById('statusEmoji');const t=document.getElementById('statusTitle');let type='normal',icon='😐',lbl='عادي';if(total>0&&idx===0){type='lion';icon='🦁';lbl='الأسد';}else if(total>=2&&idx===total-1){type='sheep';icon='🐑';lbl='الخروف';}const txts=STATUS_MSGS[type]||STATUS_MSGS['normal'];m.textContent=txts[Math.floor(Math.random()*txts.length)];e.textContent=icon;t.textContent=lbl;c.style.display='flex';}
function openFullTable(){const active=state.players.filter(p=>p.status==='active').sort((a,b)=>((a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)-(b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)));const thead=document.getElementById('tHead');thead.innerHTML='';['اللاعب','مجموع'].forEach(t=>{const th=document.createElement('th');th.textContent=t;thead.appendChild(th)});for(let i=1;i<=ROUNDS;i++){const th=document.createElement('th');th.textContent=i;if(i===state.round)th.className='active-col';thead.appendChild(th);}const tbody=document.getElementById('tBody');tbody.innerHTML='';active.forEach((p,idx)=>{const tr=document.createElement('tr');const tdName=document.createElement('td');tdName.textContent=p.name;tr.appendChild(tdName);const tdTotal=document.createElement('td');tdTotal.textContent=(p.scores||[]).reduce((a,b)=>a+(Number(b)||0),0);tr.appendChild(tdTotal);for(let r=0;r<ROUNDS;r++){const td=document.createElement('td');td.textContent=(p.scores[r]!==null&&p.scores[r]!==undefined)?p.scores[r]:'';tr.appendChild(td);}tbody.appendChild(tr);});document.getElementById('fullTableModal').style.display='flex';}
async function syncPlayers(){if(!confirm('هل تريد استدعاء جميع المسجلين للوبي؟'))return;try{const usersSnap=await db.collection('users').get();const batch=db.batch();let count=0;usersSnap.forEach(doc=>{const u=doc.data();const ref=db.collection('rooms').doc(GAME_ID).collection('players').doc(doc.id);batch.set(ref,{name:u.name,avatar:u.avatar,uid:doc.id,scores:[],status:'waiting',lastSeen:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});count++;});await batch.commit();toast(`تم استدعاء ${count} لاعب بنجاح 📥`);}catch(e){console.error(e);toast('حدث خطأ في الاستدعاء',true);}}
async function finishGameAndSave(){if(!confirm('إنهاء المباراة وحفظ الإحصائيات؟'))return;const active=state.players.filter(p=>p.status==='active').sort((a,b)=>{const sa=(a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);const sb=(b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);return sa-sb;});const totalPlayers=active.length;if(totalPlayers<2)return toast('عدد اللاعبين قليل!',true);const batch=db.batch();active.forEach((p,index)=>{const userRef=db.collection('users').doc(p.uid);const totalScore=(p.scores||[]).reduce((a,b)=>a+(Number(b)||0),0);let updates={gamesPlayed:firebase.firestore.FieldValue.increment(1),accumulatedScore:firebase.firestore.FieldValue.increment(totalScore)};if(index===0)updates.lionCount=firebase.firestore.FieldValue.increment(1);if(totalPlayers>=2&&index===totalPlayers-1)updates.sheepCount=firebase.firestore.FieldValue.increment(1);if(totalPlayers>=3&&index===1)updates.tigerCount=firebase.firestore.FieldValue.increment(1);if(totalPlayers>=4&&index===totalPlayers-2)updates.goatCount=firebase.firestore.FieldValue.increment(1);batch.update(userRef,updates);});batch.update(db.collection('rooms').doc(GAME_ID),{status:'lobby',round:1});state.players.forEach(p=>{batch.update(db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id),{scores:[],status:'waiting'});});try{await batch.commit();toast('🏆 تم تحديث إحصائيات الجميع!');}catch(e){console.error(e);toast('حدث خطأ في الحفظ',true);}}
function openFameModalForce(){const modal=document.getElementById('fameModal');const list=document.getElementById('fameList');if(modal){modal.style.display='flex';modal.style.zIndex="99999";}else{alert("كود المودال مش موجود!");return;}list.innerHTML='<div style="text-align:center; padding:20px; color:#fbbf24;">جاري جلب الأبطال... 🦁</div>';db.collection('users').get().then(snap=>{if(snap.empty){list.innerHTML='<div style="text-align:center">لا يوجد بيانات</div>';return;}let users=[];snap.forEach(doc=>{const d=doc.data();users.push({name:d.name||'مجهول',avatar:d.avatar||'👤',lion:d.lionCount||0,sheep:d.sheepCount||0,tiger:d.tigerCount||0,games:d.gamesPlayed||0});});users.sort((a,b)=>b.lion-a.lion);let html='';let rank=1;users.forEach(u=>{let title="";if(u.games>0){if(u.lion>u.sheep&&u.lion>=2)title="👑 ملك";else if(u.sheep>u.lion&&u.sheep>=2)title="🌱 صديق البيئة";}html+=`<div class="fame-item" style="background:rgba(255,255,255,0.05); padding:10px; margin-bottom:8px; border-radius:10px; display:flex; align-items:center;"><div style="font-weight:900; width:30px; color:#94a3b8;">#${rank++}</div><div style="flex:1;"><div style="font-weight:bold;">${u.avatar} ${u.name} <span style="font-size:10px; color:#fbbf24;">${title}</span></div><div style="font-size:11px; color:#aaa; margin-top:2px;">🦁 ${u.lion} | 🐯 ${u.tiger} | 🐑 ${u.sheep}</div></div><div style="font-size:10px; opacity:0.6;">${u.games} جيم</div></div>`;});list.innerHTML=html;}).catch(err=>{console.error(err);list.innerHTML='<div style="color:red; text-align:center">فشل الاتصال بالسيرفر</div>';});}
async function resetCareerStats(){if(!confirm('⚠️ تحذير: هل أنت متأكد من تصفير الدوري؟\nسيتم حذف جميع الكؤوس والألقاب لجميع اللاعبين!'))return;const batch=db.batch();const snap=await db.collection('users').get();snap.forEach(doc=>{batch.update(db.collection('users').doc(doc.id),{lionCount:0,sheepCount:0,tigerCount:0,goatCount:0,gamesPlayed:0,accumulatedScore:0});});await batch.commit();toast('تم تصفير الدوري بنجاح 🗑️');if(document.getElementById('fameModal').style.display==='flex'){openFameModalForce();}}
async function resetGame(){if(!confirm('تصفير؟'))return;const b=db.batch();b.update(db.collection('rooms').doc(GAME_ID),{round:1,status:'lobby'});state.players.forEach(p=>b.update(db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id),{scores:[],status:'waiting'}));await b.commit();}
async function adminFactoryReset(){if(!confirm('هل أنت متأكد من تصفير اللعبة؟ (لن يتم حذف اللاعبين)'))return;const b=db.batch();b.update(db.collection('rooms').doc(GAME_ID),{round:1,status:'lobby'});state.players.forEach(p=>{b.update(db.collection('rooms').doc(GAME_ID).collection('players').doc(p.id),{scores:[],status:'waiting'});});await b.commit();toast('تم تصفير البيانات بنجاح 🔄');}
function openProfileModal(){document.getElementById('editName').value=state.userData.name;document.getElementById('editSelectedAvatar').value=state.userData.avatar;document.getElementById('profileModal').style.display='flex';}
async function saveProfileChanges(){const n=document.getElementById('editName').value.trim();const a=document.getElementById('editSelectedAvatar').value;const p=document.getElementById('editPass').value;try{await db.collection('users').doc(state.me).update({name:n,avatar:a});await db.collection('rooms').doc(GAME_ID).collection('players').doc(state.me).update({name:n,avatar:a});if(p)await auth.currentUser.updatePassword(p);state.userData.name=n;state.userData.avatar=a;document.getElementById('userNameDisplay').textContent=n;document.getElementById('userAvatarDisplay').textContent=a;document.getElementById('profileModal').style.display='none';toast('تم الحفظ');}catch(e){toast('خطأ',true);}}
function openAdminSelect(){const l=document.getElementById('adminCandidatesList');l.innerHTML='';state.players.forEach(p=>{if(p.uid===state.me)return;const d=document.createElement('div');d.className='lobby-item';d.textContent=p.name;d.onclick=()=>transferAdmin(p);l.appendChild(d);});document.getElementById('adminSelectModal').style.display='flex';}
async function transferAdmin(p){if(confirm('نقل الأدمن؟')){await db.collection('rooms').doc(GAME_ID).update({admin:p.uid});document.getElementById('adminSelectModal').style.display='none';}}
window.openSubModalById=function(pid){const p=state.players.find(x=>x.id===pid);if(p)openSubModal(p);}
function openSubModal(pOut){playerToSubId=pOut.id;document.getElementById('subTargetName').textContent=`خروج: ${pOut.name}`;const bench=state.players.filter(p=>p.status==='waiting');const list=document.getElementById('benchList');list.innerHTML='';if(!bench.length)list.innerHTML='<div style="color:#aaa">لا يوجد بدلاء</div>';bench.forEach(sub=>{const el=document.createElement('div');el.className='lobby-item';el.textContent=`نزول: ${sub.name}`;el.onclick=()=>performSub(pOut,sub);list.appendChild(el);});document.getElementById('subModal').style.display='flex';}
async function performSub(outP,inP){if(!confirm(`تبديل ${outP.name} بـ ${inP.name}؟`))return;const batch=db.batch();const ref=db.collection('rooms').doc(GAME_ID).collection('players');batch.update(ref.doc(outP.id),{status:'waiting',scores:[]});batch.update(ref.doc(inP.id),{status:'active',scores:outP.scores});await batch.commit();document.getElementById('subModal').style.display='none';}
function calcLeader(){const sorted=state.players.filter(p=>p.status==='active').sort((a,b)=>((a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)-(b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)));if(sorted.length){toast(`🦁 ${sorted[0].name}`);if(sorted.length>1)setTimeout(()=>toast(`🐑 ${sorted[sorted.length-1].name}`,true),2000);}}
function randomSkip(){const a=state.players.filter(p=>p.status==='active');if(a.length)showModal(a[Math.floor(Math.random()*a.length)].name,'سكيب عشوائي');}
function smartSkip(){const a=state.players.filter(p=>p.status==='active');if(!a.length)return;const s=a.sort((a,b)=>((a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)-(b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0)));const i=s.findIndex(p=>p.uid===state.me);if(i===-1)return randomSkip();let t;if(i===0)t=s[1];else if(i===s.length-1)t=s[i-1];else t=(Math.abs(((s[i].scores||[]).reduce((x,y)=>x+(Number(y)||0),0))-((s[i-1].scores||[]).reduce((x,y)=>x+(Number(y)||0),0)))<=Math.abs(((s[i].scores||[]).reduce((x,y)=>x+(Number(y)||0),0))-((s[i+1].scores||[]).reduce((x,y)=>x+(Number(y)||0),0))))?s[i-1]:s[i+1];showModal(t.name,'سكيب ذكي');}
function showModal(n,t){document.getElementById('skipType').textContent=t;document.getElementById('skipTarget').textContent=n;document.getElementById('skipModal').style.display='flex';document.getElementById('skipAudio').play();}
function toast(m,e=false){const t=document.getElementById('toast');t.innerHTML=m;t.className=e?'toast show error':'toast show';setTimeout(()=>t.classList.remove('show'),3000);}
function shareWa(){window.open(`https://wa.me/?text=${encodeURIComponent(`يلا Phase 10 🔥\n${window.location.href}`)}`);}
