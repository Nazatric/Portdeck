import { inlineProject } from './importer';
import type { DeckProject, InlineFile } from './types';

function file(path: string, content: string): InlineFile {
  return { path, content };
}

const splitApp = `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
function App() {
  const [bill, setBill] = useState(86.5);
  const [tip, setTip] = useState(15);
  const [people, setPeople] = useState(2);
  const total = Number(bill || 0) * (1 + tip / 100);
  return <main><div className="eyebrow">TIP CALCULATOR</div><h1>Tip & Split</h1><p>Bill, tip, and individual totals.</p>
    <div className="paper"><label>Bill amount</label><div className="money"><span>$</span><input aria-label="Bill amount" type="number" min="0" value={bill} onChange={e => setBill(e.target.value)} /></div>
    <label>Tip</label><div className="choices">{[10,15,20,25].map(n => <button className={tip === n ? 'active' : ''} onClick={() => setTip(n)} key={n}>{n}%</button>)}</div>
    <div className="row"><label>People</label><div className="step"><button aria-label="Fewer people" onClick={() => setPeople(Math.max(1, people - 1))}>-</button><b>{people}</b><button aria-label="More people" onClick={() => setPeople(people + 1)}>+</button></div></div>
    <div className="total"><div><small>EACH PERSON PAYS</small><strong>\${(total / people).toFixed(2)}</strong></div><span>INCLUDING TIP</span></div></div></main>
}
createRoot(document.getElementById('root')).render(<App />);`;

const splitCss = `*{box-sizing:border-box}body{margin:0;background:#f4f4f1;color:#252825;font-family:Arial,sans-serif}main{max-width:440px;margin:auto;padding:42px 26px}.eyebrow,small{font-size:10px;letter-spacing:.12em;font-weight:700;color:#7c817b}h1{font-size:30px;font-weight:500;margin:14px 0 7px}p{font-size:13px;color:#858983;margin:0}.paper{margin-top:28px;padding:23px;background:#fff;border:1px solid #e2e4df}label{display:block;font-size:12px;font-weight:600;margin:0 0 10px}.money{display:flex;align-items:center;border-bottom:1px solid #d8dcd5;margin-bottom:24px;font-size:28px;color:#879484}.money input{width:100%;border:0;background:none;font:28px Arial;color:#29322b;padding:8px;outline:none}.choices{display:flex;gap:7px}.choices button,.step button{background:#f0f2ed;border:0;padding:10px 14px;color:#42503f;cursor:pointer}.choices button.active{background:#52624e;color:white}.row{display:flex;justify-content:space-between;align-items:center;margin:26px 0}.row label{margin:0}.step{display:flex;align-items:center;gap:13px}.step button{padding:5px 10px}.total{background:#344136;padding:20px;color:white;display:flex;justify-content:space-between;align-items:end}.total strong{display:block;font-size:30px;font-weight:500;margin-top:7px}.total span{font-size:9px;color:#b9c2b7}`;

const notesHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scratchpad</title><link rel="stylesheet" href="./style.css"></head><body><main><div class="top"><span>SCRATCHPAD</span><span>LOCAL NOTES</span></div><h1>Scratchpad</h1><p>Notes are saved on this device.</p><div class="note"><div class="note-top"><span>NOTE</span><span>AUTOSAVE</span></div><textarea id="note" aria-label="Note" placeholder="Write a note..."></textarea><div class="bottom"><span id="count">0 WORDS</span><button id="clear">CLEAR</button></div></div></main><script src="./app.js"></script></body></html>`;
const notesCss = `*{box-sizing:border-box}body{background:#f3f3f0;margin:0;color:#30332f;font-family:Arial,sans-serif}main{max-width:560px;margin:auto;padding:38px 25px}.top{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.12em;color:#858a82}h1{font-size:29px;font-weight:500;margin:45px 0 7px}p{color:#888c85;font-size:13px}.note{margin-top:27px;background:#fff;border:1px solid #e1e3de;min-height:290px;padding:20px}.note-top,.bottom{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.1em;color:#9a9e96}textarea{width:100%;min-height:210px;border:0;resize:vertical;outline:none;background:transparent;padding:25px 0;font:15px/1.6 Arial;color:#43473f}.bottom{border-top:1px solid #eceee9;padding-top:15px}button{background:none;border:0;font:inherit;color:#687363;cursor:pointer}`;
const notesJs = `const note=document.getElementById('note'), count=document.getElementById('count');
try { const saved=localStorage.getItem('scratchpad'); if(saved !== null) note.value=saved; } catch(e) {}
function update(){const words=note.value.trim().split(/\\s+/).filter(Boolean).length;count.textContent=words+' WORD'+(words===1?'':'S');try{localStorage.setItem('scratchpad',note.value)}catch(e){}}
note.addEventListener('input',update);document.getElementById('clear').addEventListener('click',()=>{note.value='';update();note.focus()});update();`;

const timerApp = `'use client';
import React, { useState, useEffect } from 'react';
import './style.css';
export default function Page(){
 const [mode,setMode]=useState('FOCUS'),[seconds,setSeconds]=useState(25*60),[running,setRunning]=useState(false),[sessions,setSessions]=useState(0);
 const modes={FOCUS:25,SHORT:5,LONG:15};
 useEffect(()=>{if(!running)return;const timer=setInterval(()=>setSeconds(s=>{if(s<=1){setRunning(false);setSessions(n=>n+1);return 0}return s-1}),1000);return()=>clearInterval(timer)},[running]);
 function change(m){setMode(m);setSeconds(modes[m]*60);setRunning(false)}
 const percent=seconds/(modes[mode]*60), time=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
 return <main><div className="top">FOCUS TIMER</div><h1>Focus Timer</h1><p>Choose a session length.</p><div className="tabs">{Object.keys(modes).map(m=><button key={m} className={m===mode?'active':''} onClick={()=>change(m)}>{m==='SHORT'?'SHORT BREAK':m==='LONG'?'LONG BREAK':m}</button>)}</div><div className="dial"><svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="108"/><circle className="progress" cx="120" cy="120" r="108" strokeDasharray="678.58" strokeDashoffset={678.58*(1-percent)}/></svg><div><strong>{time}</strong><small>{mode}</small></div></div><button className="start" onClick={()=>setRunning(!running)}>{running?'PAUSE':'START'}</button><div className="foot">SESSIONS <b>{String(sessions).padStart(2,'0')}</b></div></main>
}`;
const timerCss = `*{box-sizing:border-box}body{background:#f4f4f1;margin:0;color:#333733;font-family:Arial,sans-serif}main{max-width:420px;margin:auto;text-align:center;padding:34px 24px}.top{text-align:left;font-size:10px;letter-spacing:.12em;color:#81877f}h1{font-size:29px;font-weight:500;margin:48px 0 7px}p{font-size:13px;color:#8d918a}.tabs{display:flex;justify-content:center;gap:5px;margin:30px 0 22px}.tabs button{border:0;background:none;color:#92978f;padding:9px 10px;font-size:9px;cursor:pointer}.tabs button.active{background:#e3e6df;color:#4f5b4c}.dial{position:relative;width:230px;height:230px;margin:auto}.dial svg{transform:rotate(-90deg);width:100%}.dial circle{fill:none;stroke:#e0e3dc;stroke-width:3}.dial circle.progress{stroke:#75836f}.dial div{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center}.dial strong{font-size:48px;font-weight:400}.dial small{font-size:9px;color:#989d94;margin-top:8px}.start{margin:27px auto;background:#435044;color:white;padding:15px 30px;border:0;min-width:150px;font-size:11px;cursor:pointer}.foot{margin:30px auto 0;border-top:1px solid #e1e4dc;padding-top:18px;font-size:9px;color:#979c93}.foot b{margin-left:12px;color:#5c6658}`;

const definitions: { meta: Pick<DeckProject, 'id' | 'name' | 'framework' | 'entry'>; files: InlineFile[] }[] = [
  {
    meta: { id: 'demo-split', name: 'Tip & Split', framework: 'React', entry: 'index.html' },
    files: [
      file(
        'index.html',
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tip & Split</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
      ),
      file('package.json', JSON.stringify({ name: 'tip-and-split', dependencies: { react: '18.3.1', 'react-dom': '18.3.1' } }, null, 2)),
      file('src/main.jsx', splitApp),
      file('src/style.css', splitCss),
    ],
  },
  {
    meta: { id: 'demo-notes', name: 'Scratchpad', framework: 'HTML', entry: 'index.html' },
    files: [file('index.html', notesHtml), file('style.css', notesCss), file('app.js', notesJs)],
  },
  {
    meta: { id: 'demo-timer', name: 'Focus Timer', framework: 'Next.js', entry: 'app/page.jsx' },
    files: [
      file(
        'package.json',
        JSON.stringify({ name: 'focus-timer', dependencies: { next: '14.2.0', react: '18.3.1', 'react-dom': '18.3.1' } }, null, 2),
      ),
      file('app/page.jsx', timerApp),
      file('app/style.css', timerCss),
    ],
  },
];

const demos = definitions.map((definition) => inlineProject(definition.meta, definition.files));
export const demoProjects: DeckProject[] = demos.map((demo) => demo.project);
export const demoBlobs = new Map(demos.map((demo) => [demo.project.id, demo.blobs]));
/** Inline sources, exported to the native apps as demos.json. */
export const demoSources = demos.map((demo, index) => ({
  ...demo.project,
  files: definitions[index].files.map((item) => ({
    ...item,
    size: new TextEncoder().encode(item.content).length,
    type: demo.project.files.find((entry) => entry.path === item.path)?.type ?? '',
  })),
}));
