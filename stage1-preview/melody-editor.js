/* Stage 1: pitch cleanup and editable melody. All processing stays in the browser. */
(() => {
const $=id=>document.getElementById(id);
const style=document.createElement('style');
style.textContent=`
#melody-stage{margin-top:18px}#melody-stage[hidden]{display:none}.edit-controls{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.edit-controls button{padding:9px 12px}.note-grid{overflow-x:auto;border:1px solid #5e5067;border-radius:12px;background:#191725;padding:8px;touch-action:pan-x}.note-grid svg{display:block;min-width:100%;height:255px}.note-grid rect.note{fill:#dcb895;stroke:#241a29;stroke-width:1;cursor:pointer}.note-grid rect.note.selected{fill:#b9a2e6;stroke:#fff;stroke-width:2}.note-grid text{font-size:10px;fill:#c5b7cc;pointer-events:none}.note-grid line{stroke:#393344}.note-grid .cursor{stroke:#e7cfab;stroke-width:2}.note-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.note-actions button{padding:10px 12px}.note-help{color:#c4b8cb;font-size:13px;line-height:1.5}`;
document.head.append(style);
// Dedicated transport controls for original humming and editable MIDI piano.
const originalStop=document.createElement('button');originalStop.type='button';originalStop.className='secondary';originalStop.textContent='■ Stop original HUM';originalStop.style.cssText='display:none;margin:10px 0';
originalStop.onclick=()=>{window.hthStopAllAudio?.();$('original').pause();$('original').currentTime=0};
$('original').insertAdjacentElement('afterend',originalStop);
$('file').addEventListener('change',()=>{originalStop.style.display=$('file').files.length?'inline-block':'none'});
const stage=document.createElement('section');stage.className='panel';stage.id='melody-stage';stage.hidden=true;
stage.innerHTML=`<h2>03 / Check your melody</h2><p class="note-help">Listen to your original recording and the detected piano notes. Tap a rectangle to select a note, then adjust its pitch, start, or length. Add, split, merge, undo, and zoom using the editing tools. Your note edits are saved locally on this iPad. These edits change the actual melody used for arrangements and exports.</p><div class="edit-controls"><button id="listen-detected" class="secondary">▶ Detected / corrected piano</button><button id="listen-original" class="secondary">▶ Original humming</button><button id="stop-original" class="secondary">■ Stop original HUM</button><button id="stop-midi" class="secondary">■ Stop editable MIDI</button><button id="restore-notes" class="secondary">Restore detection</button></div><div class="note-grid" id="note-grid"></div><p id="note-info" class="small">Select a note to edit it.</p><div class="note-actions"><button id="pitch-down" class="secondary">Pitch −</button><button id="pitch-up" class="secondary">Pitch +</button><button id="start-back" class="secondary">Earlier</button><button id="start-forward" class="secondary">Later</button><button id="shorten" class="secondary">Shorter</button><button id="lengthen" class="secondary">Longer</button><button id="remove-note" class="secondary">Delete</button></div><div class="edit-controls"><button id="approve-melody">Approve melody & create 3 arrangements</button></div><p class="small" id="melody-warning"></p>`;
$('outputs').before(stage);
$('outputs').querySelector('h2').textContent='04 / Three interpretations';
let notes=[],original=[],selected=-1,decoded=null,preview=null;let activePreviewContext=null;window.hthStopPiano=()=>{if(activePreviewContext){const c=activePreviewContext;activePreviewContext=null;c.close().catch(()=>{})}};let undoStack=[],redoStack=[],draftKey='',zoom=95;
const clone=a=>a.map(n=>({...n}));
const freq=m=>440*Math.pow(2,(m-69)/12);
function estimate(frame,sr){let energy=0;for(let i=0;i<frame.length;i++)energy+=frame[i]*frame[i];if(Math.sqrt(energy/frame.length)<.009)return null;
const min=Math.max(2,Math.floor(sr/800)),max=Math.min(frame.length/2,Math.ceil(sr/90));let best=0,score=0;for(let lag=min;lag<max;lag++){let cross=0,a=0,b=0;for(let i=0;i<frame.length-lag;i+=3){let x=frame[i],y=frame[i+lag];cross+=x*y;a+=x*x;b+=y*y}let s=cross/Math.sqrt(a*b+1e-9);if(s>score){score=s;best=lag}}if(score<.86)return null;return {m:69+12*Math.log2(sr/best/440),c:score}}
function cleanDetect(buf){let sr=buf.sampleRate,src=buf.getChannelData(0),win=Math.max(2048,Math.round(sr*.06)),hop=Math.max(256,Math.round(sr*.025));let frames=[];for(let i=0;i+win<src.length;i+=hop){let p=estimate(src.subarray(i,i+win),sr);frames.push(p)}
let pitch=frames.map((p,i)=>{if(!p)return null;let near=frames.slice(Math.max(0,i-2),i+3).filter(Boolean).map(x=>x.m).sort((a,b)=>a-b);let median=near[Math.floor(near.length/2)];return Math.abs(p.m-median)>1.2?null:Math.round(median)});
for(let i=1;i<pitch.length-1;i++)if(pitch[i]===null&&pitch[i-1]!==null&&pitch[i-1]===pitch[i+1])pitch[i]=pitch[i-1];
let result=[],cur=null,start=0;for(let i=0;i<=pitch.length;i++){let v=i<pitch.length?pitch[i]:null;if(v!==cur){let dur=(i-start)*hop/sr;if(cur!==null&&dur>=.095)result.push({m:Math.max(36,Math.min(96,cur)),t:start*hop/sr,d:dur});cur=v;start=i}}
// Repair brief octave-down errors only when both neighboring notes agree.
for(let i=1;i<result.length-1;i++){
  let n=result[i], prev=result[i-1], next=result[i+1], target=n.m+12;
  if(n.d<.40 && Math.abs(target-prev.m)<=2 && Math.abs(target-next.m)<=2 &&
     Math.abs(n.m-prev.m)>=9 && Math.abs(n.m-next.m)>=9) n.m=target;
}
let merged=[];for(let n of result){let last=merged[merged.length-1];if(last&&last.m===n.m&&n.t-(last.t+last.d)<.09){last.d=n.t+n.d-last.t}else merged.push(n)}
return merged.slice(0,150)}
function render(){let container=$('note-grid');container.replaceChildren();if(!notes.length){container.textContent='No notes to display.';return}
let end=Math.max(1,...notes.map(n=>n.t+n.d)),low=Math.min(...notes.map(n=>n.m))-2,high=Math.max(...notes.map(n=>n.m))+2,range=Math.max(12,high-low+1),width=Math.max(580,Math.round(end*zoom)),height=255;
let svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.width=width+'px';
const element=(name,attrs)=>{let el=document.createElementNS('http://www.w3.org/2000/svg',name);for(let [k,v] of Object.entries(attrs))el.setAttribute(k,v);svg.append(el);return el};
for(let p=low;p<=high;p++){let y=height-(p-low+1)*height/range;element('line',{x1:0,x2:width,y1:y,y2:y});if(p%12===0){let t=element('text',{x:4,y:y-3});t.textContent='C'+(Math.floor(p/12)-1)}}
notes.forEach((n,i)=>{let x=n.t/end*width,w=Math.max(5,n.d/end*width),y=height-(n.m-low+1)*height/range;let rect=element('rect',{x,y,width:w,height:Math.max(7,height/range-1),rx:3,class:'note'+(i===selected?' selected':'')});rect.addEventListener('click',()=>{selected=i;render()})});container.append(svg);
$('note-info').textContent=selected<0?'Tap a note to edit it.':`Note ${selected+1} / ${notes.length} · MIDI pitch ${notes[selected].m} · starts ${notes[selected].t.toFixed(2)}s · lasts ${notes[selected].d.toFixed(2)}s`;
$('melody-warning').textContent=`${notes.length} notes. Pitch and timing are estimates, not a verified transcription. Compare by ear before approving.`;
}
let active;
function saveDraft(){if(!draftKey)return;try{localStorage.setItem(draftKey,JSON.stringify({notes,original}))}catch(e){$('melody-warning').textContent='Draft saving unavailable; exports still work.'}}
function checkpoint(){undoStack.push(clone(notes));if(undoStack.length>40)undoStack.shift();redoStack=[];$('outputs').hidden=true}
function finish(){notes.sort((a,b)=>a.t-b.t);saveDraft();render()}
function edit(fn){if(selected<0)return;checkpoint();active=notes[selected];fn(active);finish();selected=notes.indexOf(active);render()}
function restoreHistory(from,to){if(!from.length)return;to.push(clone(notes));notes=from.pop();selected=-1;saveDraft();$('outputs').hidden=true;render()}
$('pitch-up').onclick=()=>edit(n=>n.m=Math.min(96,n.m+1));
$('pitch-down').onclick=()=>edit(n=>n.m=Math.max(36,n.m-1));
$('start-back').onclick=()=>edit(n=>n.t=Math.max(0,n.t-.05));
$('start-forward').onclick=()=>edit(n=>n.t+=.05);
$('shorten').onclick=()=>edit(n=>n.d=Math.max(.06,n.d-.05));
$('lengthen').onclick=()=>edit(n=>n.d+=.05);
$('remove-note').onclick=()=>{if(selected<0)return;checkpoint();notes.splice(selected,1);selected=-1;finish()};
$('restore-notes').onclick=()=>{checkpoint();notes=clone(original);selected=-1;finish()};
$('stop-original').onclick=()=>{window.hthStopAllAudio?.();$('original').pause();$('original').currentTime=0};
$('stop-midi').onclick=()=>{window.hthStopPiano?.()};
$('listen-original').onclick=()=>{if($('original').src){window.hthStopAllAudio?.();$('original').currentTime=0;$('original').play()}};
$('listen-detected').onclick=async()=>{if(!notes.length)return;try{window.hthStopAllAudio?.();let ctx=new (window.AudioContext||window.webkitAudioContext)();activePreviewContext=ctx;await ctx.resume();let now=ctx.currentTime+.05;for(let n of notes){let osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=freq(n.m);gain.gain.setValueAtTime(.0001,now+n.t);gain.gain.linearRampToValueAtTime(.14,now+n.t+.025);gain.gain.setValueAtTime(.14,now+n.t+Math.max(.025,n.d-.07));gain.gain.linearRampToValueAtTime(.0001,now+n.t+n.d);osc.connect(gain).connect(ctx.destination);osc.start(now+n.t);osc.stop(now+n.t+n.d+.02)}setTimeout(()=>{if(activePreviewContext===ctx){activePreviewContext=null;ctx.close().catch(()=>{})}},(Math.max(...notes.map(n=>n.t+n.d))+2)*1000)}catch(e){$('melody-warning').textContent='Playback unavailable: '+e.message}};
$('generate').onclick=async()=>{let file=$('file').files[0];if(!file){$('status').textContent='Choose a recording first.';return}let button=$('generate');button.disabled=true;$('status').textContent='Analyzing locally…';try{let ctx=new (window.AudioContext||window.webkitAudioContext)();decoded=await ctx.decodeAudioData(await file.arrayBuffer());await ctx.close();if(decoded.duration>40)throw Error('Use a recording shorter than 40 seconds.');notes=cleanDetect(decoded);if(notes.length<2)throw Error('Not enough stable notes found. Try humming more clearly without accompaniment.');original=clone(notes);selected=-1;undoStack=[];redoStack=[];draftKey='hth-draft-'+file.name+'-'+file.size+'-'+file.lastModified;try{const saved=JSON.parse(localStorage.getItem(draftKey)||'null');if(saved&&Array.isArray(saved.notes)&&saved.notes.every(n=>Number.isFinite(n.m)&&Number.isFinite(n.t)&&Number.isFinite(n.d)&&n.d>0)){notes=clone(saved.notes);$('status').textContent='Recovered saved note edits.'}}catch(e){}stage.hidden=false;$('outputs').hidden=true;render();$('status').textContent='Detection complete. Listen and correct the melody before arranging.';stage.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){$('status').textContent='Could not analyze: '+e.message}finally{button.disabled=false}};

const tools=document.createElement('div');tools.className='note-actions';tools.setAttribute('aria-label','Melody editing tools');
tools.innerHTML='<button type="button" id="add-note" class="secondary">+ Add note</button><button type="button" id="split-note" class="secondary">Split</button><button type="button" id="merge-notes" class="secondary">Merge next</button><button type="button" id="undo-edit" class="secondary">Undo</button><button type="button" id="redo-edit" class="secondary">Redo</button><button type="button" id="zoom-in" class="secondary">Zoom +</button><button type="button" id="zoom-out" class="secondary">Zoom −</button>';
$('note-info').before(tools);
$('add-note').onclick=()=>{checkpoint();let base=selected>=0?notes[selected]:notes[notes.length-1];let t=base?base.t+base.d+.05:0;let n={m:base?base.m:60,t,d:.35};notes.push(n);finish();selected=notes.indexOf(n);render()};
$('split-note').onclick=()=>{if(selected<0)return;let n=notes[selected];if(n.d<.15)return;checkpoint();let half=n.d/2;let added={m:n.m,t:n.t+half,d:half};n.d=half;notes.push(added);finish();selected=notes.indexOf(added);render()};
$('merge-notes').onclick=()=>{if(selected<0||selected>=notes.length-1)return;let n=notes[selected],next=notes[selected+1];if(n.m!==next.m){$('melody-warning').textContent='Merge requires the next note to have the same pitch. Change its pitch first.';return}checkpoint();n.d=Math.max(n.d,next.t+next.d-n.t);notes.splice(selected+1,1);finish();selected=notes.indexOf(n);render()};
$('undo-edit').onclick=()=>restoreHistory(undoStack,redoStack);
$('redo-edit').onclick=()=>restoreHistory(redoStack,undoStack);
$('zoom-in').onclick=()=>{zoom=Math.min(260,zoom+35);render()};
$('zoom-out').onclick=()=>{zoom=Math.max(55,zoom-35);render()};

$('approve-melody').onclick=()=>{if(!notes.length){$('melody-warning').textContent='At least one note is needed.';return}let tempo=+$('tempo').value,style=$('style').value;$('outputs').hidden=false;$('details').textContent=`${notes.length} approved notes · ${style} · ${tempo} BPM. Your corrected melody is used for every export.`;$('results').replaceChildren();['Faithful & intimate','Reharmonized & lifted','Low & atmospheric'].forEach((name,i)=>{let events=arrange(notes,i,style,tempo),wave=wav(synth(events)),mid=midi(events,tempo),url=URL.createObjectURL(wave),div=document.createElement('div');div.className='result';let title=document.createElement('strong');title.textContent=(i+1)+'. '+name;let player=document.createElement('audio');player.controls=true;player.src=url;let actions=document.createElement('div');actions.className='buttons';let w=document.createElement('button');w.textContent='Save WAV';w.onclick=()=>download(wave,'hum-to-harmony-'+(i+1)+'.wav');let m=document.createElement('button');m.className='secondary';m.textContent='Save MIDI';m.onclick=()=>download(mid,'hum-to-harmony-'+(i+1)+'.mid');actions.append(w,m);const stop=document.createElement('button');stop.type='button';stop.className='secondary';stop.textContent='■ Stop arrangement '+(i+1);stop.onclick=()=>{player.pause();player.currentTime=0};div.append(title,player,stop,actions);$('results').append(div)});$('outputs').scrollIntoView({behavior:'smooth',block:'start'})};
})();
