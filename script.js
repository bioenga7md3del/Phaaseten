/* ===== Config ===== */
// ⚠️ انسخ إعدادات مشروعك من فيربيز هنا
const firebaseConfig = {
  apiKey: "AIzaSyC5Dh7bJzPqLaZl4djKCgpzaHHSeeD1aHU",
  authDomain: "phaseten-435bf.firebaseapp.com",
  projectId: "phaseten-435bf",
  storageBucket: "phaseten-435bf.firebasestorage.app",
  messagingSenderId: "780298483879",
  appId: "1:780298483879:web:6b6627e673d4808e098382"
};

try { firebase.initializeApp(firebaseConfig); } catch(e){}
const db = firebase.firestore();
const ROUNDS = 10;

/* ===== State ===== */
let state = {
  me: null,
  room: null,
  owner: null,
  round: 1,
  players: []
};
let unsubRoom = null;
let unsubPlayers = null;
const timers = new Map();

/* ===== Event Listeners Initialization ===== */
document.addEventListener('DOMContentLoaded', () => {
    // Auth
    firebase.auth().onAuthStateChanged(async u => {
        if(!u) await firebase.auth().signInAnonymously();
        else state.me = u.uid;
    });

    // Landing Buttons
    document.getElementById('createBtn').addEventListener('click', createRoom);
    document.getElementById('joinBtn').addEventListener('click', joinRoom);
    document.getElementById('cleanBtn').addEventListener('click', cleanOldRooms);

    // Room Buttons
    document.getElementById('copyCodeBtn').addEventListener('click', copyCode);
    document.getElementById('waBtn').addEventListener('click', shareWa);
    document.getElementById('exitBtn').addEventListener('click', exitRoom);
    document.getElementById('prevRoundBtn').addEventListener('click', () => changeRound(-1));
    document.getElementById('nextRoundBtn').addEventListener('click', () => changeRound(1));
    
    // Player Actions
    document.getElementById('addPlayerBtn').addEventListener('click', addPlayer);
    document.getElementById('leaderBtn').addEventListener('click', calcLeader);
    document.getElementById('randomSkipBtn').addEventListener('click', randomSkip);
    document.getElementById('smartSkipBtn').addEventListener('click', smartSkip);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    
    // Modal
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);

    // Check URL
    const params = new URLSearchParams(window.location.search);
    if(params.get('room')) {
        document.getElementById('roomInput').value = params.get('room');
    }
});

/* ===== Helpers ===== */
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
function closeModal() { document.getElementById('skipModal').style.display = 'none'; }

/* ===== Navigation ===== */
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

/* ===== Room Logic ===== */
async function createRoom() {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await db.collection('rooms').doc(code).set({
    owner: state.me,
    round: 1,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  subscribe(code);
  toast('تم إنشاء الغرفة');
}

async function joinRoom() {
  const code = document.getElementById('roomInput').value.trim();
  if(!code) return toast('اكتب الكود', true);
  const doc = await db.collection('rooms').doc(code).get();
  if(!doc.exists) return toast('غرفة غير موجودة', true);
  subscribe(code);
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

function exitRoom() {
  if(unsubRoom) unsubRoom();
  if(unsubPlayers) unsubPlayers();
  state.room = null;
  state.players = [];
  switchScreen('landing');
}

/* ===== Render UI ===== */
function renderUI() {
  const isAdmin = (state.me === state.owner);
  
  document.getElementById('adminControls').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('viewerControls').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('clearAllBtn').style.display = isAdmin ? 'block' : 'none';
  
  document.getElementById('roundNum').textContent = state.round;
  document.getElementById('viewRoundNum').textContent = state.round;

  const data = state.players.map(p => ({
    ...p,
    total: (p.scores || []).reduce((a, b) => a + (Number(b) || 0), 0)
  })).sort((a, b) => a.total - b.total);

  let rank = 1;
  const worstScore = data.length ? data[data.length-1].total : -1;

  const thead = document.getElementById('tHead');
  thead.innerHTML = '<th>اللاعب</th>';
  for(let i=1; i<=ROUNDS; i++) {
    let cls = (i === state.round) ? 'active-col' : '';
    thead.innerHTML += `<th class="${cls}">${i}</th>`;
  }
  thead.innerHTML += '<th>مجموع</th><th>#</th>';
  if(isAdmin) thead.innerHTML += '<th>×</th>';

  const tbody = document.getElementById('tBody');
  tbody.innerHTML = '';

  data.forEach((p, idx) => {
    if(idx > 0 && p.total === data[idx-1].total) p.rank = data[idx-1].rank;
    else p.rank = rank;
    rank++;

    const tr = document.createElement('tr');
    if(p.rank === 1) tr.className = 'rank-1';
    if(p.total === worstScore && data.length > 1) tr.className = 'rank-last';

    let nameContent = p.name;
    if(p.rank === 1) nameContent += ' <span style="color:var(--gold)">👑</span>';
    tr.innerHTML += `<td>${nameContent}</td>`;

    for(let r=0; r<ROUNDS; r++) {
      const td = document.createElement('td');
      if(r === state.round - 1) {
        td.className = 'active-col';
        const inp = document.createElement('input');
        inp.type = 'number'; inp.pattern = '[0-9]*'; inp.className = 'score-inp';
        inp.value = (p.scores && p.scores[r] != null) ? p.scores[r] : '';
        
        if(!isAdmin && p.uid !== state.me) inp.disabled = true;

        const key = `${p.id}-${r}`;
        inp.oninput = () => {
          if(timers.has(key)) clearTimeout(timers.get(key));
          timers.set(key, setTimeout(() => saveScore(p.id, r, inp.value), 600));
        };
        inp.onblur = () => saveScore(p.id, r, inp.value);
        
        td.appendChild(inp);
      } else {
        td.textContent = (p.scores && p.scores[r] != null) ? p.scores[r] : '';
        td.style.opacity = '0.5';
      }
      tr.appendChild(td);
    }

    tr.innerHTML += `<td style="font-weight:900">${p.total}</td>`;
    
    let rankIcon = `<span style="font-size:12px; opacity:0.7">#${p.rank}</span>`;
    if(p.total === worstScore && data.length > 1) rankIcon = '💩';
    else if(p.rank === 1) rankIcon = '🥇';
    else if(p.rank === 2) rankIcon = '🥈';
    tr.innerHTML += `<td>${rankIcon}</td>`;

    if(isAdmin) {
      const btn = document.createElement('button');
      btn.textContent = '×';
      btn.style.cssText = 'background:none; color:var(--danger); box-shadow:none; padding:0;';
      btn.onclick = () => delPlayer(p.id);
      const tdDel = document.createElement('td');
      tdDel.appendChild(btn);
      tr.appendChild(tdDel);
    }

    tbody.appendChild(tr);
  });
}

/* ===== Actions ===== */
async function saveScore(pid, rIdx, val) {
  const num = (val === '' || val === '-') ? null : Number(val);
  const p = state.players.find(x => x.id === pid);
  if(!p) return;

  let scores = Array.isArray(p.scores) ? [...p.scores] : [];
  while(scores.length < ROUNDS) scores.push(null);
  
  if(scores[rIdx] === num) return;
  scores[rIdx] = num;

  try {
    await db.collection('rooms').doc(state.room).collection('players').doc(pid).set({ 
      scores, updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
    }, { merge: true });
  } catch(e) { console.error(e); }
}

async function addPlayer() {
  const name = document.getElementById('playerName').value.trim();
  if(!name) return toast('اكتب الاسم', true);
  await db.collection('rooms').doc(state.room).collection('players').add({
    name, uid: state.me, scores: [], createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  document.getElementById('playerName').value = '';
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

/* ===== Features ===== */
function randomSkip() {
  if(!state.players.length) return toast('لا يوجد لاعبين', true);
  const r = state.players[Math.floor(Math.random() * state.players.length)];
  showModal(r.name, 'سكيب عشوائي 🎲');
}

function smartSkip() {
  if(!state.players.length) return toast('لا يوجد لاعبين', true);
  
  const sorted = state.players.map(p => ({
     ...p, total: (p.scores||[]).reduce((a,b)=>a+(Number(b)||0),0)
  })).sort((a,b) => a.total - b.total);

  const myIdx = sorted.findIndex(p => p.uid === state.me);
  if(myIdx === -1) return randomSkip();
  if(sorted.length < 2) return toast('لا يوجد منافسين', true);

  let target;
  if(myIdx === 0) target = sorted[1];
  else if(myIdx === sorted.length - 1) target = sorted[myIdx - 1];
  else {
    const prev = sorted[myIdx - 1];
    const next = sorted[myIdx + 1];
    const myScore = sorted[myIdx].total;
    if(Math.abs(myScore - prev.total) <= Math.abs(myScore - next.total)) target = prev;
    else target = next;
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
  const cutoff = new Date(Date.now() - 86400000);
  const snap = await db.collection('rooms').where('createdAt', '<', cutoff).get();
  if(snap.empty) return toast('لا يوجد غرف قديمة');
  const batch = db.batch();
  snap.forEach(d => batch.delete(d.ref));
  await batch.commit();
  toast(`تم حذف ${snap.size} غرفة`);
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
