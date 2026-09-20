
export function playUrgentJobAlert() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    
    // Distinctive 3-tone cash/success chime
    const tones = [
      { freq: 784, start: 0, duration: 0.12 },     // G5
      { freq: 1046.5, start: 0.12, duration: 0.14 }, // C6
      { freq: 1567.98, start: 0.26, duration: 0.35 } // G6 (Loud & Clear)
    ];

    tones.forEach(t => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(t.freq, now + t.start);
      gain.gain.setValueAtTime(0.9, now + t.start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.start + t.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.duration);
    });
  } catch (e) {
    console.warn('Audio alert could not play:', e);
  }
}
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Brain, Plus, Search, Check, Clock, FileText, ArrowRight, RefreshCw } from 'lucide-react';
import type { TaskRecord, TaskStatus, WaitingItem, EventRecord } from '../src/types';
import type { MorningBrief, EveningReview } from '../src/services/briefs';
import './styles.css';
import { Settings, MemoryView, ImportView, SignIn } from './setup';

import { api } from './api';
import { Calendar, UrgentMode, SearchView, InstallButton, enablePush } from './extras';

export function getEventDirectLink(event?: EventRecord) {
  if (!event) return null;
  if (event.source === 'gmail') {
    const threadId = event.metadata?.threadId || event.source_id;
    return {
      label: 'Megnyitás Gmailben ↗',
      url: threadId ? `https://mail.google.com/mail/u/0/#inbox/${threadId}` : 'https://mail.google.com'
    };
  }
  if (event.source === 'calendar') {
    return {
      label: 'Megnyitás Naptárban ↗',
      url: event.metadata?.htmlLink || 'https://calendar.google.com'
    };
  }
  if (event.source === 'zoofy') {
    return {
      label: 'Megnyitás Zoofy-ban ↗',
      url: 'https://vakman.zoofy.nl'
    };
  }
  if (event.source === 'whatsapp') {
    const cleanPhone = (event.sender || '').replace(/[^0-9+]/g, '');
    const url = cleanPhone.length >= 8 ? `https://wa.me/${cleanPhone.replace('+', '')}` : 'https://web.whatsapp.com';
    return {
      label: 'Megnyitás WhatsAppban ↗',
      url
    };
  }
  if (event.source === 'lodgify') {
    return {
      label: 'Megnyitás Lodgify-ban ↗',
      url: 'https://app.lodgify.com'
    };
  }
  return null;
}

const horizons: [string, string][] = [['all', 'Összes'], ['now', 'Most'], ['today', 'Ma'], ['tomorrow', 'Holnap'], ['next_7_days', 'Következő 7 nap'], ['later', 'Később'], ['done', 'Kész']];
const priorities = { CRITICAL: 'Sürgős', HIGH: 'Fontos', NORMAL: 'Normál', LOW: 'Alacsony' };

function App() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [waiting, setWaiting] = useState<WaitingItem[]>([]);
  const [horizon, setHorizon] = useState(new URLSearchParams(location.search).get('tab') === 'now' ? 'now' : 'all');
  const [page, setPage] = useState(['waiting','settings','memory','import'].includes(new URLSearchParams(location.search).get('tab')||'') ? new URLSearchParams(location.search).get('tab')! : 'tasks');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TaskRecord | null>(null);
  const [draft, setDraft] = useState('');
  const [capture, setCapture] = useState(false);
  const [intakeType,setIntakeType] = useState('text');
  const [attachment,setAttachment] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [review, setReview] = useState<EveningReview | null>(null);

  async function refresh() {
    const [taskData, waitingData] = await Promise.all([api<{tasks: TaskRecord[]}>('/tasks'), api<{waiting_items: WaitingItem[]}>('/waiting')]);
    const previousTaskIds = new Set(tasks.map(t => t.id));
    const hasNewAutoAccepted = taskData.tasks.some(t => !previousTaskIds.has(t.id) && t.title.includes('ZOOFY [AUTO-ELFOGADVA]'));
    if (tasks.length > 0 && hasNewAutoAccepted) {
      playUrgentJobAlert();
    }
    setTasks(taskData.tasks); setWaiting(waitingData.waiting_items);
  }
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!selected && !capture) return;
    const previous=document.activeElement as HTMLElement | null;
    const dialog=document.querySelector<HTMLElement>('[role=dialog]');
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,[tabindex="0"]') || []);
    focusable()[0]?.focus();
    const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const items=focusable();const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
    document.addEventListener('keydown',trap);
    return()=>{document.removeEventListener('keydown',trap);previous?.focus();};
  },[selected?.id,capture]);
  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && !busy) { setSelected(null); setCapture(false); } }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Ismeretlen hiba.'); }
    finally { setBusy(false); }
  }
  async function status(task: TaskRecord, status: TaskStatus) {
    await run(async () => { await api(`/tasks/${encodeURIComponent(task.id)}/status`, { status }); await refresh(); setSelected(null); setNotice('Feladat frissítve.'); });
  }
  async function openTask(task: TaskRecord) {
    await run(async () => {
      const data = await api<{ task: TaskRecord }>(`/tasks/${encodeURIComponent(task.id)}`);
      setSelected(data.task); setDraft(data.task.draft_reply || '');
    });
  }
  const active = tasks.filter(t => !['done', 'ignored'].includes(t.status));
  const filtered = tasks.filter(t => (horizon === 'all' ? !['done', 'ignored'].includes(t.status) : t.status === horizon)
    && `${t.title} ${t.summary} ${t.project_category} ${t.people_involved?.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].indexOf(a.priority) - ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].indexOf(b.priority));

  return <div className="app">
    <aside><a className="brand" href="/"><Brain size={30}/> MyBrain<span>személyes asszisztens</span></a>
      <p className="nav-label">MUNKATERÜLET</p>
      <nav>{[['tasks','Feladataim'], ['waiting','Válaszra várok'], ['brief','Napi áttekintés'], ['calendar','Naptár'], ['search','Keresés'], ['urgent','Sürgős mód'], ['settings','Beállítások'], ['memory','Memória'], ['import','Importálás']].map(([key,label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => { setPage(key); if (key === 'brief') void run(async () => { const [a,b] = await Promise.all([api<{brief: MorningBrief}>('/briefs/morning'), api<{review: EveningReview}>('/briefs/evening')]); setBrief(a.brief); setReview(b.review); }); }}>{label}<ArrowRight size={16}/></button>)}</nav>
      <div className="sidebar-note"><span className="dot"/> Saját munkatér<p>Gyűjtsd egy helyre, ami figyelmet kér.</p></div>
    </aside>
    <main>
      <header><InstallButton/><span>{new Intl.DateTimeFormat('hu-HU', {month:'long',day:'numeric',weekday:'long'}).format(new Date())}</span><button disabled={busy} onClick={() => void run(refresh)} aria-label="Frissítés"><RefreshCw size={17}/></button></header>
      <div className="heading"><div><p className="eyebrow">KEVESEBB ZAJ. TÖBB FIGYELEM.</p><h1>{page === 'tasks' ? 'Mivel foglalkozz most?' : ({waiting:'Válaszra várva',brief:'A napod egy helyen',calendar:'Előtted a hét',urgent:'Amikor nem várhat',search:'Találd meg a részleteket',settings:'A te munkatered',memory:'Amit megjegyeztünk',import:'A te döntésed, mit olvasson' }[page] || 'MyBrain')}</h1><p className="muted">{page === 'tasks' ? 'Egy tiszta következő lépés minden feladathoz.' : 'Tartsd szem előtt a következő lépéseket.'}</p></div><button className="primary" onClick={() => setCapture(true)}><Plus size={18}/> Új jegyzet</button></div>
      {error && <div className="error" role="alert">{error} <button disabled={busy} onClick={() => void run(refresh)}>Újrapróbálás</button></div>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {active.some(t=>t.urgent_flag)&&<div className="alert-banner" role="alert">Sürgős figyelmet igényel: {active.filter(t=>t.urgent_flag).map(t=>t.title).join(' · ')}</div>}
      {loading ? <div className="empty" role="status">Feladatok betöltése…</div> : page === 'calendar' ? <Calendar tasks={tasks} open={t=>void openTask(t)}/> : page === 'urgent' ? <UrgentMode run={run}/> : page === 'search' ? <SearchView run={run} open={t=>void openTask(t)}/> : page === 'memory' ? <MemoryView run={run}/> : page === 'import' ? <ImportView run={run} refresh={refresh}/> : page === 'settings' ? <Settings run={run} refresh={refresh}/> : page === 'tasks' ? <>
        <div className="toolbar"><div className="tabs">{horizons.map(([key,label]) => <button key={key} className={horizon === key ? 'chosen' : ''} onClick={() => setHorizon(key)}>{label}</button>)}</div><label className="search"><Search size={17}/><input aria-label="Feladatok keresése" placeholder="Keresés…" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
        <div className="task-list">{filtered.map(task => {
          const firstEvent = task.events?.[0];
          const directLink = getEventDirectLink(firstEvent);
          return (
            <article key={task.id} className="task">
              <button className="complete" aria-label={`${task.title} készre jelölése`} disabled={busy || task.status === 'done'} onClick={() => void status(task, 'done')}><Check size={17}/></button>
              <div className="task-body" onClick={() => void openTask(task)}>
                <div className="meta">
                  <span className={`badge ${task.priority}`}>{priorities[task.priority]}</span>
                  <span>{task.project_category}</span>
                  <span>{Math.round(task.confidence*100)}% bizalom</span>
                  <span>{firstEvent?.source || 'Beérkező esemény'}</span>
                  {task.deadline && <span>{new Date(task.deadline).toLocaleDateString('hu-HU')}</span>}
                  {directLink && (
                    <a 
                      href={directLink.url} 
                      target="_blank" 
                      rel="noreferrer noopener" 
                      className="source-direct-link"
                      onClick={e => e.stopPropagation()}
                    >
                      {directLink.label}
                    </a>
                  )}
                </div>
                <h2>{task.title}</h2>
                <p className="task-reason">{task.priority_reason}</p>
                
                {firstEvent && firstEvent.raw_content && (
                  <div className="task-snippet">
                    <div className="task-snippet-header">
                      <span className="task-snippet-sender">
                        📩 <strong>{firstEvent.sender}</strong>
                        {firstEvent.subject ? ` · ${firstEvent.subject}` : ''}
                      </span>
                    </div>
                    <div className="task-snippet-text">{firstEvent.raw_content.slice(0, 240)}{firstEvent.raw_content.length > 240 ? '…' : ''}</div>
                  </div>
                )}

                <div className="next"><ArrowRight size={14}/><span><strong>Teendő:</strong> {task.suggested_action}</span></div>
              </div>
              <div className="card-actions">
                <button disabled={busy} onClick={()=>void status(task,'done')}>Kész</button>
                <button disabled={busy} onClick={()=>void openTask(task)}>Tervezet</button>
                <button disabled={busy} onClick={()=>void run(async()=>{await api(`/tasks/${encodeURIComponent(task.id)}/commander`,{action:'later',snoozeHours:24});await refresh();})}>Holnap</button>
                <button disabled={busy} onClick={()=>void status(task,'ignored')}>Elvetés</button>
              </div>
              <button className="detail-button" disabled={busy} aria-label={`${task.title} részletei`} onClick={() => void openTask(task)}><ArrowRight size={20}/></button>
            </article>
          );
        })}{filtered.length === 0 && <div className="empty">Itt most nincs feladat. Hozz létre egy jegyzetet, vagy csatlakoztasd a forrásaidat.<p><button onClick={()=>setPage('settings')}>AI és Google beállítása</button></p></div>}</div>
      </> : page === 'waiting' ? <div className="task-list">{waiting.filter(w => w.status === 'active').map(item => <article className="waiting task" key={item.id}><div><span className="badge">{item.waiting_for}</span><h2>{item.item_description}</h2><p className="muted">Várakozás kezdete: {new Date(item.since_date).toLocaleDateString('hu-HU')}</p></div><button disabled={busy} onClick={() => void run(async () => { await api(`/waiting/${encodeURIComponent(item.id)}/resolve`, {}); await refresh(); })}><Check size={16}/> Megérkezett</button></article>)}{!waiting.some(w => w.status === 'active') && <div className="empty">Nincs függőben lévő válasz.</div>}</div> : <div className="briefs"><div className="notification-actions"><button disabled={busy} onClick={()=>void run(async()=>{await enablePush();setNotice('Push értesítések bekapcsolva.');})}>Push értesítések bekapcsolása</button><button disabled={busy} onClick={()=>void run(async()=>{await api('/push/test',{kind:'morning'});setNotice('Reggeli értesítés elküldve.');})}>Reggeli push teszt</button><button disabled={busy} onClick={()=>void run(async()=>{await api('/push/test',{kind:'evening'});setNotice('Esti értesítés elküldve.');})}>Esti push teszt</button></div><section><h2>Reggeli áttekintés</h2>{brief ? <><p>{brief.headline}</p>{[...brief.critical, ...brief.important_today.filter(t => !brief.critical.some(c => c.id === t.id))].map(t => <button key={t.id} disabled={busy} onClick={() => void openTask(t)}>{t.title}<ArrowRight size={16}/></button>)}</> : <p>Áttekintés betöltése…</p>}</section><section><h2>Esti lezárás</h2>{review ? <><p>{review.headline}</p>{review.tasks_left_open.map(({task,estimated_time_minutes}) => <button key={task.id} disabled={busy} onClick={() => void openTask(task)}>{task.title}<span>~{estimated_time_minutes} perc</span></button>)}</> : <p>Áttekintés betöltése…</p>}</section></div>}
      <footer>A feladat készre jelölése helyben történik. A választervezeteket te küldöd el.</footer>
    </main>
    {(selected || capture) && <div className="overlay" onClick={e => { if (e.target === e.currentTarget && !busy) { setSelected(null); setCapture(false); } }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="close" disabled={busy} aria-label="Bezárás" onClick={() => { setSelected(null); setCapture(false); }}>×</button>
      {capture ? <form onSubmit={e => { e.preventDefault(); void run(async () => { let attachmentId: string | undefined; if(attachment){const form=new FormData();form.append('file',attachment);attachmentId=(await api<{id:string}>('/attachments',form)).id;} const captured = await api<{task?:TaskRecord}>('/events/manual', {type:intakeType, content:note.trim(),attachmentId}); setAttachment(null); await refresh(); setNote(''); setCapture(false); setPage('tasks'); setHorizon('all'); setNotice(captured.task ? 'A jegyzetből elkészült a feladat.' : 'A jegyzet elmentve. Az elemző nem talált külön teendőt.'); }); }}><p className="eyebrow">GYORS RÖGZÍTÉS</p><h2 id="dialog-title">Mi jár a fejedben?</h2><label htmlFor="intake-type">Rögzítés módja</label><select id="intake-type" value={intakeType} onChange={e=>{setIntakeType(e.target.value);setAttachment(null);}}><option value="text">Szöveges jegyzet</option><option value="forward">Továbbított üzenet</option><option value="voice">Hangjegyzet szimuláció (szöveges átirat)</option><option value="image">Kép és szöveges leírás</option></select>{intakeType==='image'&&<><label htmlFor="attachment">Kép (JPEG, PNG vagy WebP, legfeljebb 5 MB)</label><input id="attachment" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setAttachment(e.target.files?.[0]||null)}/><p className="muted">A képet mellékletként mentjük. Az elemzés a megadott szövegre épül.</p></>}<label htmlFor="note">Feladat, átirat vagy továbbított üzenet</label><textarea id="note" autoFocus required value={note} onChange={e => setNote(e.target.value)} placeholder="Például: holnap válaszolnom kell Tom ajánlatára…"/><button className="primary" disabled={busy || !note.trim()}>{busy ? 'Feldolgozás…' : 'Feladat létrehozása'}</button></form> : selected && <>
        <div className="dialog-header-meta">
          <span className={`badge ${selected.priority}`}>{priorities[selected.priority]}</span>
          <span className="dialog-category">{selected.project_category}</span>
          {selected.events?.[0] && getEventDirectLink(selected.events[0]) && (
            <a 
              href={getEventDirectLink(selected.events[0])!.url} 
              target="_blank" 
              rel="noreferrer noopener" 
              className="source-direct-link-dialog"
            >
              {getEventDirectLink(selected.events[0])!.label}
            </a>
          )}
        </div>
        <h2 id="dialog-title">{selected.title}</h2>
        <p>{selected.summary}</p>

        <h3>📩 Eredeti üzenet és Forrás</h3>
        {selected.events && selected.events.length > 0 ? (
          selected.events.map(event => {
            const link = getEventDirectLink(event);
            return (
              <div key={event.id} className="dialog-event-card">
                <div className="dialog-event-header">
                  <div>
                    <strong>{event.sender}</strong>
                    {event.subject ? <span className="dialog-event-subject"> · {event.subject}</span> : ''}
                    <span className="dialog-event-time"> ({new Date(event.received_at).toLocaleString('hu-HU')})</span>
                  </div>
                  {link && (
                    <a href={link.url} target="_blank" rel="noreferrer noopener" className="source-direct-link">
                      {link.label}
                    </a>
                  )}
                </div>
                <div className="source-text">{event.raw_content}</div>
              </div>
            );
          })
        ) : (
          <p className="muted">Nincs rögzített eredeti forrásüzenet.</p>
        )}

        <h3>Miért fontos?</h3>
        <p>{selected.priority_reason}</p>
        <h3>Következő lépés</h3>
        <p>{selected.next_step || selected.suggested_action}</p>
        <label htmlFor="draft"><FileText size={16}/> Választervezet</label>
        <textarea id="draft" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ehhez a feladathoz még nincs választervezet."/>
        <div className="dialog-actions-row">
          <button disabled={busy} onClick={() => void run(async () => { await api(`/tasks/${encodeURIComponent(selected.id)}/commander`, {action:'draft', draftEdit:draft}); setNotice('Választervezet elmentve.'); })}>Tervezet mentése</button>
          <button disabled={busy || !draft} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(draft);setNotice('Tervezet másolva. A megfelelő alkalmazásban átnézheted és elküldheted.');})}>Másolás kézi küldéshez</button>
        </div>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => void status(selected,'done')}><Check size={16}/> Készre jelölés</button>
          <button disabled={busy} onClick={() => void run(async () => { await api(`/tasks/${encodeURIComponent(selected.id)}/commander`,{action:'later',snoozeHours:24}); await refresh(); setSelected(null); })}><Clock size={16}/> Holnap</button>
          <button disabled={busy} onClick={() => void status(selected,'ignored')}>Elvetés</button>
        </div>
      </>}
      {error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </section></div>}
  </div>;
}
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>undefined);});
function Root(){
  const [ready,setReady]=useState<boolean|null>(null);const [error,setError]=useState('');
  useEffect(()=>{api<{authenticated:boolean;configured:boolean}>('/auth/session').then(data=>{setReady(data.authenticated);if(!data.configured)setError('A szerveren még nincs beállítva az APP_SECRET hozzáférési kulcs.');}).catch(()=>{if(!navigator.onLine)setReady(true);else setError('A szerver még nem érhető el. Frissítsd az oldalt, vagy ellenőrizd a telepítést.');});},[]);
  if(error)return <main className="login"><section className="panel"><h1>MyBrain</h1><p role="alert">{error}</p><button onClick={()=>location.reload()}>Újrapróbálás</button></section></main>;
  if(ready===null)return <p className="empty">MyBrain betöltése…</p>;
  return ready?<App/>:<SignIn onReady={()=>setReady(true)}/>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
