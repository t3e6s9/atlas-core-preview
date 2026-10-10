const $ = (id) => document.getElementById(id);

const graph = window.ATLAS_DATA;
if(!graph) throw new Error('ATLAS_DATA missing: run python build_data.py');
const runtime = graph.runtime;
if(!runtime || !Array.isArray(runtime.pages) || !runtime.pages.length) throw new Error('ATLAS runtime page manifest missing');
const pageList = runtime.pages.slice();
const pageNumbers = pageList.map(p=>Number(p.number));
if(pageNumbers.some(n=>!Number.isFinite(n))) throw new Error('ATLAS runtime page numbers must be numeric');
const pageIndexByNumber = new Map(pageNumbers.map((n,i)=>[n,i]));
if(pageIndexByNumber.size!==pageNumbers.length) throw new Error('ATLAS runtime page numbers must be unique');
const pages = Object.fromEntries(pageList.map(p=>[Number(p.number),p]));
const defaultPage = pageIndexByNumber.has(Number(runtime.default_page)) ? Number(runtime.default_page) : pageNumbers[0];

const sourceAtomsById = Object.fromEntries(graph.source_atoms.map(a=>[a.id,a]));
const connectionsById = Object.fromEntries(graph.connections.map(c=>[c.id,c]));
const roleRank = {context:1,bridge:2,direct:3};
function dominantRole(edges=[]){
  return edges.reduce((best,e)=>(roleRank[e.role]||0)>(roleRank[best]||0)?e.role:best,'context');
}
const questions = graph.connections.map(c=>{
  const role=dominantRole(c.edges);
  return {
    id:c.id,...c.question,
    support:c.display_label,
    traceLevel:role==='context'?'related':role,
    traceNote:c.trace_summary,
    gives:c.review.gives,
    missing:c.review.missing,
    graph:c
  };
});

const progressKey='atlas-core-progress-v1';
function loadProgress(){
  try{
    const saved=JSON.parse(localStorage.getItem(progressKey)||'{}');
    const attempts={};
    questions.forEach(q=>{
      const a=saved.attempts?.[q.id]; if(!a||typeof a!=='object') return;
      const clean={done:!!a.done,choice:null,text:''};
      if(q.type==='prelims' && (q.options||[]).some(([key])=>key===a.choice)) clean.choice=a.choice;
      if(q.type!=='prelims' && typeof a.text==='string') clean.text=a.text.slice(0,30000);
      attempts[q.id]=clean;
    });
    return {page:pageIndexByNumber.has(Number(saved.page))?Number(saved.page):defaultPage,attempts,lastQuestionId:questions.some(q=>q.id===saved.lastQuestionId)?saved.lastQuestionId:null};
  }catch{return {page:defaultPage,attempts:{},lastQuestionId:null};}
}
const savedProgress=loadProgress();
const state = { page:savedProgress.page, layout:'one', fit:'width', zoom:1, panel:false, explorer:false, q:0, attempts:savedProgress.attempts, highlight:null, pinned:null, lastQuestionId:savedProgress.lastQuestionId };
const readerStage=$('readerStage'), workspace=$('workspace'), panel=$('connectPanel'), card=$('questionCard'), reader=$('reader');
const explorePanel=$('explorePanel'), questionList=$('questionList'), questionSearch=$('questionSearch');
function currentQuestions(){ return questions.filter(q=>Number(q.page)===state.page); }
function pinnedQuestion(){ return state.pinned ? questions.find(q=>q.id===state.pinned)||null : null; }
function panelQuestions(){ const q=pinnedQuestion(); return q?[q]:currentQuestions(); }
function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),1800); }
function persistProgress(){ try{ localStorage.setItem(progressKey,JSON.stringify({page:state.page,attempts:state.attempts,lastQuestionId:state.lastQuestionId})); }catch{} }
function questionSearchText(q){ return [q.year,q.kind,q.number,q.page,q.support,q.prompt,q.stem,...(q.statements||[])].filter(Boolean).join(' ').toLowerCase(); }
function questionPreview(q){ return q.prompt||q.stem||(q.statements||[]).join(' '); }
function normalizePage(value){
  const n=Number(value);
  if(pageIndexByNumber.has(n)) return n;
  if(!Number.isFinite(n)) return defaultPage;
  return pageNumbers.reduce((best,p)=>Math.abs(p-n)<Math.abs(best-n)?p:best,pageNumbers[0]);
}
function neighborPage(page,dir){
  const i=pageIndexByNumber.get(page);
  const next=i==null?null:i+dir;
  return next!=null && next>=0 && next<pageNumbers.length ? pageNumbers[next] : null;
}
function sourceRangeLabel(){
  if(pageNumbers.length===1) return `p. ${pageNumbers[0]}`;
  const consecutive=pageNumbers.every((n,i)=>i===0 || n===pageNumbers[i-1]+1);
  return consecutive ? `pp. ${pageNumbers[0]}–${pageNumbers[pageNumbers.length-1]}` : `${pageNumbers.length} exact pages`;
}
function applyRuntimeIdentity(){
  const identity=$('sourceIdentity'); if(identity) identity.textContent=runtime.identity||runtime.book||'Exact source';
  const range=$('sourceRange'); if(range) range.textContent=`${pageNumbers.length} exact pages · ${sourceRangeLabel()}`;
  reader.setAttribute('aria-label',`${runtime.book||'Exact source'} reader`);
  const theme=runtime.theme||{};
  const root=document.documentElement;
  if(theme.navy) root.style.setProperty('--ncert-navy',theme.navy);
  if(theme.blue) root.style.setProperty('--ncert-blue',theme.blue);
  if(theme.sky) root.style.setProperty('--ncert-sky',theme.sky);
  if(theme.mist) root.style.setProperty('--ncert-mist',theme.mist);
}

function makePageShell(pageNo){
  const p=pages[pageNo];
  if(!p) return null;
  const shell=document.createElement('div'); shell.className='page-shell'; shell.dataset.page=pageNo;
  const img=document.createElement('img'); img.src=p.src; img.alt=`Exact NCERT printed page ${pageNo}`; img.draggable=false;
  const layer=document.createElement('div'); layer.className='evidence-layer'; layer.dataset.page=pageNo;
  shell.setAttribute('aria-label',p.label);
  shell.append(img,layer);
  return shell;
}

function renderReader(){
  readerStage.innerHTML=''; readerStage.className=`reader-stage ${state.layout==='two'?'two':''} fit-${state.fit}`;
  workspace.classList.toggle('two-page',state.layout==='two');
  if(state.layout==='two') setTimeout(()=>wakeSpreadControls(1400),0); else workspace.classList.remove('controls-awake');
  readerStage.style.setProperty('--zoom',state.zoom);
  const i=pageIndexByNumber.get(state.page);
  const visible=[state.page];
  if(state.layout==='two' && pageNumbers.length>1){
    if(i<pageNumbers.length-1) visible.push(pageNumbers[i+1]);
    else visible.unshift(pageNumbers[i-1]);
  }
  visible.forEach(n=>{ const shell=makePageShell(n); if(shell) readerStage.append(shell); });
  syncReaderGeometry();
  $('pageInput').value=state.page;
  const pinned=pinnedQuestion();
  $('panelPage').textContent=pinned && Number(pinned.page)!==state.page ? `${pinned.page} · evidence ${state.page}` : (pinned?.page??state.page);
  $('connectBadge').textContent=currentQuestions().length;
  $('prevPage').disabled=i<=0; $('nextPage').disabled=i>=pageNumbers.length-1;
  renderEvidence(); renderQuestion(); updateLayoutUI();
}
function renderEvidence(){
  document.querySelectorAll('.evidence-layer').forEach(layer=>{ layer.innerHTML=''; layer.classList.toggle('on',!!state.highlight); });
  if(!state.highlight) return;
  const conn=connectionsById[state.highlight]; if(!conn) return;
  const atomRoles=new Map();
  conn.edges.forEach(edge=>{
    const prev=atomRoles.get(edge.source_atom);
    if(!prev || (roleRank[edge.role]||0)>(roleRank[prev]||0)) atomRoles.set(edge.source_atom,edge.role);
  });
  atomRoles.forEach((role,atomId)=>{
    const atom=sourceAtomsById[atomId]; if(!atom) return;
    const layer=document.querySelector(`.evidence-layer[data-page="${atom.page}"]`); if(!layer) return;
    atom.regions.forEach(r=>{
      const visualRole=role==='context'?'related':role;
      const mark=document.createElement('span'); mark.className=`evidence-mark active ${visualRole}`;
      mark.dataset.sourceAtom=atomId; mark.dataset.role=role;
      mark.style.left=`${r[0]*100}%`; mark.style.top=`${r[1]*100}%`; mark.style.width=`${r[2]*100}%`; mark.style.height=`${Math.max(r[3]*100,1.15)}%`;
      layer.append(mark);
    });
  });
}

function setPage(page){
  state.page=normalizePage(page); state.q=0; state.highlight=null; state.pinned=null;
  renderReader(); syncMobileSourceFocus(); $('reader').scrollTo({top:0,left:0,behavior:'instant'}); persistProgress();
}

function syncMobileSourceFocus(){
  workspace.classList.toggle('mobile-source-focus',state.panel && !!state.highlight && window.matchMedia('(max-width:700px)').matches);
}

function setPanel(open){
  if(open && state.explorer) setExplorer(false);
  state.panel=open; panel.classList.toggle('open',open); panel.setAttribute('aria-hidden',String(!open));
  workspace.classList.toggle('panel-open',open);
  document.querySelector('[data-action="connect"]').classList.toggle('active',open);
  if(!open && state.pinned){ state.pinned=null; state.highlight=null; state.q=0; renderEvidence(); renderQuestion(); }
  if(open) renderQuestion();
  if(open && state.layout==='two') wakeSpreadControls(3000);
  syncMobileSourceFocus();
}

function setExplorer(open){
  if(open && state.panel) setPanel(false);
  state.explorer=open; explorePanel.classList.toggle('open',open); explorePanel.setAttribute('aria-hidden',String(!open));
  workspace.classList.toggle('explore-open',open);
  document.querySelector('[data-action="explore"]').classList.toggle('active',open);
  if(open){ renderQuestionIndex(); requestAnimationFrame(()=>questionSearch.focus({preventScroll:true})); }
}
function renderQuestionIndex(){
  const query=(questionSearch.value||'').trim().toLowerCase();
  const doneCount=questions.filter(q=>answerState(q).done).length;
  $('progressSummary').textContent=`${doneCount} attempted · ${questions.length-doneCount} remaining · ${questions.length} audited`;
  $('exploreBadge').textContent=questions.length;
  const resume=$('resumeQuestion'), last=questions.find(q=>q.id===state.lastQuestionId);
  resume.hidden=!last;
  if(last){ resume.dataset.questionId=last.id; resume.textContent=`Resume ${last.year} Q${last.number} · p. ${last.page}`; }
  const matches=questions.filter(q=>!query||questionSearchText(q).includes(query)).sort((a,b)=>Number(b.year)-Number(a.year)||Number(a.page)-Number(b.page)||String(a.number).localeCompare(String(b.number)));
  if(!matches.length){ questionList.innerHTML='<div class="explore-empty"><strong>No audited question matches.</strong><span>Try a topic, year, question number, or page.</span></div>'; return; }
  questionList.innerHTML=matches.map(q=>{
    const done=answerState(q).done;
    return `<button class="question-index-item" data-open-question="${escapeHtml(q.id)}"><div class="question-index-meta"><span>${escapeHtml(q.year)} · ${escapeHtml(q.kind)}</span><span>p. ${escapeHtml(q.page)}</span></div><strong>${escapeHtml(questionPreview(q))}</strong><div class="question-index-foot"><span>${escapeHtml(q.support)}</span><span class="${done?'done':'pending'}">${done?'Attempted':'Not attempted'}</span></div></button>`;
  }).join('');
}
function openQuestionById(id){
  const q=questions.find(item=>item.id===id); if(!q) return;
  state.page=Number(q.page); state.highlight=null; state.pinned=null; state.q=0; state.lastQuestionId=q.id;
  renderReader();
  const onPage=currentQuestions(); state.q=Math.max(0,onPage.findIndex(item=>item.id===q.id));
  setExplorer(false); setPanel(true); renderQuestion(); reader.scrollTo({top:0,left:0,behavior:'instant'}); persistProgress();
}
function answerState(q){ return state.attempts[q.id] || {done:false,choice:null,text:''}; }
function escapeHtml(s=''){ return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function renderQuestion(){
  const qs=panelQuestions();
  if(!qs.length){
    $('questionCount').textContent='0 questions'; $('dots').innerHTML='';
    card.innerHTML='<div class="empty-state"><strong>No audited PYQ on this page yet.</strong><span>Reading still works normally. Connections appear only when evidence is verified.</span></div>';
    $('qPrev').disabled=$('qNext').disabled=true; syncMobileSourceFocus(); return;
  }
  state.q=(state.q+qs.length)%qs.length; const q=qs[state.q], a=answerState(q);
  $('qPrev').disabled=$('qNext').disabled=qs.length<2;
  $('questionCount').textContent=`${state.q+1} of ${qs.length}`;
  $('dots').innerHTML=qs.map((_,i)=>`<button class="dot ${i===state.q?'active':''}" data-i="${i}" aria-label="Question ${i+1}"></button>`).join('');
  const meta=`<div class="q-meta"><span class="pill year">${escapeHtml(q.year)}</span><span class="pill">${escapeHtml(q.kind)}</span>${q.meta?`<span class="pill">${escapeHtml(q.meta)}</span>`:''}<span class="pill support">${escapeHtml(q.support)}</span></div>`;
  card.innerHTML=meta+questionMarkup(q)+(state.highlight===q.id?traceMarkup(q):'')+attemptMarkup(q,a)+(a.done?reviewMarkup(q,a):'');
  bindQuestionEvents(q,a);
  updateEvidenceControl(); syncMobileSourceFocus();
}

function questionMarkup(q){
  if(q.type==='prelims'){
    const statements=(q.statements||[]);
    const statementMarkup=statements.length?`<ol class="statement-list">${statements.map((x,i)=>`<li><span>${i+1}.</span><p>${escapeHtml(x)}</p></li>`).join('')}</ol>`:'';
    const promptMarkup=q.prompt?`<p class="question-prompt">${escapeHtml(q.prompt)}</p>`:'';
    return `<section class="native-question prelims-question"><div class="paper-kicker">UPSC Civil Services (Preliminary) Examination · ${escapeHtml(q.year)}</div><div class="question-number">${escapeHtml(q.number)}.</div><div class="question-body"><p class="stem">${escapeHtml(q.stem)}</p>${statementMarkup}${promptMarkup}</div></section>`;
  }
  return `<section class="native-question mains-question"><div class="paper-kicker">UPSC Civil Services (Main) Examination · ${escapeHtml(q.year)} · General Studies Paper I</div><div class="mains-line"><span class="question-number">${escapeHtml(q.number)}.</span><p>${escapeHtml(q.prompt)}</p><span class="marks">${escapeHtml(q.marks||'')}</span></div><div class="directive">(${escapeHtml(q.directive||'')})</div></section>`;
}

function traceMarkup(q){
  const seen=new Set();
  const chips=[];
  const evidencePages=[];
  (q.graph?.edges||[]).forEach(edge=>{
    const atom=sourceAtomsById[edge.source_atom]; if(!atom) return;
    if(!evidencePages.includes(Number(atom.page))) evidencePages.push(Number(atom.page));
    const role=edge.role==='context'?'Related':edge.role[0].toUpperCase()+edge.role.slice(1);
    const kind=(atom.kind||'source');
    const key=`${kind}:${role}`; if(seen.has(key)) return; seen.add(key);
    chips.push(`<span class="trace-source-chip ${escapeHtml(edge.role)}">${escapeHtml(kind[0].toUpperCase()+kind.slice(1))} · ${escapeHtml(role)}</span>`);
  });
  evidencePages.sort((a,b)=>(pageIndexByNumber.get(a)??9999)-(pageIndexByNumber.get(b)??9999));
  const pageChips=evidencePages.map(p=>`<button class="trace-page-chip ${p===state.page?'active':''}" data-evidence-page="${p}">p. ${p}</button>`).join('');
  return `<div class="trace-note ${q.traceLevel||'direct'}"><strong>Source trace</strong><div><span>${escapeHtml(q.traceNote||'')}</span>${chips.length?`<div class="trace-source-kinds">${chips.join('')}</div>`:''}${evidencePages.length>1?`<div class="trace-pages"><span>Evidence pages</span>${pageChips}</div>`:''}</div></div>`;
}

function attemptMarkup(q,a){
  if(q.type==='prelims'){
    const buttons=q.options.map(([key,label])=>`<button class="option-row ${a.choice===key?'selected':''}" data-choice="${escapeHtml(key)}" ${a.done?'disabled':''}><span class="option-key">${escapeHtml(key)}</span><span>${escapeHtml(label)}</span></button>`).join('');
    return `<section class="attempt prelims-attempt"><div class="attempt-label">Select your answer</div><div class="option-list">${buttons}</div><button class="primary-btn" id="finishAttempt" ${!a.choice||a.done?'disabled':''}>${a.done?'Attempt finished':'Finish attempt'}</button></section>`;
  }
  const wc=(a.text.trim().match(/\S+/g)||[]).length;
  return `<section class="attempt"><div class="attempt-label">Write your answer</div><textarea class="answer-box" id="mainsAnswer" placeholder="Answer here…" ${a.done?'disabled':''}>${escapeHtml(a.text)}</textarea><div class="word-row"><span>${escapeHtml(q.meta)}</span><span id="wordCount">${wc} words</span></div><button class="primary-btn" id="finishAttempt" ${!a.text.trim()||a.done?'disabled':''}>${a.done?'Attempt finished':'Finish attempt'}</button></section>`;
}
function reviewMarkup(q,a){
  const verdict=q.type==='prelims' ? `<strong>${a.choice===q.correct?'Correct':'Incorrect'} · official answer ${q.correct}</strong>` : '<strong>Attempt captured</strong>';
  return `<section class="review"><div class="result-line">${verdict}<span class="status-tag">${escapeHtml(q.support)}</span></div><div class="mapping-card"><h3>What this source page gives</h3><p>${escapeHtml(q.gives)}</p></div><div class="mapping-card"><h3>What is still required</h3><p>${escapeHtml(q.missing)}</p></div><div class="mapping-actions"><button class="secondary-btn" id="returnSource">Return to page</button></div><details class="proof"><summary>Source proof</summary><p>${escapeHtml(q.proof)}</p></details></section>`;
}

function bindQuestionEvents(q,a){
  document.querySelectorAll('[data-choice]').forEach(btn=>btn.onclick=()=>{
    if(a.done) return; a.choice=btn.dataset.choice; state.attempts[q.id]=a; state.lastQuestionId=q.id; persistProgress(); renderQuestion();
  });
  const ta=$('mainsAnswer'); if(ta) ta.oninput=()=>{
    a.text=ta.value; state.attempts[q.id]=a; state.lastQuestionId=q.id; persistProgress(); $('wordCount').textContent=`${(a.text.trim().match(/\S+/g)||[]).length} words`; $('finishAttempt').disabled=!a.text.trim();
  };
  const finish=$('finishAttempt'); if(finish) finish.onclick=()=>{ a.done=true; state.attempts[q.id]=a; state.lastQuestionId=q.id; persistProgress(); renderQuestion(); toast('Attempt finished'); };
  const ret=$('returnSource'); if(ret) ret.onclick=()=>{ setPanel(false); document.querySelector(`.page-shell[data-page="${q.page}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}); };
  document.querySelectorAll('.dot').forEach(d=>d.onclick=()=>{state.q=Number(d.dataset.i); renderQuestion();});
  document.querySelectorAll('[data-evidence-page]').forEach(b=>b.onclick=()=>jumpToEvidencePage(q,Number(b.dataset.evidencePage)));
}
function moveQuestion(dir){
  const qs=panelQuestions(); if(qs.length<2) return;
  state.q=(state.q+dir+qs.length)%qs.length; state.highlight=null; renderEvidence();
  card.style.opacity='.35'; card.style.transform=`translateX(${dir>0?'-22px':'22px'})`;
  setTimeout(()=>{ renderQuestion(); card.style.transform=`translateX(${dir>0?'18px':'-18px'})`; requestAnimationFrame(()=>{ card.style.opacity='1'; card.style.transform='translateX(0)'; }); },110);
}

$('qPrev').onclick=()=>moveQuestion(-1); $('qNext').onclick=()=>moveQuestion(1);
$('panelClose').onclick=()=>setPanel(false);
$('exploreClose').onclick=()=>setExplorer(false);
document.querySelector('[data-action="connect"]').onclick=()=>setPanel(!state.panel);
document.querySelector('[data-action="explore"]').onclick=()=>setExplorer(!state.explorer);
questionSearch.oninput=()=>renderQuestionIndex();
questionList.onclick=e=>{ const item=e.target.closest('[data-open-question]'); if(item) openQuestionById(item.dataset.openQuestion); };
$('resumeQuestion').onclick=e=>{ const id=e.currentTarget.dataset.questionId; if(id) openQuestionById(id); };
$('prevPage').onclick=()=>{const n=neighborPage(state.page,-1); if(n!=null) setPage(n);}; $('nextPage').onclick=()=>{const n=neighborPage(state.page,1); if(n!=null) setPage(n);};
$('pageInput').onchange=e=>setPage(e.target.value);

function updateLayoutUI(){
  document.querySelectorAll('[data-layout]').forEach(b=>b.classList.toggle('selected',b.dataset.layout===state.layout));
  document.querySelectorAll('[data-fit]').forEach(b=>b.classList.toggle('selected',b.dataset.fit===state.fit));
  $('zoomLabel').textContent=`${Math.round(state.zoom*100)}%`;
  syncMobileReadZoom();
}

function syncMobileReadZoom(){
  const btn=$('mobileReadZoom'); if(!btn) return;
  const enlarged=state.zoom>=1.7;
  btn.setAttribute('aria-pressed',String(enlarged));
  btn.setAttribute('aria-label',enlarged?'Fit the full page':'Enlarge page to read a column');
  btn.title=enlarged?'Fit the full page':'Enlarge page to read a column';
  btn.querySelector('span').textContent=enlarged?'Aa−':'Aa+';
  reader.classList.toggle('read-zoom-active',enlarged && window.matchMedia('(max-width:700px)').matches);
}

function pageRatio(pageNo){
  const p=pages[Number(pageNo)]||{};
  const ratio=(Number(p.width)||0)/(Number(p.height)||0);
  return Number.isFinite(ratio)&&ratio>0 ? ratio : (Number(runtime.page_ratio)||1383/1841);
}
function syncReaderGeometry(){
  const shells=[...readerStage.querySelectorAll('.page-shell')];
  if(!shells.length) return;
  const gap=18, availW=Math.max(320,reader.clientWidth-56), availH=Math.max(420,reader.clientHeight-56);
  const ratios=shells.map(shell=>pageRatio(shell.dataset.page));
  let dims=[];
  if(shells.length>1){
    if(state.fit==='page'){
      let h=availH;
      const sum=ratios.reduce((a,b)=>a+b,0);
      if(h*sum+gap*(shells.length-1)>availW) h=(availW-gap*(shells.length-1))/sum;
      dims=ratios.map(r=>({w:h*r,h}));
    }else{
      const maxW=Math.max(240,(availW-gap*(shells.length-1))/shells.length);
      const w=Math.min(720,maxW);
      dims=ratios.map(r=>({w,h:w/r}));
    }
  }else{
    const ratio=ratios[0];
    if(state.fit==='page'){
      let h=availH, w=h*ratio;
      if(w>availW){w=availW;h=w/ratio;}
      dims=[{w,h}];
    }else{
      const w=Math.min(860,availW);
      dims=[{w,h:w/ratio}];
    }
  }
  shells.forEach((shell,i)=>{
    shell.style.setProperty('--shell-w',`${Math.round(dims[i].w*state.zoom)}px`);
    shell.style.setProperty('--shell-h',`${Math.round(dims[i].h*state.zoom)}px`);
  });
  $('zoomLabel').textContent=`${Math.round(state.zoom*100)}%`;
}
function setReaderZoom(next,anchor){
  const rect=reader.getBoundingClientRect(), oldW=reader.scrollWidth, oldH=reader.scrollHeight;
  const x=anchor?.clientX!=null?anchor.clientX-rect.left:rect.width/2;
  const y=anchor?.clientY!=null?anchor.clientY-rect.top:rect.height/2;
  const rx=oldW?((reader.scrollLeft+x)/oldW):.5, ry=oldH?((reader.scrollTop+y)/oldH):.5;
  state.zoom=Math.max(.6,Math.min(2.5,next)); syncReaderGeometry(); syncMobileReadZoom();
  requestAnimationFrame(()=>{reader.scrollTo({left:Math.max(0,rx*reader.scrollWidth-x),top:Math.max(0,ry*reader.scrollHeight-y),behavior:'instant'});renderEvidence();});
}

const layoutPop=$('layoutPop'), morePop=$('morePop');
document.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>{state.layout=b.dataset.layout;state.fit=state.layout==='one'?'width':'page';state.zoom=1;renderReader();$('reader').scrollTo({top:0,left:0,behavior:'instant'});layoutPop.hidden=true;});
document.querySelectorAll('[data-fit]').forEach(b=>b.onclick=()=>{state.fit=b.dataset.fit;renderReader();layoutPop.hidden=true;});
$('zoomOut').onclick=()=>setReaderZoom(state.zoom-.1);
$('zoomIn').onclick=()=>setReaderZoom(state.zoom+.1);
$('mobileReadZoom').onclick=()=>{
  const enlarged=state.zoom>=1.7;
  const rect=reader.getBoundingClientRect();
  setReaderZoom(enlarged?1:2.15,{clientX:rect.left+28,clientY:rect.top+110});
  toast(enlarged?'Full page restored':'Column reading · drag to move across the page');
};
document.querySelector('[data-action="layout"]').onclick=()=>{layoutPop.hidden=!layoutPop.hidden;morePop.hidden=true;};
document.querySelector('[data-action="more"]').onclick=()=>{morePop.hidden=!morePop.hidden;layoutPop.hidden=true;};
$('highlightSource').onclick=()=>{ const q=panelQuestions()[state.q]; if(q) toggleQuestionEvidence(q); };

document.addEventListener('click',e=>{
  if(!e.target.closest('.layout-pop')&&!e.target.closest('[data-action="layout"]')) layoutPop.hidden=true;
  if(!e.target.closest('.more-pop')&&!e.target.closest('[data-action="more"]')) morePop.hidden=true;
});

document.addEventListener('keydown',e=>{
  if(e.target.matches('textarea,input')) return;
  if(e.key==='ArrowLeft'&&state.panel){e.preventDefault();moveQuestion(-1);}
  if(e.key==='ArrowRight'&&state.panel){e.preventDefault();moveQuestion(1);}
  if(e.key==='Escape'&&state.panel)setPanel(false);
  else if(e.key==='Escape'&&state.explorer)setExplorer(false);
});

let controlsTimer=null;
const railHotzone=$('railHotzone'), rail=document.querySelector('.rail');
function wakeSpreadControls(ms=1500){
  if(state.layout!=='two') return;
  workspace.classList.add('controls-awake'); clearTimeout(controlsTimer);
  controlsTimer=setTimeout(()=>{
    if(state.layout==='two'&&!state.panel&&!rail.matches(':hover')&&!railHotzone.matches(':hover')) workspace.classList.remove('controls-awake');
  },ms);
}
railHotzone.addEventListener('pointerenter',()=>wakeSpreadControls(2300));
railHotzone.addEventListener('pointerleave',()=>wakeSpreadControls(700));
rail.addEventListener('pointerenter',()=>wakeSpreadControls(2300));
rail.addEventListener('pointerleave',()=>wakeSpreadControls(700));

let readerHovered=false;
reader.addEventListener('pointerenter',()=>readerHovered=true);
reader.addEventListener('pointerleave',()=>readerHovered=false);
reader.addEventListener('wheel',e=>{
  if(!e.ctrlKey && !e.metaKey) return;
  e.preventDefault(); setReaderZoom(state.zoom*(e.deltaY<0?1.09:.92),e);
},{passive:false});
window.addEventListener('keydown',e=>{
  if(!readerHovered || (!e.ctrlKey&&!e.metaKey) || e.target.matches('textarea,input')) return;
  if(!['+','=','-','0'].includes(e.key)) return;
  e.preventDefault(); if(e.key==='0') setReaderZoom(1); else setReaderZoom(state.zoom+(e.key==='-'?-.1:.1));
},{capture:true});

let panState=null;
reader.addEventListener('pointerdown',e=>{
  if(state.zoom<=1.01 || !e.target.closest('.page-shell') || e.button!==0) return;
  panState={x:e.clientX,y:e.clientY,left:reader.scrollLeft,top:reader.scrollTop};
  reader.classList.add('panning'); reader.setPointerCapture?.(e.pointerId); e.preventDefault();
});
reader.addEventListener('pointermove',e=>{
  if(!panState) return;
  reader.scrollLeft=panState.left-(e.clientX-panState.x); reader.scrollTop=panState.top-(e.clientY-panState.y);
});
function endReaderPan(){panState=null;reader.classList.remove('panning');}
reader.addEventListener('pointerup',endReaderPan); reader.addEventListener('pointercancel',endReaderPan);
const readerResizeObserver=new ResizeObserver(()=>{syncReaderGeometry();renderEvidence();});
readerResizeObserver.observe(reader);
window.addEventListener('resize',()=>{syncMobileSourceFocus();syncMobileReadZoom();});

let dragGesture=null;
const viewport=$('carouselViewport');
const interactiveSelector='button,input,textarea,select,a,summary,label,[role="button"]';
viewport.addEventListener('pointerdown',e=>{
  if(e.button!==0 || e.target.closest(interactiveSelector)) return;
  dragGesture={pointerId:e.pointerId,startX:e.clientX,lastX:e.clientX,active:false};
});
viewport.addEventListener('pointermove',e=>{
  if(!dragGesture || e.pointerId!==dragGesture.pointerId) return;
  dragGesture.lastX=e.clientX; const dx=dragGesture.lastX-dragGesture.startX;
  if(!dragGesture.active && Math.abs(dx)<10) return;
  if(!dragGesture.active){dragGesture.active=true;viewport.setPointerCapture?.(e.pointerId);card.classList.add('dragging');}
  e.preventDefault(); card.style.transform=`translateX(${Math.max(-90,Math.min(90,dx))}px)`;card.style.opacity=String(Math.max(.65,1-Math.abs(dx)/300));
});
function endDrag(e){
  if(!dragGesture || (e&&e.pointerId!==dragGesture.pointerId)) return;
  const dx=dragGesture.lastX-dragGesture.startX, active=dragGesture.active;
  dragGesture=null; card.classList.remove('dragging'); card.style.opacity='1'; card.style.transform='translateX(0)';
  if(active && Math.abs(dx)>55) moveQuestion(dx<0?1:-1);
}
viewport.addEventListener('pointerup',endDrag); viewport.addEventListener('pointercancel',endDrag);
let wheelLock=false;
viewport.addEventListener('wheel',e=>{
  if(!state.panel||wheelLock||Math.abs(e.deltaX)<35||Math.abs(e.deltaX)<Math.abs(e.deltaY)) return;
  e.preventDefault(); wheelLock=true; moveQuestion(e.deltaX>0?1:-1); setTimeout(()=>wheelLock=false,420);
},{passive:false});

function updateEvidenceControl(){
  const q=panelQuestions()[state.q], btn=$('highlightSource');
  if(!btn) return;
  const on=!!(q&&state.highlight===q.id);
  btn.classList.remove('locked'); btn.classList.toggle('on',on); btn.disabled=!q;
  btn.title=q?'Toggle the NCERT source trace for this question':'No source trace on this page';
  const mobile=window.matchMedia('(max-width:700px)').matches;
  btn.querySelector('span').textContent=on?(mobile?'Back to question':'Hide source trace'):'Trace source';
  btn.setAttribute('aria-label',on&&mobile?'Back to question':on?'Hide source trace':'Trace source');
}
function focusEvidence(q,pageNo=Number(q.page)){
  requestAnimationFrame(()=>document.querySelector(`.evidence-layer[data-page="${pageNo}"] .evidence-mark.active`)?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'}));
}
function jumpToEvidencePage(q,pageNo){
  if(!pageIndexByNumber.has(pageNo)) return;
  const hasEvidence=(q.graph?.edges||[]).some(edge=>Number(sourceAtomsById[edge.source_atom]?.page)===pageNo);
  if(!hasEvidence) return;
  state.page=pageNo; state.highlight=q.id;
  if(pageNo===Number(q.page)){
    state.pinned=null;
    const native=currentQuestions(); state.q=Math.max(0,native.findIndex(item=>item.id===q.id));
  }else{ state.pinned=q.id; state.q=0; }
  renderReader(); reader.scrollTo({top:0,left:0,behavior:'instant'}); focusEvidence(q,pageNo);
}
function toggleQuestionEvidence(q){
  state.highlight=state.highlight===q.id?null:q.id;
  renderEvidence(); renderQuestion();
  if(state.highlight){
    if(window.matchMedia('(max-width:700px)').matches && state.zoom<1.7){
      const rect=reader.getBoundingClientRect();
      setReaderZoom(2.15,{clientX:rect.left+28,clientY:rect.top+110});
    }
    focusEvidence(q);
  }
}
const baseRenderQuestion=renderQuestion;
renderQuestion=function(){ baseRenderQuestion(); updateEvidenceControl(); };

window.addEventListener('resize',()=>renderEvidence());
applyRuntimeIdentity();
renderReader();
renderQuestionIndex();
setPanel(false);
setExplorer(false);
