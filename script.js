/* =========================================
   1. إعدادات Firebase
   (استبدل القيم أدناه ببيانات مشروعك من Firebase Console)
   ========================================= */
const firebaseConfig = {
  apiKey: "AIzaSyC5Dh7bJzPqLaZl4djKCgpzaHHSeeD1aHU",
  authDomain: "phaseten-435bf.firebaseapp.com",
  projectId: "phaseten-435bf",
  storageBucket: "phaseten-435bf.firebasestorage.app",
  messagingSenderId: "780298483879",
  appId: "1:780298483879:web:6b6627e673d4808e098382"
};

// تهيئة Firebase
try { firebase.initializeApp(firebaseConfig); } catch(e){ console.error(e); }
const db = firebase.firestore();
const ROUNDS = 10;

/* =========================================
   2. إدارة الحالة (State Management)
   ========================================= */
let state = {
  me: null,       // المعرف الخاص بي
  room: null,     // كود الغرفة الحالي
  owner: null,    // معرف صاحب الغرفة (الأدمن)
  round: 1,       // الجولة الحالية
  players: []     // قائمة اللاعبين
};

let unsubRoom = null;    // للاشتراك في بيانات الغرفة
let unsubPlayers = null; // للاشتراك في بيانات اللاعبين
const timers = new Map(); // للمؤقتات (Debounce)

/* =========================================
   3. التهيئة عند تحميل الصفحة
   ========================================= */
document.addEventListener('DOMContentLoaded', () => {
    // تسجيل دخول مجهول تلقائي
    firebase.auth().onAuthStateChanged(async u => {
        if(!u) await firebase.auth().signInAnonymously();
        else state.me = u.uid;
    });

    // أزرار الشاشة الرئيسية
    document.getElementById('createBtn').addEventListener('click', createRoom);
    document.getElementById('joinBtn').addEventListener('click', joinRoom);
    document.getElementById('cleanBtn').addEventListener('click', cleanOldRooms);

    // أزرار الغرفة
    document.getElementById('copyCodeBtn').addEventListener('click', copyCode);
    document.getElementById('waBtn').addEventListener('click', shareWa);
    document.getElementById('exitBtn').addEventListener('click', exitRoom);
    
    // تحكم الأدمن بالجولات
    document.getElementById('prevRoundBtn').addEventListener('click', () => changeRound(-1));
    document.getElementById('nextRoundBtn').addEventListener('click', () => changeRound(1));
    
    // إجراءات اللعب
    document.getElementById('addPlayerBtn').addEventListener('click', addPlayer);
    document.getElementById('leaderBtn').addEventListener('click', calcLeader);
    document.getElementById('randomSkipBtn').addEventListener('click', randomSkip);
    document.getElementById('smartSkipBtn').addEventListener('click', smartSkip);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    
    // المودال
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);

    // فحص الرابط (لو جاي من واتساب)
    const params = new URLSearchParams(window.location.search);
    if(params.get('room')) {
        document.getElementById('roomInput').value = params.get('room');
    }
});

/* =========================================
   4. دوال مساعدة (Helpers)
   ========================================= */
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.innerHTML = isErr ? `⚠️ ${msg}` : `✅ ${msg}`;
  t.className = isErr ? 'toast show error' : 'toast show';
  setTimeout(() => t.classList.remove('show'), 2500);
}

function showModal(name, type) {
  document.getElementById('skipType').textContent = type;
  document.getElementById('skipTarget').textContent = name;
  document.getElementById('skipModal').style.display = 'flex';
}

function closeModal() { 
  document.getElementById('skipModal').style.display = 'none'; 
}

function switchScreen(screen) {
  document.getElementById('landingScreen').style.display = screen === 'landing' ? 'block' : 'none';
  document.getElementById('gameRoom').style.display = screen === 'game' ? 'block' : 'none';
  
  if(screen === 'game') {
    const url = new URL(window.location);
    url.searchParams.set('room', state.room);
    window.history.pushState({}, '', url);
    document.getElementById('displayCode').textContent = state.room;
  } else {
    const url = new URL(window.location);
    url.searchParams.delete('room');
    window.history.pushState({}, '', url);
  }
}

/* =========================================
   5. منطق الغرفة (Room Logic)
   ========================================= */
async function createRoom() {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  try {
    await db.collection('rooms').doc(code).set({
      owner: state.me,
      round: 1,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    subscribe(code);
    toast('تم إنشاء الغرفة');
  } catch(e) { console.error(e); toast('مشكلة في الاتصال', true); }
}

async function joinRoom() {
  const code = document.getElementById('roomInput').value.trim();
  if(!code) return toast('اكتب الكود', true);
  
  try {
    const doc = await db.collection('rooms').doc(code).get();
    if(!doc.exists) return toast('غرفة غير موجودة', true);
    subscribe(code);
  } catch(e) { console.error(e); toast('مشكلة في الاتصال', true); }
}

function subscribe(code) {
  if(unsubRoom) unsubRoom();
  if(unsubPlayers) unsubPlayers();

  state.room = code;
  
  // 1. الاستماع لبيانات الغرفة
  unsubRoom = db.collection('rooms').doc(code).onSnapshot(doc => {
    if(!doc.exists) { exitRoom(); return toast('تم إغلاق الغرفة', true); }
    const d = doc.data();
    state.owner = d.owner;
    
    const oldRound = state.round;
    state.round = d.round || 1;
    
    renderUI(); // رسم الجدول

    // تحريك الشاشة للجولة الجديدة
    if(state.round !== oldRound) {
      setTimeout(() => {
        const active = document.querySelector('.active-col input');
        if(active) active.scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
      }, 500);
    }
  });

  // 2. الاستماع للاعبين
  unsubPlayers = db.collection('rooms').doc(code).collection('players').onSnapshot(snap => {
    state.players = [];
    snap.forEach(d => state.players.push({ id: d.id, ...d.data() }));
    renderUI(); // إعادة رسم الجدول عند أي تغيير
  });

  switchScreen('game');
}

function exitRoom() {
  if(unsubRoom) unsubRoom();
  if(unsubPlayers) unsubPlayers();
  state.room = null;
  state.players = [];
  switchScreen('landing');
}

/* =========================================
   6. رسم الواجهة (Render Engine) - الجزء الأهم
   ========================================= */
function renderUI() {
  const isAdmin = (state.me === state.owner);
  
  // التحكم في الظهور بناءً على الصلاحيات
  document.getElementById('adminControls').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('viewerControls').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('clearAllBtn').style.display = isAdmin ? 'block' : 'none';
  
  document.getElementById('roundNum').textContent = state.round;
  document.getElementById('viewRoundNum').textContent = state.round;

  // تجهيز البيانات والترتيب
  const data = state.players.map(p => ({
    ...p,
    total: (p.scores || []).reduce((a, b) => a + (Number(b) || 0), 0)
  })).sort((a, b) => a.total - b.total);

  let rank = 1;
  const worstScore = data.length ? data[data.length-1].total : -1;

  /* --- بناء الهيدر (Rounds) --- */
  const thead = document.getElementById('tHead');
  thead.innerHTML = ''; // مسح القديم
  
  const thName = document.createElement('th');
  thName.textContent = 'اللاعب';
  thead.appendChild(thName);

  for(let i=1; i<=ROUNDS; i++) {
    const th = document.createElement('th');
    th.textContent = i;
    if(i === state.round) th.className = 'active-col';
    thead.appendChild(th);
  }

  const thTotal = document.createElement('th'); thTotal.textContent = 'مجموع'; thead.appendChild(thTotal);
  const thRank = document.createElement('th'); thRank.textContent = '#'; thead.appendChild(thRank);
  
  if(isAdmin) {
      const thDel = document.createElement('th'); thDel.textContent = '×'; thead.appendChild(thDel);
  }

  /* --- بناء الصفوف (Rows) --- */
  const tbody = document.getElementById('tBody');
  tbody.innerHTML = '';

  data.forEach((p, idx) => {
    // منطق الترتيب (التعادل يأخذ نفس المركز)
    if(idx > 0 && p.total === data[idx-1].total) p.rank = data[idx-1].rank;
    else p.rank = rank;
    rank++;

    const tr = document.createElement('tr');
    if(p.rank === 1) tr.className = 'rank-1';
    if(p.total === worstScore && data.length > 1) tr.className = 'rank-last';

    // 1. الاسم
    const tdName = document.createElement('td');
    let nameContent = p.name;
    if(p.rank === 1) nameContent += ' <span style="color:var(--gold)">👑</span>';
    tdName.innerHTML = nameContent;
    tr.appendChild(tdName);

    // 2. الجولات (Scores)
    for(let r=0; r<ROUNDS; r++) {
      const td = document.createElement('td');
      
      // إذا كانت الجولة الحالية، نضع Input
      if(r === state.round - 1) {
        td.className = 'active-col';
        
        const inp = document.createElement('input');
        inp.type = 'number'; 
        inp.pattern = '[0-9]*'; 
        inp.inputMode = 'numeric';
        inp.className = 'score-inp';
        
        // القيمة من الداتا
        inp.value = (p.scores && p.scores[r] != null) ? p.scores[r] : '';
        
        // لو مش أدمن ومش أنا، امنع التعديل
        if(!isAdmin && p.uid !== state.me) inp.disabled = true;

        // --- منطق الحفظ ---
        const key = `${p.id}-${r}`;
        
        // عند الكتابة (Debounce)
        inp.oninput = () => {
          if(timers.has(key)) clearTimeout(timers.get(key));
          timers.set(key, setTimeout(() => saveScore(p.id, r, inp.value), 700));
        };
        
        // عند الخروج (حفظ فوري)
        inp.onblur = () => {
             if(timers.has(key)) clearTimeout(timers.get(key));
             saveScore(p.id, r, inp.value);
        };
        
        td.appendChild(inp);
      } else {
        // جولات سابقة أو قادمة (نص فقط)
        td.textContent = (p.scores && p.scores[r] != null) ? p.scores[r] : '';
        td.style.opacity = '0.5';
      }
      tr.appendChild(td);
    }

    // 3. المجموع
    const tdTotal = document.createElement('td');
    tdTotal.style.fontWeight = '900';
    tdTotal.textContent = p.total;
    tr.appendChild(tdTotal);
    
    // 4. الأيقونة
    const tdRankIcon = document.createElement('td');
    let rankIcon = `<span style="font-size:12px; opacity:0.7">#${p.rank}</span>`;
    if(p.total === worstScore && data.length > 1) rankIcon = '💩';
    else if(p.rank === 1) rankIcon = '🥇';
    else if(p.rank === 2) rankIcon = '🥈';
    tdRankIcon.innerHTML = rankIcon;
    tr.appendChild(tdRankIcon);

    // 5. الحذف (للأدمن)
    if(isAdmin) {
      const tdDel = document.createElement('td');
      const btnDel = document.createElement('button');
      btnDel.textContent = '×';
      btnDel.style.cssText = 'background:none; color:var(--danger); box-shadow:none; padding:0;';
      btnDel.onclick = () => delPlayer(p.id);
      tdDel.appendChild(btnDel);
      tr.appendChild(tdDel);
    }

    tbody.appendChild(tr);
  });
}

/* =========================================
   7. إجراءات اللعبة (Actions)
   ========================================= */
async function saveScore(pid, rIdx, val) {
  const num = (val === '' || val === '-') ? null : Number(val);
  
  // البحث عن اللاعب محلياً
  const p = state.players.find(x => x.id === pid);
  if(!p) return;

  // تجهيز المصفوفة (ملء الفراغات بـ null)
  let scores = Array.isArray(p.scores) ? [...p.scores] : [];
  while(scores.length < ROUNDS) scores.push(null);
  
  // عدم الحفظ إذا لم تتغير القيمة
  if(scores[rIdx] === num) return;
  scores[rIdx] = num;

  try {
    // set with merge لضمان الحفظ
    await db.collection('rooms').doc(state.room).collection('players').doc(pid).set({ 
      scores, 
      updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
    }, { merge: true });
  } catch(e) { 
      console.error(e); 
      // toast('فشل الحفظ', true); // تم إخفاؤها لعدم الإزعاج
  }
}

async function addPlayer() {
  const name = document.getElementById('playerName').value.trim();
  if(!name) return toast('اكتب الاسم', true);
  
  try {
    await db.collection('rooms').doc(state.room).collection('players').add({
      name, 
      uid: state.me, 
      scores: [], 
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('playerName').value = '';
  } catch(e) { toast('خطأ في الإضافة', true); }
}

function delPlayer(id) {
  if(confirm('حذف؟')) db.collection('rooms').doc(state.room).collection('players').doc(id).delete();
}

async function clearAll() {
  if(!confirm('حذف الجميع؟')) return;
  const snap = await db.collection('rooms').doc(state.room).collection('players').get();
  const batch = db.batch();
  snap.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

async function changeRound(d) {
  const newR = Math.min(ROUNDS, Math.max(1, state.round + d));
  if(newR !== state.round) await db.collection('rooms').doc(state.room).update({ round: newR });
}

/* =========================================
   8. المميزات الإضافية (Features)
   ========================================= */
function randomSkip() {
  if(!state.players.length) return toast('لا يوجد لاعبين', true);
  const r = state.players[Math.floor(Math.random() * state.players.length)];
  showModal(r.name, 'سكيب عشوائي 🎲');
}

function smartSkip() {
  if(!state.players.length) return toast('لا يوجد لاعبين', true);
  
  // ترتيب اللاعبين حسب المجموع
  const sorted = state.players.map(p => ({
     ...p, total: (p.scores||[]).reduce((a,b)=>a+(Number(b)||0),0)
  })).sort((a,b) => a.total - b.total);

  const myIdx = sorted.findIndex(p => p.uid === state.me);
  
  if(myIdx === -1) return randomSkip(); // لو أنا مش بلعب، اختار عشوائي
  if(sorted.length < 2) return toast('لا يوجد منافسين', true);

  let target;
  // الخوارزمية: استهدف الأقرب لك في النتيجة
  if(myIdx === 0) {
      target = sorted[1]; // لو أنا الأول، استهدف الثاني
  } else if(myIdx === sorted.length - 1) {
      target = sorted[myIdx - 1]; // لو أنا الأخير، استهدف اللي فوقي
  } else {
    const prev = sorted[myIdx - 1];
    const next = sorted[myIdx + 1];
    const myScore = sorted[myIdx].total;
    
    // من الأقرب لي؟
    if(Math.abs(myScore - prev.total) <= Math.abs(myScore - next.total)) {
        target = prev;
    } else {
        target = next;
    }
  }
  showModal(target.name, 'سكيب ذكي 🧠');
}

function calcLeader() {
  const sorted = [...state.players].sort((a,b) => {
    const sa = (a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
    const sb = (b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
    return sa - sb;
  });
  if(sorted.length) toast(`👑 المتصدر حالياً: ${sorted[0].name}`);
}

async function cleanOldRooms() {
  if(!confirm('حذف الغرف القديمة (24س)؟')) return;
  
  const cutoff = new Date(Date.now() - 86400000); // 24 ساعة
  try {
      const snap = await db.collection('rooms').where('createdAt', '<', cutoff).get();
      if(snap.empty) return toast('لا يوجد غرف قديمة');
      
      const batch = db.batch();
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
      toast(`تم حذف ${snap.size} غرفة`);
  } catch(e) {
      console.error(e);
      toast('تحتاج لعمل فهرس (Index) في الفيربيز', true);
  }
}

function copyCode() {
  navigator.clipboard.writeText(state.room);
  toast('تم نسخ الكود');
}

function shareWa() {
  const url = window.location.href;
  const txt = `يلا نلعب Phase 10 🔥\nادخل على الرابط:\n${url}\nكود الغرفة: *${state.room}*`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`);
}
