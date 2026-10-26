import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const DB_NAME = "recall-study-db";
const DB_VERSION = 1;
const stores = ["materials", "questions", "results"];
const $ = (id) => document.getElementById(id);
const state = {
  view: "home", materials: [], questions: [], results: [], currentMaterial: null,
  exam: null, result: null, questionIndex: 0, timerStart: 0, timerInterval: null,
  revealed: new Set(), submitted: new Set(), selections: {}, currentQuestionIds: [],
  reviewOnly: false
};
let db;

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function dateText(value) {
  try { return new Date(value).toLocaleDateString(undefined, {day:"numeric", month:"short", year:"numeric"}); }
  catch { return ""; }
}
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast._timer); toast._timer = setTimeout(() => el.classList.remove("show"), 3500);
}
function busy(title, message) { $("busyTitle").textContent=title; $("busyMessage").textContent=message; $("busyOverlay").classList.remove("hidden"); }
function unbusy() { $("busyOverlay").classList.add("hidden"); }
function openDb() {
  return new Promise((resolve,reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains("materials")) database.createObjectStore("materials",{keyPath:"id"});
      if (!database.objectStoreNames.contains("questions")) { const s=database.createObjectStore("questions",{keyPath:"id"}); s.createIndex("materialId","materialId",{unique:false}); }
      if (!database.objectStoreNames.contains("results")) { const s=database.createObjectStore("results",{keyPath:"id"}); s.createIndex("date","date",{unique:false}); }
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function dbGetAll(store) { return new Promise((resolve,reject)=>{const req=db.transaction(store,"readonly").objectStore(store).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);}); }
function dbPut(store,value) { return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);}); }
function dbDelete(store,id) { return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); }
function dbClear(store) { return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); }
async function refreshData() {
  [state.materials,state.questions,state.results]=await Promise.all(stores.map(dbGetAll));
  state.materials.sort((a,b)=>b.createdAt-a.createdAt);
  state.results.sort((a,b)=>b.date-a.date);
  renderHome(); renderLibrary(); renderHistory(); updateStorageEstimate();
}
function navigate(view) {
  state.view=view;
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  const target=$(`view-${view}`); if(target) target.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  window.scrollTo({top:0,behavior:"smooth"});
  if(view==="home") renderHome();
  if(view==="library") renderLibrary();
  if(view==="history") renderHistory();
}
function fileKind(type) { return type==="pdf"?"PDF":type==="docx"?"DOCX":type.toUpperCase(); }
function questionCountFor(materialId) { return state.questions.filter(q=>q.materialId===materialId).length; }
function renderHome() {
  $("statMaterials").textContent=state.materials.length;
  $("statExams").textContent=state.results.length;
  const avg=state.results.length?Math.round(state.results.reduce((s,r)=>s+r.score,0)/state.results.length):null;
  $("statAverage").textContent=avg===null?"—":`${avg}%`;
  const recent=state.materials.slice(0,3);
  $("recentMaterials").innerHTML=recent.map(materialCard).join("");
  $("homeEmpty").classList.toggle("hidden",state.materials.length>0);
  $("recentMaterials").classList.toggle("hidden",state.materials.length===0);
  bindMaterialCards();
}
function materialCard(m) {
  const qcount=questionCountFor(m.id);
  return `<article class="material-card"><div class="material-card-top"><span class="file-icon">▤</span><button class="more-button" data-delete-material="${escapeHtml(m.id)}" aria-label="Delete material">⋯</button></div><h3>${escapeHtml(m.title)}</h3><p>${fileKind(m.type)} · ${m.wordCount.toLocaleString()} words</p><div class="material-card-footer"><span>${qcount} saved question${qcount===1?"":"s"}</span><button class="small-button" data-study-material="${escapeHtml(m.id)}">Study →</button></div></article>`;
}
function renderLibrary() {
  const query=($("librarySearch")?.value||"").trim().toLowerCase();
  const list=state.materials.filter(m=>m.title.toLowerCase().includes(query));
  $("libraryMaterials").innerHTML=list.map(materialCard).join("");
  $("libraryCount").textContent=`${list.length} material${list.length===1?"":"s"}`;
  $("libraryEmpty").classList.toggle("hidden",state.materials.length>0);
  $("libraryMaterials").classList.toggle("hidden",list.length===0);
  bindMaterialCards();
}
function bindMaterialCards() {
  document.querySelectorAll("[data-study-material]").forEach(btn=>btn.onclick=()=>openSetup(btn.dataset.studyMaterial));
  document.querySelectorAll("[data-delete-material]").forEach(btn=>btn.onclick=()=>confirmDeleteMaterial(btn.dataset.deleteMaterial));
}
function renderHistory() {
  $("historyList").innerHTML=state.results.map(r=>`<article class="history-item"><div class="history-icon">✓</div><div class="history-info"><strong>${escapeHtml(r.materialTitle)} — ${r.mode==="practice"?"Practice":"Examination"}</strong><small>${dateText(r.date)} · ${r.correct}/${r.total} correct · ${Math.round(r.duration/60)} min</small></div><div class="history-score">${r.score}%</div><button class="small-button" data-review-result="${escapeHtml(r.id)}">Review</button></article>`).join("");
  $("historyEmpty").classList.toggle("hidden",state.results.length>0);
  document.querySelectorAll("[data-review-result]").forEach(b=>b.onclick=()=>reviewSavedResult(b.dataset.reviewResult));
}
function showModal(html) { $("modalContent").innerHTML=html; $("modalBackdrop").classList.remove("hidden"); }
function closeModal() { $("modalBackdrop").classList.add("hidden"); }
async function confirmDeleteMaterial(id) {
  const m=state.materials.find(x=>x.id===id); if(!m)return;
  showModal(`<h2 id="modalTitle">Delete this material?</h2><p><strong>${escapeHtml(m.title)}</strong> and its saved question bank will be removed from this browser. Previous exam results will remain in your history.</p><div class="modal-actions"><button class="secondary-button" id="cancelModal">Cancel</button><button class="danger-button" id="confirmDelete">Delete material</button></div>`);
  $("cancelModal").onclick=closeModal;
  $("confirmDelete").onclick=async()=>{await dbDelete("materials",id);for(const q of state.questions.filter(q=>q.materialId===id))await dbDelete("questions",q.id);closeModal();await refreshData();toast("Material deleted.");};
}
async function extractFile(file) {
  const name=file.name||"Study material";
  const ext=name.split(".").pop().toLowerCase();
  if(file.size>25*1024*1024) throw new Error("Please choose a file smaller than 25 MB.");
  let text="",pages=[];
  if(ext==="pdf") {
    const bytes=await file.arrayBuffer(); const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i); const content=await page.getTextContent();
      const pageText=content.items.map(item=>item.str).join(" ").replace(/\s+/g," ").trim();
      if(pageText) { pages.push({page:i,text:pageText}); text+=`\n[Page ${i}]\n${pageText}\n`; }
    }
    if(!text.trim()) throw new Error("No selectable text was found in this PDF. It may be scanned or image-only. OCR support is not included yet.");
    return {text:text.trim(),type:"pdf",pages:pdf.numPages};
  }
  if(ext==="docx") {
    if(!window.mammoth) throw new Error("The DOCX reader did not load. Check your internet connection and try again.");
    const result=await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});text=result.value.trim();
    if(!text)throw new Error("No readable text was found in this DOCX file.");
    return {text,type:"docx",pages:0};
  }
  if(["txt","md"].includes(ext)) {text=await file.text();if(!text.trim())throw new Error("This file appears to be empty.");return {text:text.trim(),type:ext,pages:0};}
  throw new Error("Unsupported file type. Please upload PDF, DOCX, TXT or MD.");
}
async function uploadFile(file) {
  if(!file)return;
  busy("Reading your material","Extracting text from your document on this device.");
  try{
    const extracted=await extractFile(file);
    const title=file.name.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").trim()||"Untitled material";
    const material={id:uid(),title,type:extracted.type,content:extracted.text,pages:extracted.pages,wordCount:extracted.text.split(/\s+/).filter(Boolean).length,createdAt:Date.now(),fileName:file.name};
    await dbPut("materials",material);await refreshData();unbusy();navigate("library");toast("Material added to your library.");
  }catch(err){unbusy();showModal(`<h2 id="modalTitle">Couldn't read that file</h2><p>${escapeHtml(err.message||"Something went wrong.")}</p><div class="modal-actions"><button class="primary-button" id="closeError">OK</button></div>`);$("closeError").onclick=closeModal;}
}
function openSetup(id) {
  const m=state.materials.find(x=>x.id===id);if(!m)return;
  state.currentMaterial=m;
  $("setupTitle").textContent="Create an exam";
  $("setupDescription").textContent="Choose how you want to practise this material.";
  $("setupMaterialTitle").textContent=m.title;
  $("setupMaterialMeta").textContent=`${m.wordCount.toLocaleString()} words · ${questionCountFor(m.id)} saved questions`;
  $("generationNotice").textContent="";
  navigate("exam-setup");
}
function getEndpoint() { return (localStorage.getItem("recall_backend_url")||"").trim().replace(/\/+$/,""); }
async function callBackend(payload) {
  const endpoint=getEndpoint();
  if(!endpoint)throw new Error("AI backend isn't configured yet. Open Settings and add your deployed backend URL. See README.md for setup instructions.");
  const response=await fetch(`${endpoint}/generate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||`AI request failed (${response.status}).`);
  if(!Array.isArray(body.questions))throw new Error("The AI backend returned an unexpected response.");
  return body.questions;
}
function normalizeQuestion(q,materialId) {
  const options=Array.isArray(q.options)?q.options.map(String):[];
  if(options.length!==4)throw new Error("A generated question did not contain exactly four options.");
  let answerIndex=Number(q.answerIndex);
  if(!Number.isInteger(answerIndex)&&typeof q.answer==="string")answerIndex=options.findIndex(o=>o.trim().toLowerCase()===q.answer.trim().toLowerCase());
  if(answerIndex<0||answerIndex>3)throw new Error("A generated question had an invalid answer key.");
  const question=String(q.question||"").trim(), explanation=String(q.explanation||"").trim();
  if(!question||!explanation)throw new Error("A generated question was missing its question or explanation.");
  return {id:uid(),materialId,question,options,answerIndex,explanation,difficulty:["easy","medium","hard"].includes(String(q.difficulty).toLowerCase())?String(q.difficulty).toLowerCase():"medium",source:String(q.source||""),createdAt:Date.now()};
}
function shuffle(list) {const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
async function startExam() {
  const m=state.currentMaterial;if(!m)return;
  const count=Number($("questionCount").value),difficulty=$("difficulty").value,mode=document.querySelector('input[name="mode"]:checked').value,reuse=$("reuseBank").checked;
  let bank=state.questions.filter(q=>q.materialId===m.id);
  let picked=reuse?shuffle(bank).slice(0,count):[];
  const need=count-picked.length;
  try {
    if(need>0) {
      busy("Creating your examination",`Preparing ${need} new question${need===1?"":"s"} from your notes. Keep this page open.`);
      const existing=bank.map(q=>q.question).slice(0,80);
      const generated=await callBackend({title:m.title,text:m.content,count:need,difficulty,excludeQuestions:existing});
      if(generated.length<need)throw new Error(`The AI generated ${generated.length} valid questions, but ${need} were needed. Try a smaller exam or generate again.`);
      const normalized=generated.slice(0,need).map(q=>normalizeQuestion(q,m.id));
      for(const q of normalized)await dbPut("questions",q);
      picked=picked.concat(normalized);
      await refreshData();
    }
    state.exam={id:uid(),material:m,mode,questions:shuffle(picked).slice(0,count),startedAt:Date.now(),duration:0};
    state.questionIndex=0;state.selections={};state.submitted=new Set();state.revealed=new Set();state.result=null;state.reviewOnly=false;
    $("examMaterialName").textContent=m.title;$("examTimer").classList.toggle("hidden",mode!=="exam");
    if(state.timerInterval)clearInterval(state.timerInterval);state.timerStart=Date.now();
    if(mode==="exam")state.timerInterval=setInterval(updateTimer,1000);
    unbusy();navigate("exam");renderQuestion();
  }catch(err){unbusy();showModal(`<h2 id="modalTitle">Couldn't generate the examination</h2><p>${escapeHtml(err.message||"Please try again.")}</p><p>If the backend is configured, check its deployment logs and make sure the AI provider has available API credit.</p><div class="modal-actions"><button class="primary-button" id="closeError">OK</button></div>`);$("closeError").onclick=closeModal;}
}
function updateTimer() {
  if(!state.exam)return;
  const seconds=Math.floor((Date.now()-state.timerStart)/1000);
  $("examTimer").textContent=`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
}
function renderQuestion() {
  if(!state.exam)return;
  const q=state.exam.questions[state.questionIndex],idx=state.questionIndex,total=state.exam.questions.length;
  $("examProgressLabel").textContent=`Question ${idx+1} of ${total}`;
  $("examProgressBar").style.width=`${((idx+1)/total)*100}%`;
  $("questionNumber").textContent=`QUESTION ${idx+1} OF ${total}`;
  $("questionDifficulty").textContent=q.difficulty||"mixed";
  $("questionText").textContent=q.question;
  $("questionInstruction").textContent=state.exam.mode==="practice"?"Choose one answer, then submit it. You can reveal the answer whenever you want.":"Choose one answer. Your answers will be marked when you finish.";
  $("answerOptions").innerHTML=q.options.map((option,i)=>{
    const selected=state.selections[q.id]===i,show=state.revealed.has(q.id)||(state.exam.mode==="practice"&&state.submitted.has(q.id));
    const cls=["answer-option",selected?"selected":"",show&&i===q.answerIndex?"correct":"",show&&selected&&i!==q.answerIndex?"incorrect":""].filter(Boolean).join(" ");
    return `<button class="${cls}" data-option="${i}" ${state.reviewOnly?"disabled":""}><span class="option-letter">${"ABCD"[i]}</span><span>${escapeHtml(option)}</span></button>`;
  }).join("");
  document.querySelectorAll("[data-option]").forEach(b=>b.onclick=()=>selectOption(Number(b.dataset.option)));
  const revealed=state.revealed.has(q.id)||(state.exam.mode==="practice"&&state.submitted.has(q.id));
  const feedback=$("feedbackPanel");
  feedback.classList.toggle("hidden",!revealed);
  feedback.classList.toggle("incorrect",revealed&&state.selections[q.id]!==q.answerIndex);
  if(revealed)feedback.innerHTML=`<strong>${state.selections[q.id]===q.answerIndex?"Correct answer":"Answer review"} · ${"ABCD"[q.answerIndex]}</strong>${escapeHtml(q.explanation)}${q.source?`<br><br><span class="muted">Source: ${escapeHtml(q.source)}</span>`:""}`;
  $("revealAnswerButton").classList.toggle("hidden",state.exam.mode==="exam"&&!state.reviewOnly);
  $("submitAnswerButton").classList.toggle("hidden",state.reviewOnly||state.exam.mode==="practice"&&state.submitted.has(q.id));
  $("nextQuestionButton").classList.toggle("hidden",idx===total-1||(!state.reviewOnly&&state.exam.mode==="practice"&&!state.submitted.has(q.id)));
  $("finishExamButton").classList.toggle("hidden",state.reviewOnly||idx!==total-1);
  $("previousQuestionButton").classList.toggle("hidden",idx===0);
  if(state.reviewOnly){$("questionInstruction").textContent="Review mode — your saved answer and the correct answer are shown.";feedback.classList.remove("hidden");}
  $("sideQuestionProgress").textContent=`${idx+1} / ${total}`;
  $("sideProgressBar").style.width=`${((idx+1)/total)*100}%`;
  $("sideAnswered").textContent=Object.keys(state.selections).filter(id=>state.selections[id]!==undefined).length;
  $("sideReview").textContent=state.exam.questions.filter(item=>state.selections[item.id]===undefined).length;
}
function selectOption(i) {
  const q=state.exam.questions[state.questionIndex];
  if(state.reviewOnly||state.exam.mode==="practice"&&state.submitted.has(q.id))return;
  state.selections[q.id]=i;renderQuestion();
}
function submitAnswer() {
  const q=state.exam.questions[state.questionIndex];
  if(state.selections[q.id]===undefined){toast("Choose an answer first, or reveal the answer.");return;}
  state.submitted.add(q.id);
  if(state.exam.mode==="practice")state.revealed.add(q.id);
  renderQuestion();
}
function revealAnswer() {const q=state.exam.questions[state.questionIndex];state.revealed.add(q.id);renderQuestion();}
function nextQuestion() {if(state.questionIndex<state.exam.questions.length-1){state.questionIndex++;renderQuestion();}}
function previousQuestion() {if(state.questionIndex>0){state.questionIndex--;renderQuestion();}}
function finishPrompt() {
  const total=state.exam.questions.length,answered=Object.keys(state.selections).length;
  showModal(`<h2 id="modalTitle">Finish this examination?</h2><p>You've answered ${answered} of ${total} questions. Unanswered questions will count as incorrect. Once submitted, your score will be saved.</p><div class="modal-actions"><button class="secondary-button" id="cancelModal">Keep studying</button><button class="primary-button" id="confirmFinish">Submit exam</button></div>`);
  $("cancelModal").onclick=closeModal;$("confirmFinish").onclick=()=>{closeModal();finishExam();};
}
async function finishExam() {
  if(!state.exam)return;
  if(state.timerInterval)clearInterval(state.timerInterval);
  const questions=state.exam.questions;
  const correct=questions.filter(q=>state.selections[q.id]===q.answerIndex).length;
  const answered=questions.filter(q=>state.selections[q.id]!==undefined).length;
  const total=questions.length,score=Math.round(correct/total*100);
  const result={id:uid(),materialId:state.exam.material.id,materialTitle:state.exam.material.title,mode:state.exam.mode,date:Date.now(),total,correct,incorrect:total-correct,unanswered:total-answered,score,duration:Math.floor((Date.now()-state.timerStart)/1000),questions:questions.map(q=>({questionId:q.id,question:q.question,options:q.options,answerIndex:q.answerIndex,explanation:q.explanation,difficulty:q.difficulty,source:q.source,selected:state.selections[q.id]??null}))};
  await dbPut("results",result);state.result=result;await refreshData();showResults(result);navigate("results");
}
function showResults(r) {
  $("resultHeadline").textContent=r.score>=80?"Excellent work!":r.score>=60?"Good effort. Keep going.":"Every attempt teaches you something.";
  $("resultSubheading").textContent=`${r.materialTitle} · ${r.mode==="practice"?"Practice session":"Examination session"}`;
  $("resultScore").textContent=r.score;$("resultScoreBar").style.width=`${r.score}%`;
  $("resultCorrect").textContent=r.correct;$("resultIncorrect").textContent=r.incorrect-r.unanswered;$("resultUnanswered").textContent=r.unanswered;
  $("resultsReview").classList.add("hidden");$("resultsReview").innerHTML="";
  $("retryWrongButton").classList.toggle("hidden",r.correct===r.total);
}
function resultReviewMarkup(r) {
  return r.questions.map((q,i)=>{
    const selected=q.selected===null||q.selected===undefined?"Not answered":`${"ABCD"[q.selected]}. ${q.options[q.selected]}`;
    const correct=`${"ABCD"[q.answerIndex]}. ${q.options[q.answerIndex]}`;
    return `<article class="review-item"><h3>${i+1}. ${escapeHtml(q.question)}</h3><p class="${q.selected===q.answerIndex?"correct-text":"wrong-text"}"><strong>Your answer:</strong> ${escapeHtml(selected)}</p><p class="correct-text"><strong>Correct answer:</strong> ${escapeHtml(correct)}</p><p><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</p>${q.source?`<p><strong>Source:</strong> ${escapeHtml(q.source)}</p>`:""}</article>`;
  }).join("");
}
function toggleResultsReview() {
  const el=$("resultsReview");if(!state.result)return;
  if(!el.classList.contains("hidden")){el.classList.add("hidden");$("reviewAnswersButton").textContent="Review answers";return;}
  el.innerHTML=resultReviewMarkup(state.result);el.classList.remove("hidden");$("reviewAnswersButton").textContent="Hide answer review";el.scrollIntoView({behavior:"smooth",block:"start"});
}
function reviewSavedResult(id) {
  const r=state.results.find(x=>x.id===id);if(!r)return;
  state.result=r;showResults(r);navigate("results");toggleResultsReview();
}
function retryWrong() {
  if(!state.result)return;
  const wrong=state.result.questions.filter(q=>q.selected!==q.answerIndex);
  if(!wrong.length){toast("You got every question right.");return;}
  const original=state.result;
  state.exam={id:uid(),material:{id:original.materialId,title:original.materialTitle},mode:"practice",questions:wrong.map(q=>({id:q.questionId,materialId:original.materialId,question:q.question,options:q.options,answerIndex:q.answerIndex,explanation:q.explanation,difficulty:q.difficulty,source:q.source})) ,startedAt:Date.now(),duration:0};
  state.questionIndex=0;state.selections={};state.submitted=new Set();state.revealed=new Set();state.result=null;state.reviewOnly=false;state.timerStart=Date.now();
  $("examMaterialName").textContent=`Retry: ${original.materialTitle}`;$("examTimer").classList.add("hidden");navigate("exam");renderQuestion();
}
function newExam() {if(state.result){const m=state.materials.find(m=>m.id===state.result.materialId);if(m){openSetup(m.id);return;}}navigate("library");}
async function updateStorageEstimate() {
  try{const est=await navigator.storage?.estimate?.();$("storageEstimate").textContent=est?.usage?`${(est.usage/1024/1024).toFixed(1)} MB used`:"Available";}catch{$("storageEstimate").textContent="Unavailable";}
}
function saveSettings() {
  const url=$("apiEndpoint").value.trim();
  if(url&&!/^https?:\/\/.+/i.test(url)){toast("Enter a valid backend URL beginning with https://");return;}
  localStorage.setItem("recall_backend_url",url.replace(/\/+$/,""));$("settingsSaved").textContent="Saved";setTimeout(()=>$("settingsSaved").textContent="",2200);updateAiStatus();
}
function updateAiStatus() {
  const endpoint=getEndpoint();const el=$("aiStatus");el.textContent=endpoint?"Endpoint configured":"Not configured";el.classList.toggle("connected",!!endpoint);
}
async function testConnection() {
  const endpoint=getEndpoint();if(!endpoint){toast("Add and save your backend URL first.");return;}
  busy("Testing connection","Checking whether the backend is reachable.");
  try{const r=await fetch(`${endpoint}/health`);const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||"Backend did not respond correctly.");unbusy();toast("Backend connection successful.");}
  catch(e){unbusy();showModal(`<h2 id="modalTitle">Connection test failed</h2><p>${escapeHtml(e.message||"Couldn't reach the backend.")}</p><p>Check that the worker is deployed, the URL is correct, and its CORS settings allow your app's origin.</p><div class="modal-actions"><button class="primary-button" id="closeError">OK</button></div>`);$("closeError").onclick=closeModal;}
}
async function exportBackup() {
  const backup={format:"recall-backup-v1",exportedAt:new Date().toISOString(),materials:state.materials,questions:state.questions,results:state.results};
  const blob=new Blob([JSON.stringify(backup)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`recall-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast("Backup exported.");
}
async function importBackup(file) {
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.format!=="recall-backup-v1"||!Array.isArray(data.materials)||!Array.isArray(data.questions)||!Array.isArray(data.results))throw new Error("This doesn't look like a valid Recall backup.");
    for(const m of data.materials)if(m.id&&m.content)await dbPut("materials",m);
    for(const q of data.questions)if(q.id&&q.materialId)await dbPut("questions",q);
    for(const r of data.results)if(r.id&&Array.isArray(r.questions))await dbPut("results",r);
    await refreshData();toast("Backup imported successfully.");
  }catch(e){toast(e.message||"Couldn't import backup.");}
  $("importBackupInput").value="";
}
async function clearAllData() {
  showModal(`<h2 id="modalTitle">Delete all local data?</h2><p>This permanently removes all materials, saved questions and exam results stored by Recall in this browser. Export a backup first if you may need this data.</p><div class="modal-actions"><button class="secondary-button" id="cancelModal">Cancel</button><button class="danger-button" id="confirmClear">Delete everything</button></div>`);
  $("cancelModal").onclick=closeModal;$("confirmClear").onclick=async()=>{closeModal();for(const s of stores)await dbClear(s);await refreshData();toast("All local study data deleted.");};
}
function bindEvents() {
  ["uploadTopButton","heroUploadButton","emptyUploadButton","libraryUploadButton","libraryEmptyUpload"].forEach(id=>$(id).onclick=()=>$("materialFileInput").click());
  $("materialFileInput").onchange=e=>uploadFile(e.target.files[0]).finally(()=>e.target.value="");
  document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();navigate(b.dataset.view);}));
  $("mobileSettings").onclick=()=>navigate("settings");
  $("librarySearch").oninput=renderLibrary;
  $("startExamButton").onclick=startExam;
  $("revealAnswerButton").onclick=revealAnswer;
  $("submitAnswerButton").onclick=submitAnswer;
  $("nextQuestionButton").onclick=nextQuestion;
  $("previousQuestionButton").onclick=previousQuestion;
  $("finishExamButton").onclick=finishPrompt;
  $("exitExamButton").onclick=()=>{
    showModal(`<h2 id="modalTitle">Leave this session?</h2><p>Your current answers won't be saved as a completed result if you leave now.</p><div class="modal-actions"><button class="secondary-button" id="cancelModal">Keep going</button><button class="danger-button" id="confirmExit">Exit session</button></div>`);
    $("cancelModal").onclick=closeModal;
    $("confirmExit").onclick=()=>{if(state.timerInterval)clearInterval(state.timerInterval);closeModal();navigate("library");};
  };
  $("reviewAnswersButton").onclick=toggleResultsReview;
  $("retryWrongButton").onclick=retryWrong;
  $("newExamButton").onclick=newExam;
  $("saveSettingsButton").onclick=saveSettings;
  $("testConnectionButton").onclick=testConnection;
  $("exportBackupButton").onclick=exportBackup;
  $("importBackupInput").onchange=e=>importBackup(e.target.files[0]);
  $("clearDataButton").onclick=clearAllData;
  $("closeModalButton").onclick=closeModal;
  $("modalBackdrop").onclick=e=>{if(e.target===$("modalBackdrop"))closeModal();};
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
}
async function init() {
  try{db=await openDb();}catch(e){document.body.innerHTML="<main style='padding:24px;font-family:sans-serif'><h1>Recall couldn't open its local database</h1><p>Please open the app in a modern browser and ensure site storage is enabled.</p></main>";return;}
  bindEvents();$("apiEndpoint").value=getEndpoint();updateAiStatus();
  await refreshData();
  if(!state.materials.length)$("homeEmpty").classList.remove("hidden");
}
init();
