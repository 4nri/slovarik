'use strict';
const $ = (id) => document.getElementById(id);
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORAGE_KEY = 'slovarik-school-v1';
const modes = {learn: {title:'Посмотри. Запомни. Напиши.',desc:'Прочитай слово внимательно. Потом спрячь его и попробуй написать по памяти.',button:'Начать запоминать',note:'Произнеси слово и обрати внимание на каждую букву. Затем проверь, сможешь ли написать его без подсказки.'},practice:{title:'Слушай и пиши.',desc:'Послушай слово, напиши его и сразу проверь ответ. Здесь можно спокойно ошибаться.',button:'Начать тренировку',note:'Не получилось с первого раза? Посмотри на правильное написание. В конце можно отдельно повторить все трудные слова.'},dictation:{title:'Как на настоящем диктанте.',desc:'Слушай слова и записывай их по одному. Правильные ответы увидишь, когда закончишь.',button:'Начать диктант',note:'Слова будут в случайном порядке. Можно прослушать слово ещё раз. Проверка и разбор ошибок — в конце.'}};
let storageOK = true;
let saved = {};
try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); if(data && typeof data === 'object' && !Array.isArray(data)) saved = data; } catch {storageOK = false;}
const wordIds = new Set(WORDS.map(w=>w.id));
const progress = {};
for (const [id,p] of Object.entries(saved.progress || {})) if(wordIds.has(id) && p && typeof p==='object') progress[id]={streak:Number.isFinite(p.streak)?Math.max(0,p.streak):0,attempts:Number.isFinite(p.attempts)?Math.max(0,p.attempts):0,wrong:p.wrong===true};
const selections = {};
for(let g=1;g<=4;g++){const ids=WORDS.filter(w=>w.grade===g).map(w=>w.id); selections[g]=Array.isArray(saved.selections?.[g])?saved.selections[g].filter(id=>ids.includes(id)):ids;}
let grade = [1,2,3,4].includes(saved.grade) ? saved.grade : 4;
let mixedMode = saved.mixedMode===true;
let mixedSelection = Array.isArray(saved.mixedSelection)?saved.mixedSelection.filter(id=>wordIds.has(id)):[...selections[grade]];
let mode = Object.hasOwn(modes,saved.mode) ? saved.mode : 'learn';
let part = ['all','1','2'].includes(saved.part) ? saved.part : 'all';
let size = ['10','20','all'].includes(saved.size) ? saved.size : '10';
let rate = saved.rate===0.7 ? 0.7 : 0.9;
let session = null;
let result = null;
let draftSelection = new Set();
let pendingExit = null;
let wordAudio = null;
let audioRequest = 0;
let speechMessage = '';
const speakerIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke-linejoin="round"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" stroke-linecap="round"/></svg>';
function save(){try {localStorage.setItem(STORAGE_KEY,JSON.stringify({grade,mixedMode,mixedSelection,mode,part,size,rate,selections,progress}));} catch {storageOK=false;} updateStorageNote();}
function updateStorageNote(){const note=$('local-note');if(!storageOK){note.textContent='Браузер не сохраняет прогресс. Тренироваться можно.';note.classList.add('storage-note');}}
function gradeWords(){return WORDS.filter(w=>w.grade===grade);}
function uniqueWords(words){const seen=new Set();return words.filter(w=>{const key=normalize(w.text);if(seen.has(key))return false;seen.add(key);return true;});}
function chosenWords(){return mixedMode?uniqueWords(WORDS.filter(w=>mixedSelection.includes(w.id))):gradeWords().filter(w=>selections[grade].includes(w.id)&&(part==='all'||w.part===Number(part)));}
function updateHeader(){
  const all=mixedMode?chosenWords():gradeWords(), mastered=all.filter(w=>(progress[w.id]?.streak||0)>=2).length;
  const grades=[...new Set(all.map(w=>w.grade))].sort();
  $('grade-caption').textContent=mixedMode?(grades.length?grades.join(', ')+' классы':'Смешанный список'):grade+' класс';$('total-caption').textContent=all.length+' '+plural(all.length,'слово','слова','слов');
  $('mastered-count').textContent=mastered+' / '+all.length;$('mastered-bar').style.width=(all.length?mastered/all.length*100:0)+'%';
  document.querySelectorAll('[data-grade]').forEach(b=>{const yes=!mixedMode&&Number(b.dataset.grade)===grade;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',yes);});
  $('mix-classes').setAttribute('aria-pressed',mixedMode);$('mix-classes').classList.toggle('selected',mixedMode);
  document.querySelectorAll('[data-mode]').forEach(b=>{b.setAttribute('aria-selected',b.dataset.mode===mode);b.tabIndex=b.dataset.mode===mode?0:-1;});
  updateStorageNote();
}
function audioLoading(loading){document.querySelectorAll('[data-action="speak"]').forEach(b=>{b.classList.toggle('audio-loading',loading);b.setAttribute('aria-busy',loading);});}
function stopSpeech(){audioRequest++;if(wordAudio){wordAudio.pause();wordAudio.currentTime=0;wordAudio=null;}audioLoading(false);}
function showSpeechMessage(message){speechMessage=message;const box=$('speech-message');if(box){box.textContent=message;box.hidden=!message;}}
function speakWord(){
  if(!session || session.phase==='feedback')return;
  const word=session.queue[session.index];
  stopSpeech();
  const file=AUDIO_FILES[word.id];
  if(!file || !('Audio' in window)){showSpeechMessage('Запись слова недоступна. Взрослый может открыть слово ниже и прочитать его вслух.');return;}
  showSpeechMessage('');
  const recording=RecordedWords.get(word);if(!recording)return;wordAudio=recording;
  const request=audioRequest;
  recording.playbackRate=rate/0.9;
  recording.preservesPitch=true;
  const loading=()=>{if(wordAudio===recording&&request===audioRequest){audioLoading(true);showSpeechMessage('Загружаем звук…');}};
  const ready=()=>{if(wordAudio===recording&&request===audioRequest){audioLoading(false);showSpeechMessage('');}};
  recording.onwaiting=loading;recording.onloadstart=loading;recording.onplaying=ready;recording.oncanplay=ready;recording.onended=ready;
  recording.onerror=()=>{if(wordAudio===recording&&request===audioRequest){audioLoading(false);showSpeechMessage('Не удалось загрузить запись. Проверь интернет и нажми «Послушать ещё раз».');}};
  if(recording.readyState<3)loading();
  recording.play().catch(error=>{
    if(wordAudio!==recording||request!==audioRequest||error.name==='AbortError')return;
    audioLoading(false);
    showSpeechMessage(error.name==='NotAllowedError'?'Нажми на кнопку со звуком, чтобы послушать слово.':'Не удалось включить запись. Нажми на кнопку со звуком ещё раз.');
  });
}
function readyHTML(){
  if(!mixedMode&&grade===1)part='all';
  const info=modes[mode], selected=chosenWords(), errors=selected.filter(w=>progress[w.id]?.wrong).length;
  return `<h3 class="intro-title">${info.title}</h3><p class="intro-desc">${info.desc}</p><div class="controls">${mixedMode?'<div class="mixed-caption">Слова из разных классов</div>':`<label>Какие слова<select id="part-select"><option value="all" ${part==='all'?'selected':''}>Весь список</option><option value="1" ${part==='1'?'selected':''} ${grade===1?'hidden':''}>1 часть</option><option value="2" ${part==='2'?'selected':''} ${grade===1?'hidden':''}>2 часть</option></select></label>`}<label>За одно занятие<select id="size-select"><option value="10" ${size==='10'?'selected':''}>10 слов</option><option value="20" ${size==='20'?'selected':''}>20 слов</option><option value="all" ${size==='all'?'selected':''}>Все выбранные</option></select></label><button class="button quiet word-selection" data-action="words">Выбрать слова</button></div><div class="selection-caption"><span>Готово к занятию</span><strong>${selected.length} ${plural(selected.length,'слово','слова','слов')}</strong></div>${!selected.length?'<p class="blank-message">Нет выбранных слов в этой части. Выбери слова или открой весь список.</p>':''}<div class="practice-note"><span class="note-icon" aria-hidden="true">✳</span><span>${info.note}</span></div><div class="start-row"><button class="button primary" data-action="start" ${selected.length?'':'disabled'}>${info.button}</button>${errors?`<button class="text-button" data-action="retry-saved">Повторить трудные (${errors})</button>`:'<span class="small-muted">Без таймера. В своём темпе.</span>'}</div>`;
}
function adultHTML(){return `<details class="adult" id="adult-word"><summary>Слово для взрослого, если нет звука</summary><strong id="adult-word-content"></strong><span>Прочитайте вслух, пока ребёнок не смотрит на экран.</span></details>`;}
function soundHTML(){return `<button class="listen-button" type="button" data-action="speak" aria-label="Послушать слово">${speakerIcon}</button><div class="listen-label">Послушать ещё раз</div><div class="sound-settings"><label for="speech-rate">Темп чтения</label><select id="speech-rate"><option value="0.9" ${rate===0.9?'selected':''}>Обычный</option><option value="0.7" ${rate===0.7?'selected':''}>Медленный</option></select></div><div id="speech-message" class="sound-error" role="status" ${speechMessage?'':'hidden'}>${escapeHTML(speechMessage)}</div>`;}
function answerHTML(){return `<form id="answer-form" autocomplete="off"><label class="answer-label" for="answer">Твой ответ</label><input class="answer-input" id="answer" name="answer" placeholder="Напиши слово…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" required maxlength="100"><div class="answer-actions"><button type="button" class="text-button" data-action="skip">Не знаю</button><span class="small-muted">Можно нажать Enter</span><button type="submit" class="button primary">${mode==='dictation'?(session.index===session.queue.length-1?'Завершить диктант':'Записать ответ'):'Проверить'}</button></div></form>`;}
function highlightedWord(row){return alignAnswer(row.answer,row.word.text).filter(x=>x.expected).map(x=>x.wrong?`<mark>${escapeHTML(x.expected)}</mark>`:escapeHTML(x.expected)).join('');}
function feedbackHTML(row){
  const cls=row.helped?'neutral':row.correct?'success':'error';
  const title=row.helped?'Теперь попробуй без подсказки':row.correct?'Всё верно!':row.answer?'Почти! Давай запомним.':'Запомним это слово.';
  return `<div class="feedback ${cls}" role="status"><h3>${title}</h3>${row.correct&&!row.helped?'<p>Отлично, идём дальше.</p>':`<p>Правильное написание:</p><div class="correct-word">${highlightedWord(row)}</div>${row.answer&&!row.correct?`<p>Ты написал: ${escapeHTML(row.answer)}</p>`:''}${row.helped?'<p>Этот ответ был с подсказкой.</p>':''}`}</div><div class="answer-actions"><span class="small-muted">${row.correct?'': 'Посмотри на слово и произнеси его.'}</span><button id="next-word" class="button primary" data-action="next">${session.index===session.queue.length-1?'Посмотреть результат':'Следующее слово'}</button></div>`;
}
function sessionHTML(){
  const w=session.queue[session.index], feedback=session.phase==='feedback', row=session.rows[session.rows.length-1];
  let content;
  if(feedback){content=`<h3>${mode==='learn'?'Проверяем память':'Проверяем ответ'}</h3>${feedbackHTML(row)}`;}
  else if(mode==='learn'&&session.phase==='read'){content=`<h3>Посмотри внимательно</h3><p class="small-muted">Произнеси слово. Запомни, как оно пишется.</p><div class="word-card"><span class="study-word">${escapeHTML(w.text)}</span></div><button class="button secondary" data-action="speak">${speakerIcon.replace('<svg ','<svg width="20" height="20" ')} Послушать</button><div class="answer-actions"><span class="small-muted">Готов? Спрячь слово и проверь себя.</span><button class="button primary" data-action="hide">Спрятать и написать</button></div>`;}
  else if(mode==='learn'){content=`<h3>Напиши по памяти</h3><p class="small-muted">Как писалось слово, которое ты только что видел?</p>${session.helped?`<div class="word-card"><span class="study-word">${escapeHTML(w.text)}</span></div>`:''}${answerHTML()}<button class="text-button" data-action="hint">${session.helped?'Спрятать подсказку':'Ещё раз посмотреть'}</button>`;}
  else{content=`<h3>${mode==='dictation'?'Слушай. Записывай.':'Как пишется это слово?'}</h3>${soundHTML()}${answerHTML()}${mode==='practice'?`<button class="text-button" data-action="hint">Подсмотреть написание</button>${session.helped?`<div class="word-card"><span class="study-word">${escapeHTML(w.text)}</span></div>`:''}`:''}${adultHTML()}`;}
  return `<div class="session-top"><strong>${mode==='dictation'?'Диктант':mode==='learn'?'Запоминание':'Тренировка'} · ${session.index+1} из ${session.queue.length}</strong><button class="text-button" data-action="exit">Закончить</button></div><div class="session-meter" role="progressbar" aria-label="Пройдено слов" aria-valuemin="0" aria-valuemax="${session.queue.length}" aria-valuenow="${session.index}"><span style="width:${session.index/session.queue.length*100}%"></span></div><div class="exercise">${content}</div>`;
}
function resultHTML(){
  const rows=result.rows, good=rows.filter(r=>r.correct&&!r.helped).length, errors=rows.filter(r=>!r.correct||r.helped);
  return `<h3 class="result-title">${good===rows.length?'Все слова получились!':'Занятие закончено!'}</h3><p class="intro-desc">${good===rows.length?'Отличная работа. Можно взять новые слова или проверить себя ещё раз.':'Ты уже знаешь, какие слова стоит повторить. Давай закрепим их.'}</p><div class="score"><div class="score-number">${good}<small> / ${rows.length}</small></div><div class="score-text"><strong>Без ошибок и подсказок</strong><p>${errors.length?`${errors.length} ${plural(errors.length,'слово','слова','слов')} для повторения`:'Все ответы верные'}</p></div></div><div class="results-list" aria-label="Результаты по словам">${rows.map(r=>`<div class="result-row ${!r.correct||r.helped?'error':''}"><span class="result-status" aria-label="${r.helped?'С подсказкой':r.correct?'Верно':'Ошибка'}">${r.correct&&!r.helped?'✓':'·'}</span><div><div class="correct-word">${r.correct?escapeHTML(r.word.text):highlightedWord(r)}</div>${!r.correct?`<div class="typed">${r.answer?'Твой ответ: '+escapeHTML(r.answer):'Без ответа'}</div>`:''}${r.helped?'<div class="typed">С подсказкой</div>':''}</div></div>`).join('')}</div><div class="result-actions">${errors.length?`<button class="button primary" data-action="retry-result">Повторить трудные (${errors.length})</button>`:'<button class="button primary" data-action="start">Ещё одно занятие</button>'}<button class="button secondary" data-action="home">К выбору слов</button></div>`;
}
function render(focus=false){
  updateHeader();$('surface').innerHTML=session?sessionHTML():result?resultHTML():readyHTML();
  if(!session)RecordedWords.warm(chosenWords());
  const adult=$('adult-word');if(adult)adult.addEventListener('toggle',()=>{const content=$('adult-word-content');if(content)content.textContent=adult.open?session.queue[session.index].text:'';});
  if(focus){const target=$('answer')||$('next-word');if(target)target.focus({preventScroll:true});}
}
function startSession(override){
  const pool=Array.isArray(override)?override:chosenWords();
  if(!pool.length)throw new Error('Не выбраны слова для занятия.');
  const count=Array.isArray(override)||size==='all'?pool.length:Math.min(Number(size),pool.length);
  stopSpeech();result=null;speechMessage='';session={queue:shuffle(pool).slice(0,count),index:0,rows:[],phase:mode==='learn'?'read':'answer',helped:false};
  RecordedWords.warm(session.queue);
  render(mode!=='learn');if(mode!=='learn')speakWord();
}
function submitAnswer(answer, skip=false){
  if(!session||!['answer','recall'].includes(session.phase))throw new Error('Сейчас нельзя отправить ответ.');
  if(typeof answer!=='string'||answer.length>100)throw new Error('Ответ должен быть строкой длиной до 100 символов.');
  if(!answer.trim()&&!skip)throw new Error('Напиши слово или нажми «Не знаю».');
  const row={word:session.queue[session.index],answer:answer.trim(),correct:!skip&&isCorrect(answer,session.queue[session.index]),helped:session.everHelped===true};
  session.rows.push(row);stopSpeech();
  if(mode==='dictation'){nextWord();return {recorded:true,finished:!session};}
  session.phase='feedback';render(true);return {recorded:true,correct:row.correct,helped:row.helped};
}
function completeSession(){
  result={mode,rows:session.rows};
  for(const r of result.rows){const prev=progress[r.word.id]||{attempts:0,streak:0,wrong:false};progress[r.word.id]={attempts:prev.attempts+1,streak:r.correct&&!r.helped?prev.streak+1:0,wrong:!r.correct||r.helped};}
  session=null;stopSpeech();save();render();$('surface').scrollIntoView({behavior:'smooth',block:'start'});
}
function nextWord(){
  if(session.index===session.queue.length-1){completeSession();return;}
  session.index++;session.phase=mode==='learn'?'read':'answer';session.helped=false;session.everHelped=false;speechMessage='';render(mode!=='learn');if(mode!=='learn')speakWord();
}
function requestExit(action){if(!session){action();return;}pendingExit=action;$('exit-dialog').showModal();}
function goHome(){stopSpeech();session=null;result=null;speechMessage='';save();render();}
function switchMode(next){if(!Object.hasOwn(modes,next))return;requestExit(()=>{mode=next;goHome();});}
function switchGrade(next){if(![1,2,3,4].includes(next))return;requestExit(()=>{grade=next;mixedMode=false;part='all';goHome();});}
function visibleDraftWords(){const query=normalize($('word-search').value),p=$('word-part').value,g=$('word-grade').value;return WORDS.filter(w=>(g==='all'||w.grade===Number(g))&&(p==='all'||w.part===Number(p))&&normalize(w.text).includes(query));}
function updateDraftCount(){const count=uniqueWords(WORDS.filter(w=>draftSelection.has(w.id))).length;$('selected-count').textContent='Выбрано: '+count+' '+plural(count,'слово','слова','слов');}
function renderWordList(){
  const words=visibleDraftWords();$('word-grid').innerHTML=words.length?words.map(w=>`<label class="word-option"><input type="checkbox" data-word-id="${w.id}" ${draftSelection.has(w.id)?'checked':''}><span>${escapeHTML(w.text)}<small class="word-grade-tag">${w.grade} кл.</small></span></label>`).join(''):'<p class="empty">Таких слов нет в списке.</p>';
  updateDraftCount();
}
function openWordList(allGrades=false){requestExit(()=>{draftSelection=new Set(mixedMode?mixedSelection:selections[grade]);$('words-heading').textContent='Выбери слова из любых классов';$('word-search').value='';$('word-grade').value=mixedMode||allGrades?'all':String(grade);$('word-part').value='all';$('word-part').querySelector('[value="2"]').hidden=false;renderWordList();$('words-dialog').showModal();});}
function applyWordSelection(){
  const selected=WORDS.filter(w=>draftSelection.has(w.id)), grades=[...new Set(selected.map(w=>w.grade))];
  mixedSelection=[...draftSelection];mixedMode=grades.length!==1;
  if(!mixedMode){grade=grades[0];selections[grade]=selected.map(w=>w.id);}
  part='all';session=null;result=null;save();render();$('words-dialog').close();
}
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.close){$(button.dataset.close).close();return;}
  if(button.dataset.grade){switchGrade(Number(button.dataset.grade));return;}
  if(button.dataset.mode){switchMode(button.dataset.mode);return;}
  const action=button.dataset.action;
  if(action==='start')startSession();
  else if(action==='words')openWordList();
  else if(action==='retry-saved'){mode='practice';startSession(chosenWords().filter(w=>progress[w.id]?.wrong));}
  else if(action==='retry-result'){const words=result.rows.filter(r=>!r.correct||r.helped).map(r=>r.word);mode='practice';startSession(words);}
  else if(action==='speak')speakWord();
  else if(action==='hide'){stopSpeech();session.phase='recall';render(true);}
  else if(action==='hint'){const answer=$('answer')?.value||'';session.helped=!session.helped;session.everHelped=true;render(true);if($('answer'))$('answer').value=answer;}
  else if(action==='skip')submitAnswer('',true);
  else if(action==='next')nextWord();
  else if(action==='home')goHome();
  else if(action==='exit')requestExit(goHome);
});
document.addEventListener('submit',e=>{if(e.target.id!=='answer-form')return;e.preventDefault();const input=$('answer');if(!input.value.trim()){input.setCustomValidity('Напиши слово или нажми «Не знаю».');input.reportValidity();return;}input.setCustomValidity('');submitAnswer(input.value);});
document.addEventListener('input',e=>{if(e.target.id==='answer')e.target.setCustomValidity('');});
document.addEventListener('change',e=>{
  if(e.target.id==='part-select'){part=e.target.value;save();render();}
  if(e.target.id==='size-select'){size=e.target.value;save();render();}
  if(e.target.id==='speech-rate'){rate=Number(e.target.value);save();if(wordAudio)wordAudio.playbackRate=rate/0.9;}
});
$('open-words').addEventListener('click',()=>openWordList());
$('mix-classes').addEventListener('click',()=>openWordList(true));
$('help-button').addEventListener('click',()=>$('help-dialog').showModal());
$('word-grade').addEventListener('change',renderWordList);$('word-part').addEventListener('change',renderWordList);$('word-search').addEventListener('input',renderWordList);
$('word-grid').addEventListener('change',e=>{const id=e.target.dataset.wordId;if(!id)return;if(e.target.checked)draftSelection.add(id);else draftSelection.delete(id);updateDraftCount();});
$('select-visible').addEventListener('click',()=>{visibleDraftWords().forEach(w=>draftSelection.add(w.id));renderWordList();});
$('clear-visible').addEventListener('click',()=>{visibleDraftWords().forEach(w=>draftSelection.delete(w.id));renderWordList();});
$('clear-all').addEventListener('click',()=>{draftSelection.clear();renderWordList();});
$('apply-words').addEventListener('click',applyWordSelection);
$('confirm-exit').addEventListener('click',()=>{stopSpeech();session=null;result=null;$('exit-dialog').close();const action=pendingExit;pendingExit=null;if(action)action();});
$('exit-dialog').addEventListener('close',()=>{if($('exit-dialog').returnValue==='cancel')pendingExit=null;});
document.querySelectorAll('[role="tab"]').forEach(tab=>tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const list=[...document.querySelectorAll('[role="tab"]')],index=list.indexOf(tab),next=e.key==='Home'?0:e.key==='End'?list.length-1:(index+(e.key==='ArrowRight'?1:-1)+list.length)%list.length;list[next].focus();switchMode(list[next].dataset.mode);}));
window.addEventListener('pagehide',stopSpeech);
window.addEventListener('beforeunload',e=>{if(session&&session.rows.length){e.preventDefault();e.returnValue='';}});
render();
/* Optional browser agent interface. Answers are never exposed during a dictation. */
function trainingSnapshot(){return {grade:mixedMode?null:grade,grades:[...new Set(chosenWords().map(w=>w.grade))],mixedMode,mode,selectedWords:chosenWords().length,session:session?{index:session.index+1,total:session.queue.length,phase:session.phase}:null,result:result?{total:result.rows.length,correct:result.rows.filter(r=>r.correct&&!r.helped).length}:null};}
const modelContext=document.modelContext;
if(modelContext?.registerTool){
  const lifecycle=new AbortController();
  const registrations=[
    {name:'read_training_state',title:'Состояние занятия',description:'Read the selected grade, mode and session progress. Hidden words and dictation answers are not returned.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>trainingSnapshot()},
    {name:'start_spelling_session',title:'Начать занятие',description:'Start a spelling session with the words selected in the visible interface. Fails if a session is already active.',inputSchema:{type:'object',properties:{mode:{type:'string',enum:['learn','practice','dictation']}},required:['mode'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:input=>{if(!input||!Object.hasOwn(modes,input.mode)||Object.keys(input).some(k=>k!=='mode'))throw new Error('Неверный режим.');if(session)throw new Error('Сначала закончи текущее занятие.');if(!chosenWords().length)throw new Error('Сначала выбери слова.');mode=input.mode;startSession();return trainingSnapshot();}},
    {name:'submit_spelling_answer',title:'Записать ответ',description:'Submit a typed spelling answer through the same flow as the visible form. Dictation correctness is shown only after the last word.',inputSchema:{type:'object',properties:{answer:{type:'string',minLength:1,maxLength:100}},required:['answer'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:input=>{if(!input||Object.keys(input).some(k=>k!=='answer'))throw new Error('Неверный ответ.');return submitAnswer(input.answer);}}
  ];
  for(const tool of registrations){try{Promise.resolve(modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
