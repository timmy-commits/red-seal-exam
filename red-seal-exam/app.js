/* Red Seal Plumbing Exam Engine (local-only)
   - Loads data/*.json
   - Optional: SkilledTradesBC IP Blueprint (2023 RSOS) weighting by Task
   - Shuffles and serves 15 / 40 / 125 questions
   - Shows explanation + clause references under each question after answer
*/

const BANK_FILES = {
  core: "data/questions-core.json",
  dwv: "data/questions-dwv.json",
  hydronic: "data/questions-hydronic.json",
  safety: "data/questions-safety.json",
  tools: "data/questions-tools.json",
  math: "data/questions-math.json",
};

const BLUEPRINT_FILE = "data/blueprint-plumber-ip-2023-stbc.json";

const el = (id) => document.getElementById(id);
const setup = el("setup");
const exam = el("exam");
const results = el("results");

const bankStatus = el("bankStatus");
const blueprintStatus = el("blueprintStatus");

const startBtn = el("startBtn");
const loadBtn = el("loadBtn");
const quitBtn = el("quitBtn");
const prevBtn = el("prevBtn");
const nextBtn = el("nextBtn");

const kpiQ = el("kpiQ");
const kpiTotal = el("kpiTotal");
const kpiScore = el("kpiScore");
const kpiMeta = el("kpiMeta");

const questionHost = el("questionHost");
const resultsSummary = el("resultsSummary");
const missedHost = el("missedHost");
const reviewMissedBtn = el("reviewMissedBtn");
const restartBtn = el("restartBtn");

let BANK = [];
let BLUEPRINT = null;
let SESSION = null;

function shuffle(arr){
  const a = [...arr];
  for(let i=a.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getSelectedLength(){
  const v = document.querySelector('input[name="length"]:checked')?.value || "15";
  return parseInt(v, 10);
}
function getMode(){
  return document.querySelector('input[name="mode"]:checked')?.value || "exam";
}
function getSelectedCats(){
  return [...document.querySelectorAll(".cat:checked")].map(x=>x.value);
}
function useBlueprintEnabled(){
  return !!document.getElementById("useBlueprint")?.checked;
}

async function loadBank(){
  const cats = Object.keys(BANK_FILES);
  const loaded = [];
  const failures = [];

  for(const cat of cats){
    try{
      const res = await fetch(BANK_FILES[cat], {cache:"no-store"});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if(Array.isArray(data)) loaded.push(...data);
    }catch(err){
      failures.push(cat);
      console.warn("Failed loading", cat, err);
    }
  }

  // Minimal validation: don’t crash on bad rows
  BANK = loaded.filter(q =>
    q && typeof q.id === "string" &&
    typeof q.stem === "string" &&
    Array.isArray(q.choices) && q.choices.length >= 2 &&
    Number.isInteger(q.answerIndex)
  );

  const counts = BANK.reduce((acc,q)=>{ acc[q.bank || q.category || "unknown"]=(acc[q.bank || q.category || "unknown"]||0)+1; return acc; }, {});
  bankStatus.textContent =
    `Question bank loaded: ${BANK.length} total • ` +
    Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(" • ") +
    (failures.length ? ` • Missing files: ${failures.join(", ")}` : "");

  return BANK.length;
}

async function loadBlueprint(){
  try{
    const res = await fetch(BLUEPRINT_FILE, {cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if(!data || !Array.isArray(data.tasks) || typeof data.totalQuestions !== "number"){
      throw new Error("Blueprint schema invalid");
    }

    BLUEPRINT = data;
    blueprintStatus.textContent = `Blueprint loaded: ${data.name} • Total: ${data.totalQuestions}`;
  }catch(e){
    console.warn("Blueprint not loaded", e);
    BLUEPRINT = null;
    blueprintStatus.textContent = "Blueprint: not loaded (file missing or invalid).";
  }
}

function startSession(){
  const len = getSelectedLength();
  const mode = getMode();
  const cats = getSelectedCats();
  const bpOn = useBlueprintEnabled() && BLUEPRINT && Array.isArray(BLUEPRINT.tasks);

  // Filter by selected banks first
  const pool = BANK.filter(q => cats.includes(q.bank || q.category || "core"));

  let questions = [];

  if(bpOn){
    const scale = len / 125;
    const tasks = BLUEPRINT.tasks.filter(t => (t.count125 || 0) > 0);

    // Rounded base targets
    let targets = tasks.map(t => ({
      taskId: t.taskId,
      title: t.title,
      count125: t.count125,
      target: (len === 125) ? t.count125 : Math.floor(t.count125 * scale),
      remainder: (t.count125 * scale) - Math.floor(t.count125 * scale),
    }));

    // Distribute remaining using largest remainder
    const current = targets.reduce((s,x)=>s+x.target,0);
    let remaining = len - current;

    if(len !== 125 && remaining > 0){
      targets = targets.sort((a,b)=>b.remainder-a.remainder);
      for(let i=0; i<remaining; i++){
        targets[i % targets.length].target++;
      }
    }

    // Pull per taskId
    const missingTasks = [];
    for(const t of targets){
      const taskPool = pool.filter(q => q.taskId === t.taskId);
      if(taskPool.length < t.target){
        missingTasks.push(`${t.taskId} needs ${t.target}, has ${taskPool.length}`);
      }
      questions.push(...shuffle(taskPool).slice(0, t.target));
    }

    // Top-up randomly if short (bank not complete yet)
    if(questions.length < len){
      const used = new Set(questions.map(q=>q.id));
      const topUp = shuffle(pool.filter(q=>!used.has(q.id))).slice(0, len - questions.length);
      questions.push(...topUp);
    }

    if(missingTasks.length){
      alert(
        "Blueprint ON, but your question bank is missing enough questions in some tasks:\n\n" +
        missingTasks.join("\n") +
        "\n\nThe test will top-up randomly until you add more questions tagged with taskId."
      );
    }

    questions = shuffle(questions);
  } else {
    // Original behavior
    const usable = pool.length >= len ? pool : BANK;
    questions = shuffle(usable).slice(0, len);
  }

  SESSION = {
    mode,
    questions,
    index: 0,
    answers: questions.map(()=>({ chosenIndex: null, isCorrect: null })),
    startedAt: Date.now(),
  };

  setup.classList.add("hidden");
  results.classList.add("hidden");
  exam.classList.remove("hidden");

  kpiTotal.textContent = String(SESSION.questions.length);
  renderCurrent();
}

function quitSession(){
  SESSION = null;
  exam.classList.add("hidden");
  results.classList.add("hidden");
  setup.classList.remove("hidden");
  missedHost.innerHTML = "";
}

function finishSession(){
  const total = SESSION.questions.length;
  const correct = SESSION.answers.filter(a=>a.isCorrect).length;
  const pct = Math.round((correct/total)*100);

  exam.classList.add("hidden");
  results.classList.remove("hidden");

  resultsSummary.textContent = `You scored ${correct}/${total} (${pct}%).`;

  // Build missed list
  const missed = SESSION.questions
    .map((q,i)=>({q, a: SESSION.answers[i]}))
    .filter(x => x.a.isCorrect === false);

  missedHost.innerHTML = "";
  if(missed.length === 0){
    missedHost.innerHTML = `<p class="muted">No missed questions. Run another shuffle.</p>`;
  }else{
    missedHost.innerHTML = `<p class="muted">Missed: ${missed.length}. Hit “Review Missed” to drill them.</p>`;
  }
}

function renderCurrent(){
  const i = SESSION.index;
  const q = SESSION.questions[i];
  const a = SESSION.answers[i];

  kpiQ.textContent = String(i+1);
  const score = SESSION.answers.filter(x=>x.isCorrect).length;
  kpiScore.textContent = String(score);

  const meta = [];
  if(q.taskId) meta.push(`Task: ${q.taskId}`);
  if(q.category) meta.push(q.category);
  if(q.difficulty) meta.push(`Difficulty: ${q.difficulty}`);
  kpiMeta.textContent = meta.join(" • ");

  questionHost.innerHTML = "";
  questionHost.appendChild(renderQuestionCard(q, a, {interactive:true}));

  prevBtn.disabled = i === 0;
  nextBtn.textContent = (i === SESSION.questions.length - 1) ? "Finish" : "Next";
}

function renderQuestionCard(q, aState, opts){
  const card = document.createElement("div");
  card.className = "qcard";

  const meta = document.createElement("div");
  meta.className = "qmeta";

  const cat = document.createElement("span");
  cat.className = "tag";
  cat.textContent = (q.category || "Uncategorized");
  meta.appendChild(cat);

  const bank = document.createElement("span");
  bank.className = "tag";
  bank.textContent = `Bank: ${(q.bank || q.category || "core")}`;
  meta.appendChild(bank);

  if(q.taskId){
    const task = document.createElement("span");
    task.className = "tag";
    task.textContent = `Task: ${q.taskId}`;
    meta.appendChild(task);
  }

  card.appendChild(meta);

  const stem = document.createElement("div");
  stem.className = "stem";
  stem.textContent = q.stem;
  card.appendChild(stem);

  const choices = document.createElement("div");
  choices.className = "choices";

  const answered = (aState.chosenIndex !== null);

  q.choices.forEach((c, idx)=>{
    const btn = document.createElement("div");
    btn.className = "choice";
    btn.textContent = c;

    if(aState.chosenIndex === idx) btn.classList.add("selected");

    if(answered){
      if(idx === q.answerIndex) btn.classList.add("correct");
      if(aState.chosenIndex === idx && aState.isCorrect === false) btn.classList.add("wrong");
    }

    if(opts.interactive){
      btn.addEventListener("click", ()=>{
        if(aState.chosenIndex !== null) return; // lock once answered
        aState.chosenIndex = idx;
        aState.isCorrect = (idx === q.answerIndex);
        renderCurrent();
      });
    }

    choices.appendChild(btn);
  });

  card.appendChild(choices);

  // Explanation + references AFTER answer
  if(answered){
    const ex = document.createElement("div");
    ex.className = "explain";

    const verdict = document.createElement("div");
    verdict.className = "row";

    const tag = document.createElement("span");
    tag.className = "tag " + (aState.isCorrect ? "good" : "bad");
    tag.textContent = aState.isCorrect ? "Correct" : "Incorrect";
    verdict.appendChild(tag);

    if(SESSION.mode === "training"){
      const t = document.createElement("span");
      t.className = "tag warn";
      t.textContent = "Training mode";
      verdict.appendChild(t);
    }

    ex.appendChild(verdict);

    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = q.explanation || "Explanation not provided.";
    ex.appendChild(p);

    const refs = document.createElement("div");
    refs.className = "refs";

    (q.references || []).forEach(r=>{
      const box = document.createElement("div");
      box.className = "ref";
      const conf = (r.confidence || "needs_verify");
      const confLabel =
        conf === "verified" ? `<span class="tag good">verified</span>` :
        `<span class="tag warn">needs_verify</span>`;

      box.innerHTML = `
        <div class="row" style="justify-content:space-between;">
          <div><b>${escapeHtml(r.code || "Reference")}</b> — ${escapeHtml(r.location || "")}</div>
          ${confLabel}
        </div>
        <div class="muted" style="margin-top:6px;">${escapeHtml(r.note || "")}</div>
      `;
      refs.appendChild(box);
    });

    if((q.references||[]).length){
      ex.appendChild(refs);
    }

    card.appendChild(ex);
  }

  return card;
}

function escapeHtml(s){
  return String(s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function next(){
  const i = SESSION.index;

  const a = SESSION.answers[i];
  if(a.chosenIndex === null){
    alert("Choose an answer first.");
    return;
  }

  if(i === SESSION.questions.length - 1){
    finishSession();
    return;
  }
  SESSION.index++;
  renderCurrent();
}

function prev(){
  if(SESSION.index === 0) return;
  SESSION.index--;
  renderCurrent();
}

function reviewMissed(){
  const missed = SESSION.questions
    .map((q,i)=>({q, a: SESSION.answers[i]}))
    .filter(x => x.a.isCorrect === false);

  missedHost.innerHTML = "";
  if(missed.length === 0){
    missedHost.innerHTML = `<p class="muted">No missed questions.</p>`;
    return;
  }

  missed.forEach((x)=>{
    const dummyState = { chosenIndex: x.a.chosenIndex, isCorrect: false };
    const card = renderQuestionCard(x.q, dummyState, {interactive:false});
    missedHost.appendChild(card);
  });
}

startBtn.addEventListener("click", ()=>{
  if(BANK.length === 0){
    alert("Load the question bank first.");
    return;
  }
  startSession();
});
loadBtn.addEventListener("click", async ()=>{
  await loadBank();
  await loadBlueprint();
});
quitBtn.addEventListener("click", quitSession);
nextBtn.addEventListener("click", next);
prevBtn.addEventListener("click", prev);
restartBtn.addEventListener("click", quitSession);
reviewMissedBtn.addEventListener("click", reviewMissed);

// Auto-load on open
(async ()=>{
  await loadBank();
  await loadBlueprint();
})();
