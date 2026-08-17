const TOOLS = ["ChatGPT","Claude","Lovable","Antigravity","Cursor","GitHub Copilot","Gemini","Perplexity","NotebookLM","v0","Replit","Bolt","Canva AI","Gamma"];

const TOOL_URLS = {
  "ChatGPT":"https://chat.openai.com","Claude":"https://claude.ai","Lovable":"https://lovable.dev",
  "Antigravity":"https://antigravity.google","Cursor":"https://cursor.com","GitHub Copilot":"https://github.com/features/copilot",
  "Gemini":"https://gemini.google.com","Perplexity":"https://www.perplexity.ai","NotebookLM":"https://notebooklm.google",
  "v0":"https://v0.dev","Replit":"https://replit.com","Bolt":"https://bolt.new","Canva AI":"https://www.canva.com",
  "Gamma":"https://gamma.app"
};

const PLATFORM_GUIDANCE = {
  "ChatGPT":"Structure as ROLE, CONTEXT, OBJECTIVE, REQUIREMENTS, TECHNOLOGY, FEATURES, CONSTRAINTS, IMPLEMENTATION, TESTING, EXPECTED OUTPUT. Favor step-by-step reasoning and explicit debugging/testing instructions.",
  "Claude":"Write a long, structured, detailed brief: full context, explicit requirements, architecture, edge cases, security considerations, and an implementation plan. Claude handles long context and large codebases well, so be thorough rather than terse.",
  "Lovable":"Write it as a direct build instruction for a full-stack app generator: describe pages, components, database schema (Supabase-style), auth, API integrations, responsive UI, and deployment. Tell it to actually build the app, not describe one.",
  "Antigravity":"Focus on repository structure, files, dependencies, implementation sequence, environment variables, and verification/testing steps.",
  "Cursor":"Assume an existing codebase. Reference specific files/functions to modify, describe the refactor or implementation task precisely, and ask for tests.",
  "GitHub Copilot":"Keep it scoped to a single function/class/small unit. Describe inputs, outputs, edge cases, and ask for inline tests.",
  "Gemini":"Frame as a research/reasoning/technical-planning request; ask for structured, well-sourced technical analysis.",
  "Perplexity":"Frame as a research query needing current, sourced information — comparisons, best practices, or up-to-date technical facts.",
  "NotebookLM":"Frame as a source-grounded research/summarization task: what to look for and synthesize across uploaded sources.",
  "v0":"Describe the exact UI component(s) needed: layout, responsiveness, states, and interactions, for React/Tailwind generation.",
  "Replit":"Frame as a build-and-run request: scaffold, install deps, run, and iterate quickly.",
  "Bolt":"Frame as a full-stack rapid-prototype build: UI, backend, and database in one instruction.",
  "Canva AI":"Describe the visual asset needed (poster, social post, deck slide): purpose, audience, key text, and mood.",
  "Gamma":"Describe the presentation needed: audience, number of slides, key sections, and tone — ask for a structured deck outline plus content."
};

const EXAMPLES = [
  "An AI-powered college attendance system",
  "A personal expense tracker with monthly insights",
  "A portfolio site for a freelance photographer",
  "A cybersecurity password-strength checker",
  "A hackathon project: campus lost-and-found app"
];

const store = {
  async listProjects(){
    try{
      const idx = await window.storage.get('promptforge:index', false);
      return idx ? JSON.parse(idx.value) : [];
    }catch(e){ return []; }
  },
  async saveIndex(list){
    try{ await window.storage.set('promptforge:index', JSON.stringify(list), false); }catch(e){}
  },
  async saveProject(p){
    try{ await window.storage.set('promptforge:project:'+p.id, JSON.stringify(p), false); }catch(e){}
  },
  async loadProject(id){
    try{
      const r = await window.storage.get('promptforge:project:'+id, false);
      return r ? JSON.parse(r.value) : null;
    }catch(e){ return null; }
  }
};

async function callClaude(system, userText, maxTokens){
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      model:"claude-sonnet-4-6",
      max_tokens: maxTokens || 1000,
      system: system,
      messages:[{role:"user", content:userText}]
    })
  });
  if(!res.ok) throw new Error("API error "+res.status);
  const data = await res.json();
  const text = (data.content||[]).map(b=>b.text||"").join("\n");
  return text;
}

function stripFence(t){
  return t.replace(/```json/gi,"```").split("```").join("").trim();
}

async function analyzeIdea(idea, context){
  const system = `You are a senior software architect and AI-tool strategist. Analyze the user's project idea and output ONLY valid JSON — no markdown fences, no preamble, no trailing commentary. Match exactly this schema:
{"projectName": string, "tagline": string (max 10 words), "category": string, "summary": string (2-3 sentences), "phases": [{"id": string (short slug), "name": string, "tasks": [{"id": string (short slug), "title": string, "description": string (max 18 words), "recommendedTool": string, "alternativeTool": string, "why": string (max 16 words, why the recommended tool fits this task)}]}]}
Rules:
- Choose only phases genuinely relevant to this idea (2 to 6 phases), drawn from: Research, Architecture, UI/UX, Database, Development, Testing, Documentation, Presentation, Deployment. A simple non-technical idea should not get a Database or Deployment phase.
- Each phase has 2 to 4 tasks.
- recommendedTool and alternativeTool must each be exactly one of: ${TOOLS.join(", ")}.
- Do not use superlatives like "best" or "guaranteed" in any text field.
- Keep every string field genuinely concise.`;
  const userText = `Project idea: ${idea}${context ? `\nAdditional context: ${context}` : ""}`;
  const raw = await callClaude(system, userText, 1000);
  const parsed = JSON.parse(stripFence(raw));
  return parsed;
}

async function generateTaskPrompt(project, task, tool){
  const guidance = PLATFORM_GUIDANCE[tool] || "Write a clear, well-structured prompt.";
  const system = `You are a prompt-engineering specialist. Write ONE ready-to-copy prompt for the AI platform "${tool}", to accomplish the given task within the given project. Output ONLY the prompt text itself — no preamble, no markdown fences, no explanation before or after.
Platform-specific guidance for ${tool}: ${guidance}
The prompt should be self-contained (someone could paste it into ${tool} with no extra context) and directly actionable.`;
  const userText = `Project: ${project.projectName} — ${project.summary}\nTask: ${task.title}\nTask description: ${task.description}`;
  const raw = await callClaude(system, userText, 1000);
  return raw.trim();
}

/* ---------------- App state & render ---------------- */
const state = {
  view:"hero", // hero | loading | workspace
  idea:"", context:"",
  project:null,
  activePhaseIdx:0,
  error:null,
  savedIndex:[],
  drawer:null, // {task, tool}
  drawerLoading:false,
  drawerText:""
};

const root = document.getElementById('root');

function el(html){
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function completedCount(phase){
  return phase.tasks.filter(t=>state.project.taskStatus[t.id]).length;
}
function totalTasks(project){
  return project.phases.reduce((n,p)=>n+p.tasks.length,0);
}
function totalDone(project){
  return Object.values(project.taskStatus).filter(Boolean).length;
}

function render(){
  root.innerHTML = "";
  root.appendChild(el(`<div class="grid-bg"></div>`));
  root.appendChild(renderHeader());

  const main = el(`<main></main>`);
  if(state.view === "hero") main.appendChild(renderHero());
  else if(state.view === "loading") main.appendChild(renderLoading());
  else if(state.view === "workspace") main.appendChild(renderWorkspace());
  root.appendChild(main);

  root.appendChild(el(`<footer>Prompts are generated live for each task and tool — nothing here is prewritten.</footer>`));

  if(state.drawer) root.appendChild(renderDrawer());
}

function renderHeader(){
  const h = el(`
    <header>
      <div class="wordmark">
        <span class="mark">PROMPT<span>FORGE</span></span>
        <span class="sub">AI Project Orchestrator</span>
      </div>
      <div class="header-actions"></div>
    </header>`);
  const actions = h.querySelector('.header-actions');
  if(state.savedIndex.length){
    const sel = el(`<select class="btn"><option value="">Saved projects (${state.savedIndex.length})</option></select>`);
    state.savedIndex.slice().reverse().forEach(p=>{
      sel.appendChild(el(`<option value="${p.id}">${escapeHtml(p.name)}</option>`));
    });
    sel.addEventListener('change', async (e)=>{
      if(!e.target.value) return;
      const p = await store.loadProject(e.target.value);
      if(p){ state.project = p; state.activePhaseIdx = 0; state.view = "workspace"; render(); }
    });
    actions.appendChild(sel);
  }
  if(state.view !== "hero"){
    const btn = el(`<button class="btn">New idea</button>`);
    btn.addEventListener('click', ()=>{ state.view="hero"; state.project=null; state.error=null; render(); });
    actions.appendChild(btn);
  }
  return h;
}

function renderHero(){
  const wrap = el(`
    <section class="hero">
      <div class="eyebrow">One idea → the right AI, in order</div>
      <h1>Describe what you want to build.<br>We'll tell you <em>which AI</em>, what to ask it, and what's next.</h1>
      <p class="lede">PromptForge breaks your idea into phases, matches each task to the AI tool it actually suits, and writes the platform-specific prompt for you — live.</p>
      <div class="idea-box">
        <textarea id="idea-input" rows="2" placeholder="e.g. An AI-powered college attendance management system"></textarea>
        <input id="context-input" class="context" placeholder="Optional — tech stack, deadline, experience level..." />
        <div class="row">
          <span class="count" id="char-count">0 / 400</span>
          <button class="btn primary" id="generate-btn">Forge workflow →</button>
        </div>
      </div>
      <div class="chips">${EXAMPLES.map(x=>`<span class="chip" data-idea="${escapeHtml(x)}">${escapeHtml(x)}</span>`).join("")}</div>
      ${state.error ? `<div class="err">${escapeHtml(state.error)}</div>` : ""}
    </section>
  `);
  const ta = wrap.querySelector('#idea-input');
  ta.value = state.idea;
  const ctx = wrap.querySelector('#context-input');
  ctx.value = state.context;
  const count = wrap.querySelector('#char-count');
  const updateCount = ()=> count.textContent = `${ta.value.length} / 400`;
  updateCount();
  ta.addEventListener('input', ()=>{ state.idea = ta.value.slice(0,400); if(ta.value.length>400) ta.value=state.idea; updateCount(); });
  ctx.addEventListener('input', ()=>{ state.context = ctx.value; });
  wrap.querySelectorAll('.chip').forEach(c=>{
    c.addEventListener('click', ()=>{ ta.value = c.dataset.idea; state.idea = c.dataset.idea; updateCount(); ta.focus(); });
  });
  wrap.querySelector('#generate-btn').addEventListener('click', onGenerate);
  return wrap;
}

async function onGenerate(){
  if(!state.idea.trim()){
    state.error = "Describe your idea first — a sentence or two is enough.";
    render();
    return;
  }
  state.error = null;
  state.view = "loading";
  render();
  try{
    const analysis = await analyzeIdea(state.idea.trim(), state.context.trim());
    const project = {
      id: 'p_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
      idea: state.idea.trim(),
      createdAt: new Date().toISOString(),
      ...analysis,
      taskStatus: {},
      promptCache: {}
    };
    state.project = project;
    state.activePhaseIdx = 0;
    state.view = "workspace";
    await persistProject();
    render();
  }catch(err){
    state.view = "hero";
    state.error = "Couldn't analyze that idea — the AI request failed. Try again.";
    render();
  }
}

async function persistProject(){
  await store.saveProject(state.project);
  const idx = state.savedIndex.filter(p=>p.id !== state.project.id);
  idx.push({id: state.project.id, name: state.project.projectName});
  state.savedIndex = idx;
  await store.saveIndex(idx);
}

function renderLoading(){
  return el(`
    <section class="loading">
      <div class="rule"></div>
      <p>Analyzing the idea, sequencing phases, matching tools…</p>
    </section>
  `);
}

function renderWorkspace(){
  const project = state.project;
  const wrap = el(`<section class="workspace"></section>`);

  const head = el(`
    <div class="proj-head">
      <span class="cat">${escapeHtml(project.category||"Project")}</span>
      <h2>${escapeHtml(project.projectName)}</h2>
      <p>${escapeHtml(project.summary)}</p>
    </div>
  `);
  wrap.appendChild(head);

  // spine
  const spineWrap = el(`<div class="spine-wrap"><div class="spine"></div></div>`);
  const spine = spineWrap.querySelector('.spine');
  project.phases.forEach((phase, i)=>{
    const done = completedCount(phase);
    const total = phase.tasks.length;
    const isComplete = done === total && total>0;
    const isActive = i === state.activePhaseIdx;
    const cell = el(`<div class="node-cell"></div>`);
    const btn = el(`
      <button class="node-btn ${isActive?'active':''} ${isComplete?'complete':''}">
        <div class="node-dot">${isComplete?'✓':i+1}</div>
        <div class="node-label">${escapeHtml(phase.name)}</div>
        <div class="node-sub">${done}/${total}</div>
      </button>
    `);
    btn.addEventListener('click', ()=>{ state.activePhaseIdx = i; render(); });
    cell.appendChild(btn);
    spine.appendChild(cell);
    if(i < project.phases.length-1){
      const conn = el(`<div class="node-connector ${isComplete?'done':''}"></div>`);
      spine.appendChild(conn);
    }
  });
  wrap.appendChild(spineWrap);

  // active phase panel
  const phase = project.phases[state.activePhaseIdx];
  const panel = el(`
    <div class="phase-panel">
      <h3>${escapeHtml(phase.name)}</h3>
      <div class="phase-progress">${completedCount(phase)} of ${phase.tasks.length} tasks complete · ${totalDone(project)}/${totalTasks(project)} overall</div>
    </div>
  `);
  phase.tasks.forEach(task=>{
    const isDone = !!project.taskStatus[task.id];
    const t = el(`
      <div class="task">
        <div class="task-top">
          <button class="task-check ${isDone?'on':''}" aria-label="Mark task complete"></button>
          <div class="task-body">
            <div class="task-title ${isDone?'done':''}">${escapeHtml(task.title)}</div>
            <div class="task-desc">${escapeHtml(task.description)}</div>
            <div class="task-meta">
              <span class="tool-badge rec">${escapeHtml(task.recommendedTool)} · view prompt</span>
              <span class="tool-badge alt">${escapeHtml(task.alternativeTool)} · alt</span>
              <span class="why">${escapeHtml(task.why)}</span>
            </div>
          </div>
        </div>
      </div>
    `);
    t.querySelector('.task-check').addEventListener('click', async ()=>{
      project.taskStatus[task.id] = !project.taskStatus[task.id];
      await persistProject();
      render();
    });
    t.querySelector('.tool-badge.rec').addEventListener('click', ()=> openDrawer(task, task.recommendedTool));
    t.querySelector('.tool-badge.alt').addEventListener('click', ()=> openDrawer(task, task.alternativeTool));
    panel.appendChild(t);
  });
  wrap.appendChild(panel);
  wrap.appendChild(el(`<div class="empty-note">Mark tasks complete as you finish them in each tool — progress is saved automatically.</div>`));

  return wrap;
}

async function openDrawer(task, tool){
  state.drawer = {task, tool};
  state.drawerLoading = true;
  state.drawerText = "";
  render();
  const cacheKey = task.id+'::'+tool;
  if(state.project.promptCache[cacheKey]){
    state.drawerText = state.project.promptCache[cacheKey];
    state.drawerLoading = false;
    render();
    return;
  }
  try{
    const text = await generateTaskPrompt(state.project, task, tool);
    state.project.promptCache[cacheKey] = text;
    await persistProject();
    state.drawerText = text;
  }catch(e){
    state.drawerText = "";
    state.drawerError = "Couldn't generate this prompt — try again.";
  }
  state.drawerLoading = false;
  render();
}

function renderDrawer(){
  const {task, tool} = state.drawer;
  const backdrop = el(`<div class="drawer-backdrop"></div>`);
  backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop){ state.drawer=null; render(); } });
  const drawer = el(`
    <div class="drawer">
      <div class="drawer-head">
        <div>
          <h4>${escapeHtml(tool)}</h4>
          <div class="task-title-sm">${escapeHtml(task.title)}</div>
        </div>
        <button class="drawer-close" aria-label="Close">×</button>
      </div>
      <div class="drawer-body">
        <div class="drawer-why">${escapeHtml(task.why)}</div>
        ${state.drawerLoading
          ? `<div class="drawer-loading">Writing a ${escapeHtml(tool)}-optimized prompt…</div>`
          : (state.drawerText
              ? `<div class="prompt-block">${escapeHtml(state.drawerText)}</div>`
              : `<div class="drawer-loading">${escapeHtml(state.drawerError||"No prompt yet.")}</div>`)
        }
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="copy-btn" ${state.drawerLoading || !state.drawerText ? "disabled":""}>Copy prompt</button>
        <a class="btn" href="${TOOL_URLS[tool]||'#'}" target="_blank" rel="noopener">Open ${escapeHtml(tool)} ↗</a>
      </div>
    </div>
  `);
  drawer.querySelector('.drawer-close').addEventListener('click', ()=>{ state.drawer=null; render(); });
  const copyBtn = drawer.querySelector('#copy-btn');
  if(copyBtn) copyBtn.addEventListener('click', ()=>{
    navigator.clipboard.writeText(state.drawerText).then(()=>{
      copyBtn.textContent = "Copied";
      setTimeout(()=>{ copyBtn.textContent = "Copy prompt"; }, 1400);
    });
  });
  backdrop.appendChild(drawer);
  return backdrop;
}

function escapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

(async function init(){
  state.savedIndex = await store.listProjects();
  render();
})();
