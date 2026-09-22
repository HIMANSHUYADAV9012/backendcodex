/* =========================================================
   SkillBridge AI — Frontend Logic
   ========================================================= */
const API = "https://backendcodex.vercel.app";
let CURRENT = { user: null, profile: null, role: null, selectedSkills: [] };

/* ------------ CONSTANTS (top pe — TDZ fix) ------------- */
const SKILL_OPTIONS = ["Python","JavaScript","React","SQL","Data Science","Java",
  "Machine Learning","Docker","Node.js","System Design","HTML/CSS"];

/* ------------ helpers ------------- */
const $ = (id) => document.getElementById(id);
const el = (html) => { const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstElementChild; };

async function api(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json'} };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API+path, opts);
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
  return data;
}
function toast(msg, type='info') {
  const colors = { info:'bg-brand-500', success:'bg-emerald-500', error:'bg-red-500' };
  const t = el(`<div class="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-white text-sm shadow-2xl ${colors[type]} fade-in">${msg}</div>`);
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3200);
}
function loader(msg='Thinking…') {
  return `<div class="flex items-center gap-3 p-6 rounded-2xl bg-ink-700/60 border border-ink-600">
    <div class="w-5 h-5 spinner"></div><span class="text-sm text-slate-300">${msg}</span></div>`;
}
function scoreColor(score) {
  if (score >= 75) return { bg:'bg-emerald-500/15', text:'text-emerald-400', bar:'from-emerald-500 to-emerald-400' };
  if (score >= 50) return { bg:'bg-amber-500/15', text:'text-amber-400', bar:'from-amber-500 to-amber-400' };
  return { bg:'bg-red-500/15', text:'text-red-400', bar:'from-red-500 to-red-400' };
}
function scoreBar(score) {
  const c = scoreColor(score);
  return `<div class="h-2 w-full rounded-full bg-ink-800 overflow-hidden">
    <div class="h-full bg-gradient-to-r ${c.bar}" style="width:${Math.max(0,Math.min(100,score))}%"></div>
  </div>`;
}
function ring(score, size=64) {
  const R = size/2 - 6;
  const C = 2*Math.PI*R;
  const off = C * (1 - Math.max(0,Math.min(100,score))/100);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${R}" stroke="#232a48" stroke-width="6" fill="none"/>
    <circle cx="${size/2}" cy="${size/2}" r="${R}" stroke="url(#g${score}${size})" stroke-width="6" fill="none"
      stroke-dasharray="${C}" stroke-dashoffset="${off}" stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>
    <defs><linearGradient id="g${score}${size}"><stop offset="0%" stop-color="#6c8cff"/><stop offset="100%" stop-color="#a86bff"/></linearGradient></defs>
    <text x="50%" y="54%" text-anchor="middle" fill="#e8ecff" font-size="${size*0.28}" font-weight="700" dominant-baseline="middle">${score}</text>
  </svg>`;
}

/* ------------ TAB STYLING ------------- */
function styleTabs() {
  // Base classes ensure karo (safety net) — click handled by inline onclick in HTML
  document.querySelectorAll('.tabBtn').forEach(b => {
    b.classList.add('px-4', 'py-2', 'rounded-full', 'text-sm', 'font-medium', 'transition');
  });
}

/* ------------ SWITCH TAB (exposed globally for inline onclick) ------------- */
function switchTab(tab) {
  console.log('switchTab →', tab);

  // 1) Hide all panels
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.add('hidden');
    p.classList.remove('active');
  });

  // 2) Update active state on tab buttons
  document.querySelectorAll('.tabBtn').forEach(b => {
    const isActive = b.dataset.tab === tab;

    // Base classes (always present)
    b.classList.add('px-4', 'py-2', 'rounded-full', 'text-sm', 'font-medium', 'transition');

    // Active classes
    b.classList.toggle('grad-bg', isActive);
    b.classList.toggle('text-white', isActive);
    b.classList.toggle('border-transparent', isActive);
    b.classList.toggle('shadow', isActive);
    b.classList.toggle('shadow-brand-500/30', isActive);

    // Inactive classes
    b.classList.toggle('border', !isActive);
    b.classList.toggle('border-ink-600', !isActive);
    b.classList.toggle('text-slate-400', !isActive);
  });

  // 3) Show target panel
  const panel = $(tab);
  if (!panel) {
    console.warn('Panel not found for tab:', tab);
    return;
  }
  panel.classList.remove('hidden');
  panel.classList.add('active');

  // 4) Render content
  renderPanel(tab);
}

// 🔑 Make it global so inline onclick in HTML works
window.switchTab = switchTab;

/* ------------ AUTH ------------- */
let selectedRole = 'student';
document.querySelectorAll('.roleBtn').forEach(b=>{
  b.onclick = () => {
    selectedRole = b.dataset.role;
    document.querySelectorAll('.roleBtn').forEach(x=>{
      x.className = 'roleBtn py-2.5 rounded-lg text-sm font-semibold transition ' + (x===b
        ? 'grad-bg text-white shadow'
        : 'text-slate-400 hover:text-white');
    });
  };
});
// set default
document.querySelector('.roleBtn[data-role="student"]').click();

$('sendOtpBtn').onclick = async () => {
  const phone = $('phone').value.trim();
  if (phone.length !== 10) return toast('Enter 10-digit mobile', 'error');

  const btn = $('sendOtpBtn');
  if (btn.disabled) return;                    // guard
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = `<span class="inline-flex items-center gap-2 justify-center">
      <span class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
      Sending OTP…
    </span>`;
  btn.classList.add('opacity-70','cursor-not-allowed');

  try {
    const r = await api('/api/auth/send-otp','POST',{phone, role: selectedRole});
    $('otpWrap').classList.remove('hidden');
    $('verifyOtpBtn').classList.remove('hidden');
    $('authMsg').innerHTML = `<span class="text-emerald-400">OTP sent (demo: 123456)</span>`;
    toast('OTP sent to +91 '+phone, 'success');
    // Auto-focus OTP input
    setTimeout(()=>$('otp').focus(), 100);
    // Change button to "Resend" style
    btn.textContent = 'Resend OTP';
  } catch(e){
    toast(e.message,'error');
    btn.innerHTML = original;
  } finally {
    btn.disabled = false;
    btn.classList.remove('opacity-70','cursor-not-allowed');
    if (btn.innerHTML.includes('Sending')) btn.innerHTML = original;
  }
};

$('verifyOtpBtn').onclick = async () => {
  const phone = $('phone').value.trim();
  const otp = $('otp').value.trim();
  if (!otp) return toast('Enter OTP','error');

  const btn = $('verifyOtpBtn');
  if (btn.disabled) return;                    // guard
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = `<span class="inline-flex items-center gap-2 justify-center">
      <span class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
      Verifying…
    </span>`;
  btn.classList.add('opacity-70','cursor-not-allowed');

  try {
    const r = await api('/api/auth/verify-otp','POST',{phone, otp, role: selectedRole});
    CURRENT.user = r.user;
    CURRENT.role = r.user.role;
    CURRENT.profile = r.profile;

    if (r.onboarded && r.profile) {
      enterApp();
    } else {
      await onboard();
    }
  } catch(e){
    toast(e.message,'error');
    btn.innerHTML = original;
  } finally {
    btn.disabled = false;
    btn.classList.remove('opacity-70','cursor-not-allowed');
  }
};

function logout() {
  CURRENT = { user:null, profile:null, role:null, selectedSkills:[] };
  $('appShell').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
  $('navUser').classList.add('hidden');
  $('navUser').classList.remove('flex');
  $('phone').value = ''; $('otp').value = '';
  $('otpWrap').classList.add('hidden'); $('verifyOtpBtn').classList.add('hidden');
  $('authMsg').textContent = '';
}
window.logout = logout;

/* ------------ ONBOARDING ------------- */
async function onboard() {
  $('authScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  $('navUser').classList.remove('hidden');
  $('navUser').classList.add('flex');
  $('navName').textContent = CURRENT.user.name || 'New User';
  $('navAvatar').textContent = (CURRENT.user.name||'U').charAt(0).toUpperCase();

  $('studentTabs').classList.add('hidden');
  $('industryTabs').classList.add('hidden');
  document.querySelectorAll('.panel').forEach(p=>p.classList.add('hidden'));

  const pane = el(`<div class="max-w-2xl mx-auto"></div>`);
  $('appShell').appendChild(pane);

  if (CURRENT.role === 'student') {
    pane.innerHTML = `
      <div class="p-6 rounded-3xl bg-ink-700/70 border border-ink-600 shadow-2xl">
        <h2 class="text-2xl font-bold">🎓 Complete your student profile</h2>
        <p class="text-sm text-slate-400 mt-1">We'll tailor the test, gaps and internships to your goals.</p>
        <div class="grid md:grid-cols-2 gap-4 mt-6">
          <div><label class="text-xs font-semibold text-slate-400">Full Name *</label>
            <input id="su-name" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="Ada Lovelace"/></div>
          <div><label class="text-xs font-semibold text-slate-400">Email</label>
            <input id="su-email" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="ada@example.com"/></div>
          <div><label class="text-xs font-semibold text-slate-400">College</label>
            <input id="su-college" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="IIT Bombay"/></div>
          <div><label class="text-xs font-semibold text-slate-400">Degree</label>
            <input id="su-degree" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="B.Tech CSE"/></div>
          <div><label class="text-xs font-semibold text-slate-400">Graduation Year</label>
            <input id="su-year" type="number" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="2026"/></div>
          <div><label class="text-xs font-semibold text-slate-400">Target Role *</label>
            <input id="su-role" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="Full-Stack Developer"/></div>
        </div>
        <div class="mt-4">
          <label class="text-xs font-semibold text-slate-400">Short Bio</label>
          <textarea id="su-bio" rows="2" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="Passionate about building products..."></textarea>
        </div>
        <button id="saveStudent" class="mt-6 w-full py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Save & Take Skill Test →</button>
      </div>
    `;
    $('saveStudent').onclick = async () => {
      const body = {
        user_id: CURRENT.user.id,
        name: $('su-name').value.trim(),
        email: $('su-email').value.trim(),
        college: $('su-college').value.trim(),
        degree: $('su-degree').value.trim(),
        graduation_year: parseInt($('su-year').value)||null,
        target_role: $('su-role').value.trim(),
        bio: $('su-bio').value.trim(),
      };
      if (!body.name) return toast('Name required','error');
      try {
        const r = await api('/api/students/profile','POST',body);
        CURRENT.profile = r.student;
        CURRENT.user.onboarded = true;
        pane.remove();
        enterApp();
        switchTab('s-test');
        toast('Profile saved! Take the skill test →','success');
      } catch(e){ toast(e.message,'error'); }
    };
  } else {
    pane.innerHTML = `
      <div class="max-w-2xl mx-auto p-6 rounded-3xl bg-ink-700/70 border border-ink-600 shadow-2xl">
        <h2 class="text-2xl font-bold">🏢 Complete your company profile</h2>
        <p class="text-sm text-slate-400 mt-1">Post jobs and discover top talent by skill.</p>
        <div class="grid md:grid-cols-2 gap-4 mt-6">
          <div><label class="text-xs font-semibold text-slate-400">Company Name *</label>
            <input id="cu-name" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="TechNova"/></div>
          <div><label class="text-xs font-semibold text-slate-400">Industry</label>
            <input id="cu-industry" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="Software"/></div>
          <div><label class="text-xs font-semibold text-slate-400">Website</label>
            <input id="cu-web" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="https://..."/></div>
          <div><label class="text-xs font-semibold text-slate-400">Location</label>
            <input id="cu-loc" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="Bangalore"/></div>
        </div>
        <div class="mt-4"><label class="text-xs font-semibold text-slate-400">About</label>
          <textarea id="cu-about" rows="2" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm"></textarea></div>
        <button id="saveCompany" class="mt-6 w-full py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Save & Continue →</button>
      </div>
    `;
    $('saveCompany').onclick = async () => {
      const body = {
        user_id: CURRENT.user.id,
        name: $('cu-name').value.trim(),
        industry: $('cu-industry').value.trim(),
        website: $('cu-web').value.trim(),
        location: $('cu-loc').value.trim(),
        about: $('cu-about').value.trim(),
      };
      if (!body.name) return toast('Company name required','error');
      try {
        const r = await api('/api/companies/profile','POST',body);
        CURRENT.profile = r.company;
        CURRENT.user.onboarded = true;
        pane.remove();
        enterApp();
        switchTab('i-post');
        toast('Company profile saved!','success');
      } catch(e){ toast(e.message,'error'); }
    };
  }
}

/* ------------ ENTER APP ------------- */
function enterApp() {
  $('authScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  $('navUser').classList.remove('hidden');
  $('navUser').classList.add('flex');
  $('navName').textContent = CURRENT.profile?.name || CURRENT.user.name || 'User';
  $('navAvatar').textContent = (CURRENT.profile?.name||CURRENT.user.name||'U').charAt(0).toUpperCase();
  document.querySelectorAll('.panel').forEach(p=>p.classList.add('hidden'));

  if (CURRENT.role === 'student') {
    $('studentTabs').classList.remove('hidden');
    $('studentTabs').classList.add('flex');
    $('industryTabs').classList.add('hidden');
    $('industryTabs').classList.remove('flex');
    switchTab('s-dashboard');
  } else {
    $('industryTabs').classList.remove('hidden');
    $('industryTabs').classList.add('flex');
    $('studentTabs').classList.add('hidden');
    $('studentTabs').classList.remove('flex');
    switchTab('i-dashboard');
  }
}

/* ------------ SEED BUTTON ------------- */
const seedBtn = $('seedBtn');
if (seedBtn) {
  seedBtn.onclick = async () => {
    try { seedBtn.textContent = 'Seeding…';
      await api('/api/seed','POST');
      toast('Seed complete!', 'success');
      seedBtn.textContent = 'Seed Demo Data';
    } catch(e){ toast(e.message,'error'); seedBtn.textContent='Seed Demo Data'; }
  };
}

/* ------------ PANEL RENDERERS ------------- */
async function renderPanel(tab) {
  const panel = $(tab);
  if (!panel) return;

  if (!CURRENT.profile) {
    panel.innerHTML = `<div class="p-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
      Please complete your profile first.
    </div>`;
    return;
  }

  try {
    if (tab==='s-dashboard') await renderStudentDashboard(panel);
    else if (tab==='s-test') await renderStudentTest(panel);
    else if (tab==='s-gap') await renderStudentGap(panel);
    else if (tab==='s-learn') await renderStudentLearn(panel);
    else if (tab==='s-match') await renderStudentMatch(panel);
    else if (tab==='i-dashboard') await renderIndustryDashboard(panel);
    else if (tab==='i-post') await renderIndustryPost(panel);
    else if (tab==='i-search') await renderIndustrySearch(panel);
  } catch(e){
    panel.innerHTML = `<div class="p-6 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300">${e.message}</div>`;
  }
}

/* =============== STUDENT: DASHBOARD =============== */
async function renderStudentDashboard(panel) {
  const sid = CURRENT.profile.id;
  const d = await api(`/api/dashboard/student/${sid}`);
  const s = d.student;
  const skills = s.skills || {};
  const skillChips = Object.entries(skills).map(([k,v])=>
    `<span class="px-3 py-1.5 rounded-full bg-ink-800 border border-ink-600 text-xs">
      ${k} <span class="ml-1 text-brand-500 font-bold">${v}</span></span>`).join('');

  const topMatch = (d.matches||[])[0];
  const gaps = (d.gaps||[])[0];

  panel.innerHTML = `
    <div class="grid md:grid-cols-3 gap-5">
      <div class="md:col-span-2 p-6 rounded-3xl bg-gradient-to-br from-ink-700 to-ink-800 border border-ink-600">
        <div class="flex items-start justify-between">
          <div>
            <div class="text-xs text-slate-400 font-semibold tracking-wider">WELCOME BACK</div>
            <h2 class="text-3xl font-extrabold mt-1">Hi, ${s.name.split(' ')[0]} 👋</h2>
            <p class="text-slate-400 mt-1 text-sm">${s.target_role || 'Set your target role'} · ${s.college||''}</p>
          </div>
          <div class="w-14 h-14 rounded-2xl grad-bg grid place-items-center text-2xl">🎓</div>
        </div>
        <div class="mt-5 flex flex-wrap gap-2">${skillChips || '<span class="text-sm text-slate-500">No skills yet — take the test</span>'}</div>
      </div>
      <div class="p-6 rounded-3xl bg-ink-700/70 border border-ink-600 flex flex-col items-center justify-center">
        <div class="text-xs text-slate-400 font-semibold">TOP MATCH</div>
        <div class="my-2">${ring(topMatch?.match_score ?? 0, 84)}</div>
        <div class="text-sm text-center text-slate-300">${topMatch ? 'Internship readiness' : 'Take test to unlock'}</div>
      </div>
    </div>

    <div class="grid md:grid-cols-3 gap-5 mt-5">
      <div class="p-5 rounded-2xl bg-ink-700/60 border border-ink-600">
        <div class="text-xs text-slate-400">Skill Test</div>
        <div class="text-2xl font-extrabold mt-1">${Object.keys(skills).length} <span class="text-sm text-slate-500">skills</span></div>
        <button onclick="switchTab('s-test')" class="mt-3 text-xs px-3 py-1.5 rounded-lg border border-ink-600 hover:border-brand-500 hover:text-brand-500 transition">Retake →</button>
      </div>
      <div class="p-5 rounded-2xl bg-ink-700/60 border border-ink-600">
        <div class="text-xs text-slate-400">Gap Match</div>
        <div class="text-2xl font-extrabold mt-1">${gaps?.match_score ?? '—'}<span class="text-sm text-slate-500">%</span></div>
        <button onclick="switchTab('s-gap')" class="mt-3 text-xs px-3 py-1.5 rounded-lg border border-ink-600 hover:border-brand-500 hover:text-brand-500 transition">Analyze →</button>
      </div>
      <div class="p-5 rounded-2xl bg-ink-700/60 border border-ink-600">
        <div class="text-xs text-slate-400">Internship Matches</div>
        <div class="text-2xl font-extrabold mt-1">${(d.matches||[]).length}</div>
        <button onclick="switchTab('s-match')" class="mt-3 text-xs px-3 py-1.5 rounded-lg border border-ink-600 hover:border-brand-500 hover:text-brand-500 transition">View →</button>
      </div>
    </div>
  `;
}

/* =============== STUDENT: SKILL TEST =============== */
async function renderStudentTest(panel) {
  panel.innerHTML = `
    <div class="p-6 rounded-3xl bg-ink-700/60 border border-ink-600">
      <h2 class="text-2xl font-bold">🧪 Skill Test</h2>
      <p class="text-slate-400 text-sm mt-1">Choose the skills you want to be tested on. We'll ask questions from our bank and score you automatically.</p>
      <div class="mt-5 flex flex-wrap gap-2" id="skillPicker">
        ${SKILL_OPTIONS.map(s=>`
          <button data-skill="${s}" class="skillChip px-4 py-2 rounded-full border border-ink-600 text-sm text-slate-300 hover:border-brand-500 transition">${s}</button>
        `).join('')}
      </div>
      <button id="startTest" class="mt-6 px-6 py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Start Test →</button>
    </div>
    <div id="testArea" class="mt-5"></div>
  `;
  const picked = new Set();
  panel.querySelectorAll('.skillChip').forEach(b=>{
    b.onclick = () => {
      const s = b.dataset.skill;
      if (picked.has(s)) { picked.delete(s); b.className='skillChip px-4 py-2 rounded-full border border-ink-600 text-sm text-slate-300 hover:border-brand-500 transition'; }
      else { picked.add(s); b.className='skillChip px-4 py-2 rounded-full grad-bg text-white border border-transparent text-sm transition shadow shadow-brand-500/30'; }
    };
  });
  $('startTest').onclick = async () => {
    if (!picked.size) return toast('Pick at least one skill','error');
    CURRENT.selectedSkills = [...picked];
    await loadTestQuestions(panel);
  };
}

async function loadTestQuestions(panel) {
  const area = $('testArea');
  area.innerHTML = loader('Fetching questions…');
  const d = await api(`/api/questions/by-skills?skills=${encodeURIComponent(CURRENT.selectedSkills.join(','))}`);
  if (!d.questions.length) { area.innerHTML = `<div class="p-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300">No questions found for these skills.</div>`; return; }

  const answers = {};
  area.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-bold">Answer ${d.questions.length} questions</h3>
      <span class="text-xs text-slate-400">Auto-scored by AI</span>
    </div>
    <div class="space-y-4">
      ${d.questions.map((q,i)=>`
        <div class="p-5 rounded-2xl bg-ink-700/60 border border-ink-600" data-qid="${q.id}">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-500 font-semibold">${q.skill}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-ink-800 text-slate-400">Q${i+1}</span>
          </div>
          <div class="font-medium mb-3">${q.question}</div>
          <div class="grid sm:grid-cols-2 gap-2">
            ${q.options.map((o,j)=>`
              <button class="optBtn text-left px-3 py-2.5 rounded-xl border border-ink-600 text-sm hover:border-brand-500 transition" data-qid="${q.id}" data-idx="${j}">${o}</button>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
    <button id="submitTest" class="mt-6 px-6 py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Submit Test →</button>
  `;

  area.querySelectorAll('.optBtn').forEach(b=>{
    b.onclick = () => {
      const qid = b.dataset.qid;
      area.querySelectorAll(`.optBtn[data-qid="${qid}"]`).forEach(x=>{
        x.className='optBtn text-left px-3 py-2.5 rounded-xl border border-ink-600 text-sm hover:border-brand-500 transition';
      });
      b.className='optBtn text-left px-3 py-2.5 rounded-xl grad-bg text-white text-sm border border-transparent transition shadow shadow-brand-500/30';
      answers[qid] = parseInt(b.dataset.idx);
    };
  });

  $('submitTest').onclick = async () => {
    const payload = { student_id: CURRENT.profile.id, answers: Object.entries(answers).map(([question_id,selected_index])=>({question_id, selected_index})) };
    if (!payload.answers.length) return toast('Answer at least one','error');
    area.innerHTML = loader('AI is scoring your answers…');
    try {
      const r = await api('/api/test/submit','POST', payload);
      CURRENT.profile = await api(`/api/students/${CURRENT.profile.id}`);
      toast('Test scored!', 'success');
      renderTestResult(area, r);
    } catch(e){ area.innerHTML = `<div class="p-6 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300">${e.message}</div>`; }
  };
}

function renderTestResult(area, r) {
  const scores = r.skill_scores || {};
  area.innerHTML = `
    <div class="p-6 rounded-3xl bg-ink-700/60 border border-ink-600">
      <h3 class="text-2xl font-bold">✅ Test Complete</h3>
      <p class="text-slate-400 text-sm mt-1">Your skills have been updated. Head to Gap Analysis next.</p>
      <div class="grid sm:grid-cols-2 md:grid-cols-3 gap-4 mt-5">
        ${Object.entries(scores).map(([skill,lvl])=>{
          const pct = Math.round((lvl/5)*100);
          const c = scoreColor(pct);
          return `<div class="p-4 rounded-2xl bg-ink-800 border border-ink-600">
            <div class="flex items-center justify-between">
              <div class="font-semibold text-sm">${skill}</div>
              <span class="text-xs px-2 py-0.5 rounded-full ${c.bg} ${c.text} font-bold">L${lvl}</span>
            </div>
            <div class="mt-2">${scoreBar(pct)}</div>
            <div class="text-[11px] text-slate-500 mt-2">${r.raw[skill].correct}/${r.raw[skill].total} correct</div>
          </div>`;
        }).join('')}
      </div>
      <button onclick="switchTab('s-gap')" class="mt-6 px-6 py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Continue to Gap Analysis →</button>
    </div>
  `;
}

/* =============== STUDENT: GAP =============== */
async function renderStudentGap(panel) {
  const target = CURRENT.profile.target_role || '';
  panel.innerHTML = `
    <div class="p-6 rounded-3xl bg-ink-700/60 border border-ink-600">
      <h2 class="text-2xl font-bold">🎯 Skill-Gap Analysis</h2>
      <p class="text-slate-400 text-sm mt-1">AI compares your tested skills against the target role.</p>
      <div class="mt-5 flex flex-col sm:flex-row gap-3">
        <input id="gapRole" value="${target}" placeholder="e.g. Full-Stack Developer" class="flex-1 px-3 py-3 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm"/>
        <button id="runGap" class="px-6 py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Analyze</button>
      </div>
    </div>
    <div id="gapOut" class="mt-5"></div>
  `;
  $('runGap').onclick = async () => {
    const role = $('gapRole').value.trim();
    if (!role) return toast('Enter a role','error');
    const out = $('gapOut');
    out.innerHTML = loader('Analyzing your gap with AI…');
    try {
      const d = await api('/api/gap-analysis','POST',{ student_id: CURRENT.profile.id, target_role: role });
      const score = d.match_score || 0;
      out.innerHTML = `
        <div class="p-6 rounded-3xl bg-gradient-to-br from-ink-700 to-ink-800 border border-ink-600 flex flex-col md:flex-row items-center gap-6">
          <div>${ring(score, 110)}</div>
          <div class="flex-1">
            <div class="text-xs font-semibold text-slate-400 tracking-wider">MATCH FOR</div>
            <h3 class="text-2xl font-bold">${d.target_role}</h3>
            <p class="text-slate-400 mt-2 text-sm">${d.summary||''}</p>
          </div>
        </div>

        <h3 class="mt-6 text-lg font-bold">Gaps to close</h3>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
          ${(d.gaps||[]).map(g=>{
            const c = g.priority==='high' ? 'text-red-400 bg-red-500/10' :
                      g.priority==='medium' ? 'text-amber-400 bg-amber-500/10' :
                      'text-emerald-400 bg-emerald-500/10';
            const pct = Math.round((g.current_level/g.required_level)*100);
            return `<div class="p-4 rounded-2xl bg-ink-700/60 border border-ink-600">
              <div class="flex items-center justify-between">
                <div class="font-semibold">${g.skill}</div>
                <span class="text-[10px] px-2 py-0.5 rounded-full ${c} font-bold uppercase">${g.priority}</span>
              </div>
              <div class="text-xs text-slate-400 mt-1">Current ${g.current_level} / Required ${g.required_level}</div>
              <div class="mt-2">${scoreBar(pct)}</div>
            </div>`;
          }).join('') || '<div class="text-slate-500 text-sm">No gaps — you are ready! 🎉</div>'}
        </div>

        <h3 class="mt-6 text-lg font-bold">Required skills for ${d.target_role}</h3>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          ${(d.required_skills||[]).map(r=>`
            <div class="p-3 rounded-2xl bg-ink-700/60 border border-ink-600 flex items-center justify-between">
              <div class="text-sm font-medium">${r.skill}</div>
              <div class="text-xs px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-500 font-bold">L${r.required_level}</div>
            </div>
          `).join('')}
        </div>
        <div class="mt-6 flex gap-3">
          <button onclick="switchTab('s-learn')" class="px-6 py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Get Learning Plan →</button>
          <button onclick="switchTab('s-match')" class="px-6 py-3 rounded-xl border border-ink-600 hover:border-brand-500 hover:text-brand-500 font-semibold transition">See Internships →</button>
        </div>
      `;
    } catch(e){ out.innerHTML = `<div class="p-6 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300">${e.message}</div>`; }
  };
}

/* =============== STUDENT: LEARN =============== */
async function renderStudentLearn(panel) {
  const d = await api(`/api/dashboard/student/${CURRENT.profile.id}`);
  const latestGap = (d.gaps||[])[0];
  const gapSkills = latestGap ? (latestGap.missing_skills||[]).map(g=>g.skill).filter(Boolean) : [];

  panel.innerHTML = `
    <div class="p-6 rounded-3xl bg-ink-700/60 border border-ink-600">
      <h2 class="text-2xl font-bold">📚 Learning Recommendations</h2>
      <p class="text-slate-400 text-sm mt-1">AI-curated resources and milestone projects. Auto-filled from your latest gap analysis.</p>
      <label class="text-xs font-semibold text-slate-400 block mt-4">Skills to learn</label>
      <input id="learnSkills" value="${gapSkills.join(', ')}" placeholder="Comma separated skills" class="w-full mt-1.5 px-3 py-3 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm"/>
      <button id="runLearn" class="mt-4 px-6 py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Generate Plan →</button>
    </div>
    <div id="learnOut" class="mt-5"></div>
  `;
  $('runLearn').onclick = async () => {
    const skills = $('learnSkills').value.split(',').map(s=>s.trim()).filter(Boolean);
    if (!skills.length) return toast('Add skills','error');
    const out = $('learnOut');
    out.innerHTML = loader('Curating best resources with AI…');
    try {
      const r = await api('/api/recommend','POST',{ student_id: CURRENT.profile.id, skills });
      out.innerHTML = (r.recommendations||[]).map(rec => `
        <div class="p-6 rounded-3xl bg-ink-700/60 border border-ink-600 mb-4">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <h3 class="text-xl font-bold">${rec.skill}</h3>
            <div class="flex gap-2">
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-500 font-bold uppercase">${rec.priority||'medium'}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-bold">~${rec.estimated_weeks||4} weeks</span>
            </div>
          </div>
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
            ${(rec.resources||[]).map(res=>`
              <a href="${res.url||'#'}" target="_blank" rel="noopener" class="block p-4 rounded-2xl bg-ink-800 border border-ink-600 hover:border-brand-500 transition group">
                <div class="text-[10px] uppercase font-bold text-brand-500">${res.type||'resource'}</div>
                <div class="font-semibold text-sm mt-1 group-hover:text-brand-500 transition">${res.title}</div>
                <div class="text-xs text-slate-500 mt-1">${res.provider||''}</div>
              </a>
            `).join('')}
          </div>
          ${rec.milestone_project ? `<div class="mt-4 p-4 rounded-2xl bg-brand-500/10 border border-brand-500/20">
            <div class="text-[10px] uppercase font-bold text-brand-500">🎯 Milestone Project</div>
            <div class="text-sm mt-1">${rec.milestone_project}</div>
          </div>` : ''}
        </div>
      `).join('') || `<div class="p-6 rounded-2xl bg-ink-700/60 border border-ink-600 text-slate-400">No recommendations returned.</div>`;
    } catch(e){ out.innerHTML = `<div class="p-6 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300">${e.message}</div>`; }
  };
}

/* =============== STUDENT: MATCH =============== */
async function renderStudentMatch(panel) {
  panel.innerHTML = `
    <div class="p-6 rounded-3xl bg-ink-700/60 border border-ink-600 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold">🚀 Internship & Placement Matches</h2>
        <p class="text-slate-400 text-sm mt-1">Ranked by skill-match percentage against every job.</p>
      </div>
      <button id="runMatch" class="px-6 py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30 whitespace-nowrap">Find My Matches →</button>
    </div>
    <div id="matchOut" class="mt-5"></div>
  `;
  $('runMatch').onclick = async () => {
    const out = $('matchOut');
    out.innerHTML = loader('Matching your skills with jobs…');
    try {
      const r = await api('/api/match/student','POST',{ student_id: CURRENT.profile.id });
      if (!r.matches.length) { out.innerHTML = `<div class="p-6 rounded-2xl bg-ink-700/60 border border-ink-600 text-slate-400">No jobs yet. Ask admin to seed demo data.</div>`; return; }
      out.innerHTML = r.matches.map((m,i)=>`
        <div class="p-5 rounded-3xl bg-ink-700/60 border border-ink-600 mb-4 fade-in">
          <div class="flex flex-col md:flex-row md:items-center gap-4">
            <div class="flex items-center gap-4 flex-1">
              <div class="w-12 h-12 rounded-2xl grad-bg grid place-items-center font-black text-white">${m.company.charAt(0)}</div>
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  ${i===0?'<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold">🏆 TOP PICK</span>':''}
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-ink-800 text-slate-400">${m.type||'Internship'}</span>
                </div>
                <h3 class="text-lg font-bold mt-1">${m.title}</h3>
                <div class="text-xs text-slate-400 mt-0.5">${m.company} · ${m.location||'—'} · ${m.stipend||''} ${m.duration?'· '+m.duration:''}</div>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <div class="text-right">
                <div class="text-[10px] text-slate-500 uppercase font-bold">Match</div>
                <div class="text-2xl font-extrabold grad-text">${m.match_score}%</div>
              </div>
              <div>${ring(m.match_score, 60)}</div>
            </div>
          </div>
          ${m.reason ? `<div class="mt-3 text-sm text-slate-400 italic">${m.reason}</div>` : ''}
          <div class="mt-4 grid sm:grid-cols-2 gap-3">
            <div>
              <div class="text-[10px] font-bold text-slate-500 uppercase">Required Skills</div>
              <div class="flex flex-wrap gap-1.5 mt-1.5">
                ${Object.entries(m.required_skills||{}).map(([s,l])=>`
                  <span class="text-[11px] px-2 py-0.5 rounded-full bg-ink-800 border border-ink-600">${s} <b class="text-brand-500">L${l}</b></span>
                `).join('')}
              </div>
            </div>
            ${(m.missing_skills||[]).length? `
            <div>
              <div class="text-[10px] font-bold text-slate-500 uppercase">Missing</div>
              <div class="flex flex-wrap gap-1.5 mt-1.5">
                ${m.missing_skills.map(s=>`<span class="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">${s}</span>`).join('')}
              </div>
            </div>`:''}
          </div>
        </div>
      `).join('');
    } catch(e){ out.innerHTML = `<div class="p-6 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300">${e.message}</div>`; }
  };
}

/* =============== INDUSTRY: DASHBOARD =============== */
async function renderIndustryDashboard(panel) {
  const d = await api(`/api/dashboard/industry/${CURRENT.profile.id}`);
  panel.innerHTML = `
    <div class="p-6 rounded-3xl bg-gradient-to-br from-ink-700 to-ink-800 border border-ink-600 flex items-start justify-between">
      <div>
        <div class="text-xs font-semibold text-slate-400 tracking-wider">COMPANY</div>
        <h2 class="text-3xl font-extrabold mt-1">${d.company.name}</h2>
        <p class="text-slate-400 text-sm mt-1">${d.company.industry||''} · ${d.company.location||''}</p>
      </div>
      <div class="w-14 h-14 rounded-2xl grad-bg grid place-items-center text-2xl">🏢</div>
    </div>
    <div class="grid md:grid-cols-3 gap-5 mt-5">
      <div class="p-5 rounded-2xl bg-ink-700/60 border border-ink-600">
        <div class="text-xs text-slate-400">Active Postings</div>
        <div class="text-3xl font-extrabold mt-1">${d.jobs.length}</div>
        <button onclick="switchTab('i-post')" class="mt-3 text-xs px-3 py-1.5 rounded-lg border border-ink-600 hover:border-brand-500 hover:text-brand-500 transition">+ Post New</button>
      </div>
      <div class="p-5 rounded-2xl bg-ink-700/60 border border-ink-600">
        <div class="text-xs text-slate-400">Students in Pool</div>
        <div class="text-3xl font-extrabold mt-1">20+</div>
        <button onclick="switchTab('i-search')" class="mt-3 text-xs px-3 py-1.5 rounded-lg border border-ink-600 hover:border-brand-500 hover:text-brand-500 transition">Browse Talent →</button>
      </div>
      <div class="p-5 rounded-2xl bg-ink-700/60 border border-ink-600">
        <div class="text-xs text-slate-400">Skill Tracks</div>
        <div class="text-3xl font-extrabold mt-1">11</div>
        <div class="text-xs text-slate-500 mt-3">Python, JS, React, SQL …</div>
      </div>
    </div>

    <h3 class="mt-8 text-lg font-bold">Your Job Postings</h3>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
      ${d.jobs.map(j=>`
        <div class="p-5 rounded-2xl bg-ink-700/60 border border-ink-600">
          <div class="flex items-center gap-2">
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-500 font-bold">${j.type}</span>
            <span class="text-[10px] text-slate-500">${j.duration||''}</span>
          </div>
          <div class="font-bold mt-2">${j.title}</div>
          <div class="text-xs text-slate-400 mt-1">${j.location||''} · ${j.stipend||''}</div>
          <div class="flex flex-wrap gap-1 mt-3">
            ${Object.entries(j.required_skills||{}).map(([s,l])=>`<span class="text-[10px] px-2 py-0.5 rounded-full bg-ink-800 border border-ink-600">${s} L${l}</span>`).join('')}
          </div>
          <button onclick="quickFind('${j.id}')" class="mt-3 text-xs px-3 py-1.5 rounded-lg grad-bg text-white font-semibold w-full">Find Matching Students →</button>
        </div>
      `).join('') || '<div class="text-slate-500 text-sm">No jobs posted yet.</div>'}
    </div>
  `;
}

window.quickFind = (jobId) => {
  switchTab('i-search');
  setTimeout(()=>{ const sel=$('jobSelect'); if(sel){ sel.value=jobId; const rf=$('runFind'); if(rf) rf.click(); } }, 400);
};

/* =============== INDUSTRY: POST JOB =============== */
async function renderIndustryPost(panel) {
  panel.innerHTML = `
    <div class="p-6 rounded-3xl bg-ink-700/60 border border-ink-600 max-w-3xl mx-auto">
      <h2 class="text-2xl font-bold">➕ Post a New Job / Internship</h2>
      <p class="text-slate-400 text-sm mt-1">Set required skills & levels — we'll rank candidates automatically.</p>

      <div class="grid sm:grid-cols-2 gap-4 mt-6">
        <div class="sm:col-span-2">
          <label class="text-xs font-semibold text-slate-400">Job Title *</label>
          <input id="j-title" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="Full-Stack Engineer Intern"/>
        </div>
        <div class="sm:col-span-2">
          <label class="text-xs font-semibold text-slate-400">Description</label>
          <textarea id="j-desc" rows="2" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="What will they work on?"></textarea>
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-400">Location</label>
          <input id="j-loc" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="Bangalore"/>
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-400">Type</label>
          <select id="j-type" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm">
            <option>Internship</option><option>Full-time</option>
          </select>
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-400">Stipend / CTC</label>
          <input id="j-stipend" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="₹25,000/mo"/>
        </div>
        <div>
          <label class="text-xs font-semibold text-slate-400">Duration</label>
          <input id="j-duration" class="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm" placeholder="6 months"/>
        </div>
      </div>

      <div class="mt-6">
        <label class="text-xs font-semibold text-slate-400 block mb-2">Required Skills (set level 1-5)</label>
        <div id="reqSkills" class="space-y-2"></div>
        <button id="addReq" class="mt-3 text-xs px-3 py-1.5 rounded-lg border border-ink-600 hover:border-brand-500 hover:text-brand-500 transition">+ Add Skill</button>
      </div>

      <button id="submitJob" class="mt-6 w-full py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Post Job →</button>
    </div>
  `;
  const wrap = $('reqSkills');
  function addReq(skill='', lvl=3) {
    const row = el(`<div class="flex gap-2 items-center">
      <input placeholder="Skill" value="${skill}" class="flex-1 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm"/>
      <input type="number" min="1" max="5" value="${lvl}" class="w-20 px-3 py-2.5 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm"/>
      <button type="button" class="px-3 py-2.5 rounded-xl border border-ink-600 hover:border-red-400 hover:text-red-400 transition text-sm">✕</button>
    </div>`);
    row.querySelector('button').onclick = () => row.remove();
    wrap.appendChild(row);
  }
  ['Python','React','SQL'].forEach(s=>addReq(s));
  $('addReq').onclick = () => addReq();

  $('submitJob').onclick = async () => {
    const title = $('j-title').value.trim();
    if (!title) return toast('Job title required','error');
    const req = {};
    wrap.querySelectorAll('.flex').forEach(r=>{
      const inputs = r.querySelectorAll('input');
      const sv = inputs[0].value.trim();
      const lv = parseInt(inputs[1].value);
      if (sv && lv>=1 && lv<=5) req[sv] = lv;
    });
    if (!Object.keys(req).length) return toast('Add at least one required skill','error');
    try {
      await api('/api/jobs','POST',{
        company_id: CURRENT.profile.id,
        title,
        description: $('j-desc').value.trim(),
        required_skills: req,
        location: $('j-loc').value.trim(),
        type: $('j-type').value,
        stipend: $('j-stipend').value.trim(),
        duration: $('j-duration').value.trim(),
      });
      toast('Job posted!','success');
      switchTab('i-dashboard');
    } catch(e){ toast(e.message,'error'); }
  };
}

/* =============== INDUSTRY: SEARCH =============== */
async function renderIndustrySearch(panel) {
  const d = await api(`/api/dashboard/industry/${CURRENT.profile.id}`);
  panel.innerHTML = `
    <div class="p-6 rounded-3xl bg-ink-700/60 border border-ink-600">
      <h2 class="text-2xl font-bold">🔎 Find Top Talent by Skill</h2>
      <p class="text-slate-400 text-sm mt-1">Pick one of your jobs — students will be ranked by match percentage.</p>
      <div class="mt-5 flex flex-col sm:flex-row gap-3">
        <select id="jobSelect" class="flex-1 px-3 py-3 rounded-xl bg-ink-800 border border-ink-600 focus:border-brand-500 outline-none text-sm">
          ${d.jobs.map(j=>`<option value="${j.id}">${j.title} — ${Object.entries(j.required_skills||{}).map(([s,l])=>s+' L'+l).join(', ')}</option>`).join('')}
        </select>
        <button id="runFind" class="px-6 py-3 rounded-xl grad-bg font-semibold text-white shadow-lg shadow-brand-500/30">Find Students →</button>
      </div>
    </div>
    <div id="findOut" class="mt-5"></div>
  `;
  $('runFind').onclick = async () => {
    const jobId = $('jobSelect').value;
    if (!jobId) return toast('Post a job first','error');
    const out = $('findOut');
    out.innerHTML = loader('Ranking candidates…');
    try {
      const r = await api('/api/match/industry','POST',{ company_id: CURRENT.profile.id, job_id: jobId });
      if (!r.candidates.length) { out.innerHTML = `<div class="p-6 rounded-2xl bg-ink-700/60 border border-ink-600 text-slate-400">No matching students found.</div>`; return; }
      out.innerHTML = `
        <div class="text-sm text-slate-400 mb-4">${r.candidates.length} candidates ranked · Top match first</div>
        ${r.candidates.map((c,i)=>`
          <div class="p-5 rounded-3xl bg-ink-700/60 border border-ink-600 mb-4 fade-in">
            <div class="flex flex-col md:flex-row md:items-center gap-4">
              <div class="flex items-center gap-4 flex-1">
                <div class="w-12 h-12 rounded-2xl grad-bg grid place-items-center font-black text-white">${(c.name||'?').charAt(0)}</div>
                <div>
                  <div class="flex items-center gap-2">
                    ${i===0?'<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold">🏆 TOP CANDIDATE</span>':''}
                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-500 font-bold">Rank #${i+1}</span>
                  </div>
                  <h3 class="text-lg font-bold mt-1">${c.name}</h3>
                  <div class="text-xs text-slate-400 mt-0.5">${c.college||''} · ${c.degree||''} ${c.graduation_year?'· '+c.graduation_year:''}</div>
                  <div class="text-[11px] text-slate-500 mt-1">Target: ${c.target_role||'—'}</div>
                </div>
              </div>
              <div class="flex items-center gap-4">
                <div class="text-right">
                  <div class="text-[10px] text-slate-500 uppercase font-bold">Match</div>
                  <div class="text-2xl font-extrabold grad-text">${c.match_score}%</div>
                </div>
                <div>${ring(c.match_score, 60)}</div>
              </div>
            </div>
            <div class="mt-4 grid sm:grid-cols-2 gap-3">
              <div>
                <div class="text-[10px] font-bold text-slate-500 uppercase">Skills</div>
                <div class="flex flex-wrap gap-1.5 mt-1.5">
                  ${Object.entries(c.skills||{}).map(([s,l])=>`
                    <span class="text-[11px] px-2 py-0.5 rounded-full bg-ink-800 border border-ink-600">${s} <b class="text-brand-500">L${l}</b></span>
                  `).join('')}
                </div>
              </div>
              ${(c.missing_skills||[]).length? `
              <div>
                <div class="text-[10px] font-bold text-slate-500 uppercase">Missing</div>
                <div class="flex flex-wrap gap-1.5 mt-1.5">
                  ${c.missing_skills.map(s=>`<span class="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">${s}</span>`).join('')}
                </div>
              </div>`:''}
            </div>
          </div>
        `).join('')}
      `;
    } catch(e){ out.innerHTML = `<div class="p-6 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300">${e.message}</div>`; }
  };
}

/* ------------ BOOT ------------- */
document.addEventListener('DOMContentLoaded', () => {
  styleTabs();
  const sb = $('seedBtn');
  if (sb) sb.classList.remove('hidden');
});

window.addEventListener('load', async () => {
  try { await api('/api/seed','POST'); } catch(_) {}
});
