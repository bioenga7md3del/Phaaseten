/* =========================================
   1. إعدادات Firebase
   (نفس بياناتك)
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
   2. الثوابت وقاموس التحفيل 😂
   ========================================= */
const ROUNDS = 10;
const PHASE_RULES = [
    "2 مجموعات (3)", "مجموعة (3) + تسلسل (4)", "مجموعة (4) + تسلسل (4)", "تسلسل (7)",
    "تسلسل (8)", "تسلسل (9)", "2 مجموعات (4)", "7 كروت لون واحد",
    "مجموعة (5) + مجموعة (2)", "مجموعة (5) + مجموعة (3)"
];

// قاموس التعليقات الكوميدية
const FUNNY_COMMENTS = {
    lion: ["وسع للأسد! 🦁", "يا كايدهم يا ملك 👑", "القمة بتلسع 🧊", "عاش يا وحش 🔥"],
    tiger: ["النمر بيخربش 🐯", "قربت يا بطل 💪", "عينك على الأسد 👀"],
    goat: ["يا معزة.. شد حيلك 🐐", "الوضع خطر ⚠️", "اهرب من القاع 🏃"],
    sheep: ["ماء ماء.. 🐑", "المركز ده بتاعك لوحدك 😂", "شكلك وحش أوي 🌚", "فاكر نفسك بتلعب؟"],
    highScore: ["ايه الرقم ده؟! 😱", "لبست في الحيط 🧱", "خربت خالص 😂", "يا ساتر يارب"],
    zero: ["برنس الليالي ✨", "صفر الملوك 👌", "ولا غلطة!"]
};

/* =========================================
   3. إدارة الحالة
   ========================================= */
let state = { me: null, room: null, owner: null, round: 1, players: [] };
let unsubRoom = null;
let unsubPlayers = null;
const timers = new Map();

/* =========================================
   4. التهيئة
   ========================================= */
document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(async u => {
        if(!u) await firebase.auth().signInAnonymously();
        else state.me = u.uid;
    });

    document.getElementById('createBtn').addEventListener('click', createRoom);
    document.getElementById('joinBtn').addEventListener('click', joinRoom);
    document.getElementById('cleanBtn').addEventListener('click', cleanOldRooms);
    document.getElementById('copyCodeBtn').addEventListener('click', copyCode);
    document.getElementById('waBtn').addEventListener('click', shareWa);
    document.getElementById('exitBtn').addEventListener('click', exitRoom);
    document.getElementById('prevRoundBtn').addEventListener('click', () => changeRound(-1));
    document.getElementById('nextRoundBtn').addEventListener('click', () => changeRound(1));
    document.getElementById('addPlayerBtn').addEventListener('click', addPlayer);
    document.getElementById('leaderBtn').addEventListener('click', calcLeader);
    document.getElementById('randomSkipBtn').addEventListener('click', randomSkip);
    document.getElementById('smartSkipBtn').addEventListener('click', smartSkip);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);

    const params = new URLSearchParams(window.location.search);
    if(params.get('room')) document.getElementById('roomInput').value = params.get('room');
});

/* =========================================
   5. الدوال المساعدة والكوميديا
   ========================================= */
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.innerHTML = isErr ? `⚠️ ${msg}` : `${msg}`; // شلنا علامة الصح عشان نحط ايموجي براحتنا
  t.className = isErr ? 'toast show error' : 'toast show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

function getRandomComment(type) {
    const list = FUNNY_COMMENTS[type];
    return list[Math.floor(Math.random() * list.length)];
}

function showModal(name, type) {
  document.getElementById('skipType').textContent = type;
  document.getElementById('skipTarget').textContent = name;
  document.getElementById('skipModal').style.display = 'flex';
  const audio = document.getElementById('skipAudio');
  if(audio) { audio.currentTime = 0; audio.play().catch(e => {}); }
}

function closeModal() { document.getElementById('skipModal').style.display = 'none'; }

function switchScreen(screen) {
  document.getElementById('landingScreen').style.display = screen === 'landing' ? 'block' : 'none';
  document.getElementById('gameRoom').style.display = screen === 'game' ? 'block' : 'none';
  if(screen === 'game') {
    const url = new URL(window.location); url.searchParams.set('room', state.room);
    window.history.pushState({}, '', url);
    document.getElementById('displayCode').textContent = state.room;
  } else {
    const url = new URL(window.location); url.searchParams.delete('room');
    window.history.pushState({}, '', url);
  }
}

/* =========================================
   6. منطق الغرفة
   ========================================= */
async function createRoom() {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  try {
    await db.collection('rooms').doc(code).set({
      owner: state.me, round: 1, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    subscribe(code);
    toast('تم إنشاء الغرفة');
  } catch(e) { console.error(e); toast('فشل الاتصال', true); }
}

async function joinRoom() {
  const code = document.getElementById('roomInput').value.trim();
  if(!code) return toast('اكتب الكود', true);
  try {
    const doc = await db.collection('rooms').doc(code).get();
    if(!doc.exists) return toast('غرفة غير موجودة', true);
    subscribe(code);
  } catch(e) { toast('فشل الاتصال', true); }
}

function subscribe(code) {
  if(unsubRoom) unsubRoom();
  if(unsubPlayers) unsubPlayers();
  state.room = code;

  unsubRoom = db.collection('rooms').doc(code).onSnapshot(doc => {
    if(!doc.exists) { exitRoom(); return toast('تم إغلاق الغرفة', true); }
    const d = doc.data();
    state.owner = d.owner;
    const oldRound = state.round;
    state.round = d.round || 1;
    renderUI();
    if(state.round !== oldRound) {
      setTimeout(() => {
        const active = document.querySelector('.active-col input');
        if(active) active.scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
      }, 500);
    }
  });

  unsubPlayers = db.collection('rooms').doc(code).collection('players').onSnapshot(snap => {
    state.players = [];
    snap.forEach(d => state.players.push({ id: d.id, ...d.data() }));
    renderUI();
  });
  switchScreen('game');
}

/* =========================================
   7. دالة الحفظ مع التحفيل
   ========================================= */
async function saveScore(pid, rIdx, val) {
  const num = (val === '' || val === '-') ? null : Number(val);
  
  // تحفيل فوري على الرقم
  if(num !== null) {
      if(num === 0) toast(getRandomComment('zero'));
      else if(num >= 50) toast(getRandomComment('highScore'), true);
  }

  const pIndex = state.players.findIndex(x => x.id === pid);
  if(pIndex > -1) {
      if(!state.players[pIndex].scores) state.players[pIndex].scores = [];
      state.players[pIndex].scores[rIdx] = num;
  }

  const player = state.players.find(x => x.id === pid);
  let newScores = player.scores ? [...player.scores] : [];
  while(newScores.length < ROUNDS) newScores.push(null);
  newScores[rIdx] = num;

  try {
    await db.collection('rooms').doc(state.room).collection('players').doc(pid).set({ 
      scores: newScores, updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
    }, { merge: true });
  } catch(e) { console.error(e); }
}

/* =========================================
   8. رسم الواجهة وتوزيع الحيوانات 🦁🐑
   ========================================= */
function getAnimalRank(index, total) {
    // 0 = Lion, 1 = Tiger, last = Sheep, last-1 = Goat
    if (total === 0) return { icon: '', class: '' };
    if (index === 0) return { icon: '🦁', class: 'rank-lion' }; // الأول دايماً أسد
    
    if (total >= 2 && index === total - 1) return { icon: '🐑', class: 'rank-sheep' }; // الأخير دايماً خروف
    
    if (total >= 3 && index === 1) return { icon: '🐯', class: 'rank-tiger' }; // التاني نمر (لو فيه 3+)
    
    if (total >= 4 && index === total - 2) return { icon: '🐐', class: 'rank-goat' }; // قبل الأخير معزة (لو فيه 4+)
    
    return { icon: '', class: '' }; // الباقي عادي
}

function renderUI() {
  const isAdmin = (state.me === state.owner);
  document.getElementById('adminControls').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('viewerControls').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('clearAllBtn').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('roundNum').textContent = state.round;
  document.getElementById('viewRoundNum').textContent = state.round;
  const ruleText = PHASE_RULES[state.round - 1] || "";
  document.getElementById('roundDescAdmin').textContent = ruleText;
  document.getElementById('roundDescViewer').textContent = ruleText;

  // ترتيب اللاعبين
  const data = state.players.map(p => ({
    ...p,
    scores: Array.isArray(p.scores) ? p.scores : [],
    total: (p.scores || []).reduce((a, b) => a + (Number(b) || 0), 0)
  })).sort((a, b) => a.total - b.total);

  // الهيدر
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
  if(isAdmin) { const thDel = document.createElement('th'); thDel.textContent = '×'; thead.appendChild(thDel); }

  // الجسم
  const tbody = document.getElementById('tBody');
  tbody.innerHTML = '';

  data.forEach((p, idx) => {
    // تحديد الحيوان والرتبة
    const animalInfo = getAnimalRank(idx, data.length);
    
    const tr = document.createElement('tr');
    if(animalInfo.class) tr.className = animalInfo.class; // إضافة كلاس الحيوان

    // 1. الاسم
    const tdName = document.createElement('td');
    tdName.innerHTML = `${animalInfo.icon} ${p.name}`;
    tr.appendChild(tdName);

    // 2. المجموع
    const tdTotal = document.createElement('td');
    tdTotal.style.fontWeight = '900';
    tdTotal.textContent = p.total;
    tr.appendChild(tdTotal);
    
    // 3. الترتيب (رقم)
    const tdRankIcon = document.createElement('td');
    tdRankIcon.innerHTML = `<span style="font-size:12px; opacity:0.7">#${idx + 1}</span>`;
    tr.appendChild(tdRankIcon);

    // 4. الجولات
    for(let r=0; r<ROUNDS; r++) {
      const td = document.createElement('td');
      if(r === state.round - 1) {
        td.className = 'active-col';
        const inp = document.createElement('input');
        inp.type = 'number'; inp.pattern = '[0-9]*'; inp.className = 'score-inp';
        const val = (p.scores[r] !== null && p.scores[r] !== undefined) ? p.scores[r] : '';
        inp.value = val;
        
        const isMe = (p.uid === state.me);
        if(!isAdmin && !isMe) { inp.disabled = true; inp.style.opacity = "0.5"; }

        const key = `${p.id}-${r}`;
        inp.oninput = () => {
          if(p.uid === state.me || isAdmin) {
              const localP = state.players.find(x => x.id === p.id);
              if(localP) { if(!localP.scores) localP.scores = []; localP.scores[r] = inp.value; }
          }
          if(timers.has(key)) clearTimeout(timers.get(key));
          timers.set(key, setTimeout(() => saveScore(p.id, r, inp.value), 600));
        };
        inp.onblur = () => saveScore(p.id, r, inp.value);
        td.appendChild(inp);
      } else {
        const val = (p.scores[r] !== null && p.scores[r] !== undefined) ? p.scores[r] : '';
        td.textContent = val;
        td.style.opacity = '0.5';
      }
      tr.appendChild(td);
    }

    if(isAdmin) {
      const tdDel = document.createElement('td');
      const btnDel = document.createElement('button');
      btnDel.textContent = '×';
      btnDel.style.cssText = 'background:none; color:var(--danger); box-shadow:none; padding:0; font-size:18px';
      btnDel.onclick = () => delPlayer(p.id);
      tdDel.appendChild(btnDel);
      tr.appendChild(tdDel);
    }
    tbody.appendChild(tr);
  });
}

/* =========================================
   9. باقي الأزرار
   ========================================= */
async function addPlayer() {
  const name = document.getElementById('playerName').value.trim();
  if(!name) return toast('اكتب الاسم', true);
  await db.collection('rooms').doc(state.room).collection('players').add({
    name, uid: state.me, scores: [], createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  document.getElementById('playerName').value = '';
}

function delPlayer(id) { if(confirm('حذف؟')) db.collection('rooms').doc(state.room).collection('players').doc(id).delete(); }

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

function randomSkip() {
  if(!state.players.length) return toast('لا يوجد لاعبين', true);
  const r = state.players[Math.floor(Math.random() * state.players.length)];
  showModal(r.name, 'سكيب عشوائي 🎲');
}

function smartSkip() {
  if(!state.players.length) return toast('لا يوجد لاعبين', true);
  const sorted = [...state.players].sort((a,b) => {
    const sa = (a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
    const sb = (b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
    return sa - sb;
  });
  const myIdx = sorted.findIndex(p => p.uid === state.me);
  if(myIdx === -1) return randomSkip();
  if(sorted.length < 2) return toast('لا يوجد منافسين', true);

  let target;
  if(myIdx === 0) target = sorted[1];
  else if(myIdx === sorted.length - 1) target = sorted[myIdx - 1];
  else {
    const prev = sorted[myIdx - 1];
    const next = sorted[myIdx + 1];
    const myScore = (sorted[myIdx].scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
    const prevScore = (prev.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
    const nextScore = (next.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
    if(Math.abs(myScore - prevScore) <= Math.abs(myScore - nextScore)) target = prev;
    else target = next;
  }
  showModal(target.name, 'سكيب ذكي 🧠');
}

function calcLeader() {
  // دالة المتصدر ممكن نستخدم فيها التحفيل برضه
  const sorted = [...state.players].sort((a,b) => {
    const sa = (a.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
    const sb = (b.scores||[]).reduce((x,y)=>x+(Number(y)||0),0);
    return sa - sb;
  });
  if(sorted.length) {
      toast(`👑 الأسد: ${sorted[0].name}`);
      if(sorted.length > 1) setTimeout(() => toast(`🐑 الخروف: ${sorted[sorted.length-1].name}`, true), 1500);
  }
}

async function cleanOldRooms() {
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
  if(unsubRoom) unsubRoom();
  if(unsubPlayers) unsubPlayers();
  state.room = null; state.players = [];
  switchScreen('landing');
}

function copyCode() { navigator.clipboard.writeText(state.room); toast('تم نسخ الكود'); }
function shareWa() { 
    const url = window.location.href.split('?')[0]; 
    const txt = `يلا نلعب Phase 10 🔥\nادخل على الرابط:\n${url}?room=${state.room}\nكود الغرفة: *${state.room}*`;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`); 
}
