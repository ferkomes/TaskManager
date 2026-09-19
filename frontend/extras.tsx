import { useEffect, useRef, useState } from 'react';
import type { TaskRecord, EventRecord, CallerContact } from '../src/types';
import type { UrgentEvaluationResult } from '../src/services/urgentCorrelator';
import { api } from './api';

type Run = (action: () => Promise<void>) => Promise<void>;
export function Calendar({tasks,open}:{tasks:TaskRecord[];open:(task:TaskRecord)=>void}) {
  const [offset,setOffset] = useState(0);
  const touch = useRef<number | null>(null);
  const day = new Date(); day.setDate(day.getDate()+offset);
  const dateKey = (date:Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const items = tasks.filter(t => t.status !== 'done' && t.status !== 'ignored' && t.deadline && dateKey(new Date(t.deadline)) === dateKey(day));
  return <section onTouchStart={e => {touch.current=e.touches[0].clientX;}} onTouchEnd={e => {if(touch.current !== null){const delta=e.changedTouches[0].clientX-touch.current;if(Math.abs(delta)>60)setOffset(n=>n+(delta<0?1:-1));}touch.current=null;}}><div className="agenda-controls"><button onClick={()=>setOffset(n=>n-1)} aria-label="Előző nap">←</button><h2>{day.toLocaleDateString('hu-HU',{weekday:'long',month:'long',day:'numeric'})}</h2><button onClick={()=>setOffset(n=>n+1)} aria-label="Következő nap">→</button><button onClick={()=>setOffset(0)}>Ma</button></div><div className="task-list">{items.map(t=><button className="task agenda-item" key={t.id} onClick={()=>open(t)}><span className={`badge ${t.priority}`}>{t.priority}</span><span>{t.title}</span><time>{new Date(t.deadline!).toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'})}</time></button>)}{!items.length&&<p className="empty">Erre a napra nincs határidős feladat.</p>}</div><p className="muted">Húzd balra vagy jobbra a napváltáshoz. A nézet a feladatok határidejét mutatja.</p></section>;
}
export function UrgentMode({run}:{run:Run}) {
  const [phone,setPhone]=useState('+34612345678');const [count,setCount]=useState(2);const [hour,setHour]=useState(23);const [message,setMessage]=useState('We are locked out, please help!');const [result,setResult]=useState<UrgentEvaluationResult|null>(null);
  return <section className="panel"><h2>Éjszakai hívás szimulációja</h2><p className="muted">Próbahívás a vendégnyilvántartás alapján. Nem indít valódi telefonhívást.</p><form onSubmit={e=>{e.preventDefault();void run(async()=>{setResult((await api<{result:UrgentEvaluationResult}>('/urgent/check-caller',{phone_number:phone,call_count:count,simulate_hour:hour,message_snippet:message})).result);});}}><label>Telefonszám<input required value={phone} onChange={e=>setPhone(e.target.value)}/></label><div className="field-row"><label>Hívások 15 perc alatt<input type="number" min="1" max="100" value={count} onChange={e=>setCount(Number(e.target.value))}/></label><label>Óra (0–23)<input type="number" min="0" max="23" value={hour} onChange={e=>setHour(Number(e.target.value))}/></label></div><label>Üzenetrészlet<textarea value={message} onChange={e=>setMessage(e.target.value)}/></label><button className="primary">Bejövő hívás tesztelése</button></form>{result&&<div className={result.isUrgent?'alert-banner':'notice'} role="status"><h3>{result.isUrgent?'SÜRGŐS · Azonnali figyelem':'Normál hívás'}</h3><p>{result.alertReason}</p><p>{result.recommendedAction}</p>{result.matchedContact&&<p>Azonosított vendég: {result.matchedContact.guest_name}</p>}</div>}</section>;
}
type SearchHit = {type:'task';item:TaskRecord;score:number}|{type:'event';item:EventRecord;score:number}|{type:'contact';item:CallerContact;score:number};
export function SearchView({run,open}:{run:Run;open:(task:TaskRecord)=>void}) {
  const [query,setQuery]=useState('');const [hits,setHits]=useState<SearchHit[]|null>(null);
  function search(q:string){setQuery(q);void run(async()=>setHits((await api<{results:SearchHit[]}>(`/search?q=${encodeURIComponent(q)}`)).results));}
  return <section><form className="field-row" onSubmit={e=>{e.preventDefault();search(query);}}><input className="wide-input" required placeholder="Kérdezz a feladatokról, üzenetekről vagy vendégekről…" aria-label="Keresőkérdés" value={query} onChange={e=>setQuery(e.target.value)}/><button className="primary">Keresés</button></form><div className="preset-searches">{['What did Tom say about cast iron grates?', "What do I need to do for tomorrow’s Tenerife arrivals?", 'Which messages have I not answered?'].map(q=><button key={q} onClick={()=>search(q)}>{q}</button>)}</div><p className="muted">Kulcsszavak és kérdésminták alapján keres a feladatok, eredeti üzenetek és kapcsolatok között.</p><div className="task-list">{hits?.map(hit=><article className="task" key={`${hit.type}-${hit.item.id}`}>{hit.type==='task'?<button className="task-body" onClick={()=>open(hit.item)}><span className="badge">Feladat</span><h2>{hit.item.title}</h2><p>{hit.item.summary}</p></button>:hit.type==='event'?<div><span className="badge">{hit.item.source} · {hit.item.sender}</span><h2>{hit.item.subject}</h2><p className="source-text">{hit.item.raw_content}</p></div>:<div><span className="badge">Kapcsolat</span><h2>{hit.item.guest_name}</h2><p>{hit.item.phone_number} · {hit.item.property_name}</p></div>}</article>)}{hits?.length===0&&<p className="empty">Nincs találat erre a kérdésre.</p>}</div></section>;
}
interface InstallEvent extends Event {prompt():Promise<void>;userChoice:Promise<{outcome:string}>}
export function InstallButton(){const [prompt,setPrompt]=useState<InstallEvent|null>(null);useEffect(()=>{const handler=(e:Event)=>{e.preventDefault();setPrompt(e as InstallEvent);};window.addEventListener('beforeinstallprompt',handler);return()=>window.removeEventListener('beforeinstallprompt',handler);},[]);if(!prompt)return null;return <button onClick={async()=>{await prompt.prompt();await prompt.userChoice;setPrompt(null);}}>Alkalmazás telepítése</button>;}
export async function enablePush(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw new Error('Ez a böngésző nem támogatja a push értesítéseket. iPhone-on telepítsd az alkalmazást a főképernyőre.');
  const config=await api<{publicKey:string}>('/push/config');
  if(await Notification.requestPermission()!=='granted')throw new Error('Az értesítési engedély nem lett megadva.');
  await navigator.serviceWorker.register('/sw.js');
  const registration=await navigator.serviceWorker.ready;
  const bytes=Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
  await api('/push/subscribe',subscription.toJSON());
}
