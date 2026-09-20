import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {MemoryExample} from '../src/services/memory';
interface SyncState {pending:number;processing:number;done:number;failed:number;initialComplete:boolean;errors?:string[];last:null|{at:string;results:{source:string;success:boolean;count:number;message?:string}[]}}
interface SetupState {
  provider: string;
  model?: string;
  configured: Record<string, boolean>;
  aiReady: boolean;
  googleReady: boolean;
  googleConfigured: boolean;
  callbackUrl: string;
  learnDrafts: boolean;
  sync: SyncState;
  demo: boolean;
  zoofy?: {
    configured: boolean;
    phone: string;
    hasToken: boolean;
    autoAccept: boolean;
    minPrice: string;
    maxDistanceKm: string;
    keywords: string;
    whatsappTemplate: string;
    aiInstruction: string;
  };
}
type Run=(action:()=>Promise<void>)=>Promise<void>;

export function SignIn({onReady}:{onReady:()=>void}){
  const [key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <main className="login"><section className="panel"><p className="eyebrow">MYBRAIN · SAJÁT MUNKATÉR</p><h1>Üdv újra!</h1><p className="muted">A személyes leveleid és memóriád megnyitásához add meg a MyBrain hozzáférési kulcsodat. Ez nem a Google-jelszavad és nem az AI API-kulcsa.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api('/auth/login',{token:key});setKey('');onReady();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>MyBrain hozzáférési kulcs<input autoFocus required type="password" autoComplete="current-password" value={key} onChange={e=>setKey(e.target.value)}/></label><button className="primary" disabled={busy}>{busy?'Belépés…':'Belépés'}</button></form>{error&&<p className="error" role="alert">{error}</p>}<p className="muted">A bejelentkezés ezen az eszközön 30 napig megmarad.</p></section></main>;
}

export function SyncProgress({refresh,autoStart=false}:{refresh:()=>Promise<void>;autoStart?:boolean}){
  const [state,setState]=useState<SyncState|null>(null),[error,setError]=useState(''),[starting,setStarting]=useState(false);
  const requested=useRef(false);
  async function start(){setStarting(true);setError('');try{setState(await api<SyncState>('/sync/start',{}));}catch(e){setError((e as Error).message);}finally{setStarting(false);}}
  useEffect(()=>{if(autoStart&&!requested.current){requested.current=true;void start();}},[autoStart]);
  useEffect(()=>{
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    async function tick(){try{let result=await api<SyncState>('/sync/status');if(result.pending||result.processing){result=await api<SyncState>('/sync/process',{});if(!cancelled)await refresh();}if(!cancelled){setState(result);setError('');}}catch(e){if(!cancelled)setError((e as Error).message);}finally{if(!cancelled)timer=setTimeout(tick,2500);}}
    timer=setTimeout(tick,400);return()=>{cancelled=true;clearTimeout(timer);};
  },[]);
  return <div className="sync-box"><h3>Első szinkronizálás és háttérfigyelés</h3><p className="muted">Az AI-kulcs és a Google-engedély után automatikusan elindul. Első kör: 30 napból a legutóbbi 20 beérkező levél; a következő 30 nap legfeljebb 50 eseménye az elsődleges naptárból. A szövegeket a kiválasztott AI dolgozza fel.</p>{state&&<p role="status">{starting?'Források beolvasása…':state.pending||state.processing?'AI-lista készül…':state.failed?'Néhány elemhez újrapróbálás szükséges.':state.initialComplete?'Szinkronizálva. Az új elemek ellenőrzése 15 percenként történik.':'Csatlakoztasd a forrásaidat az induláshoz.'} {state.done} feldolgozva · {state.pending+state.processing} várakozik{state.failed?` · ${state.failed} sikertelen`:''}</p>}{state?.last?.results.filter(r=>!r.success).map(r=><p className="error" key={r.source}>{r.source}: {r.message}</p>)}{state?.errors&&state.errors.length>0&&state.errors.map((err,idx)=><p className="error" key={idx}>AI Hiba: {err}</p>)}<div className="actions"><button disabled={starting} onClick={()=>void start()}>Szinkronizálás most</button>{!!state?.failed&&<button onClick={async()=>{try{setState(await api<SyncState>('/sync/retry',{}));}catch(e){setError((e as Error).message);}}}>Sikertelen elemek újrapróbálása</button>}</div>{error&&<p className="error" role="alert">{error}</p>}</div>;
}

export function Settings({run,refresh}:{run:Run;refresh:()=>Promise<void>}){
  const [setup,setSetup]=useState<SetupState|null>(null),[provider,setProvider]=useState('openai'),[model,setModel]=useState(''),[key,setKey]=useState(''),[message,setMessage]=useState(''),[aiTestMessage,setAiTestMessage]=useState(''),[aiTesting,setAiTesting]=useState(false),[google,setGoogle]=useState({GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''});
  const [zoofyPhone, setZoofyPhone] = useState('');
  const [zoofyCode, setZoofyCode] = useState('');
  const [zoofyAutoAccept, setZoofyAutoAccept] = useState(true);
  const [zoofyMinPrice, setZoofyMinPrice] = useState('150');
  const [zoofyMaxDist, setZoofyMaxDist] = useState('15');
  const [zoofyKeywords, setZoofyKeywords] = useState('meubel, bútor, ikea, pax, kast, villanyszerelés, elektra, loodgieter');
  const [zoofyTemplate, setZoofyTemplate] = useState('Beste, bedankt voor de opdracht via Zoofy! Ik heb de klus zojuist geaccepteerd. Schikt het opgegeven moment voor u, of zullen we even overleggen over egy andere dag/tijd die u beter past? Met vriendelijke groet, Ferenc');
  const [zoofyInstruction, setZoofyInstruction] = useState('Bútor összeszerelés és villanyszerelés munkák automatikus elfogadása 150 EUR felett és 15 km-en belül.');
  const [zoofyStatusMsg, setZoofyStatusMsg] = useState('');
  const [zoofyTesting, setZoofyTesting] = useState(false);
  async function load(){const data=await api<SetupState>('/settings');setSetup(data);setProvider(data.provider);setModel(data.model||'');
    if (data.zoofy) {
      setZoofyPhone(data.zoofy.phone || '');
      setZoofyAutoAccept(data.zoofy.autoAccept);
      setZoofyMinPrice(data.zoofy.minPrice || '150');
      setZoofyMaxDist(data.zoofy.maxDistanceKm || '15');
      setZoofyKeywords(data.zoofy.keywords || 'meubel, bútor, ikea, pax, kast, villanyszerelés, elektra, loodgieter');
      setZoofyTemplate(data.zoofy.whatsappTemplate || 'Beste, bedankt voor de opdracht via Zoofy! Ik heb de klus zojuist geaccepteerd. Schikt het opgegeven moment voor u, of zullen we even overleggen over een andere dag/tijd die u beter past? Met vriendelijke groet, Ferenc');
      setZoofyInstruction(data.zoofy.aiInstruction || 'Bútor összeszerelés és villanyszerelés munkák automatikus elfogadása 150 EUR felett és 15 km-en belül.');
    }}
  useEffect(()=>{void run(load);const url=new URL(location.href);if(url.searchParams.get('google')==='connected')setMessage('A Google-fiók csatlakoztatva.');if(url.searchParams.get('google')==='error')setMessage(url.searchParams.get('reason')||'A kapcsolódás nem sikerült.');if(url.searchParams.has('google')){url.searchParams.delete('google');url.searchParams.delete('reason');history.replaceState(null,'',url);}},[]);
  return <section className="panel setup"><h2>Kapcsolatok és beállítások</h2><p className="muted">Válassz AI-t, engedélyezd a források olvasását, és elkészül a személyes teendőlistád.</p>
    <section className="setup-step"><span className="step-number">1</span><h3>Az AI-d</h3><form onSubmit={e=>{e.preventDefault();void run(async()=>{const changes:Record<string,string>={AI_PROVIDER:provider};if(key.trim())changes[provider==='openai'?'OPENAI_API_KEY':'GEMINI_API_KEY']=key.trim();if(model.trim())changes[provider==='openai'?'OPENAI_MODEL':'GEMINI_MODEL']=model.trim();await api('/settings',changes);setKey('');await load();setMessage('AI-beállítások elmentve.');});}}><div className="field-row"><label>AI-szolgáltató<select value={provider} onChange={e=>{setProvider(e.target.value);setModel('');setKey('');}}><option value="openai">OpenAI</option><option value="gemini">Google Gemini (Ingyenes & Gyors)</option></select></label><label>Modell neve<input value={model} onChange={e=>setModel(e.target.value)} placeholder={provider==='openai'?'gpt-4o-mini':'gemini-1.5-flash'}/></label></div><label>{provider==='openai'?'OpenAI':'Gemini'} API-kulcs {setup?.configured[provider==='openai'?'OPENAI_API_KEY':'GEMINI_API_KEY']&&<span className="configured">· már elmentve</span>}<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="Üresen hagyva a meglévő kulcs megmarad"/></label><div className="actions"><button className="primary">AI mentése</button><button type="button" disabled={aiTesting} onClick={async()=>{setAiTesting(true);setAiTestMessage('AI tesztelése folyamatban…');try{const res=await api<{ok:boolean;message?:string;error?:string}>('/settings/test-ai',{provider,key:key.trim()||undefined,model:model.trim()||undefined});if(res.ok)setAiTestMessage('✓ Sikeres AI kapcsolat!');else setAiTestMessage(`✕ Hiba: ${res.error}`);}catch(err){setAiTestMessage(`✕ Hiba: ${(err as Error).message}`);}finally{setAiTesting(false);}}}>{aiTesting?'Tesztelés…':'AI Kulcs Tesztelése'}</button></div>{aiTestMessage&&<p className={aiTestMessage.startsWith('✓')?'notice':'error'}>{aiTestMessage}</p>}</form></section>
    <section className="setup-step"><span className="step-number">2</span><h3>Gmail és Google Naptár</h3><p className="muted">A Google saját engedélykérő oldalán választod ki a fiókot. Csak olvasási hozzáférést kérünk; az app nem küld levelet és nem módosít naptárt.</p><button className="primary" onClick={()=>void run(async()=>{const result=await api<{url:string}>('/auth/google/start',{});location.assign(result.url);})}>{setup?.googleReady?'Google-fiók újracsatlakoztatása':'Google-fiók csatlakoztatása'}</button>{setup?.googleReady&&<><p className="notice">✓ Google-engedély elmentve</p><button onClick={()=>void run(async()=>{await api('/auth/google/disconnect',{});await load();setMessage('A MyBrain Google-olvasása kikapcsolva.');})}>Olvasás kikapcsolása</button></>}
      {!setup?.googleConfigured&&<p className="muted">Első alkalommal az alkalmazás Google-kliensét is be kell állítani lent. Ezután telefonról is elég lesz a csatlakoztatás gomb.</p>}
      <details><summary>Google-kliens egyszeri beállítása</summary><p className="muted">Google Cloud Console → OAuth webalkalmazás. Engedélyezd a Gmail API-t és a Google Calendar API-t. Tesztállapotban add hozzá a saját Google-címedet tesztfelhasználónak.</p><p className="muted">Engedélyezett átirányítási cím:</p><code className="callback-url">{setup?.callbackUrl}</code><form onSubmit={e=>{e.preventDefault();void run(async()=>{await api('/settings',Object.fromEntries(Object.entries(google).filter(([,v])=>v.trim())));setGoogle({GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''});await load();setMessage('Google-kliens elmentve. Most csatlakoztathatod a fiókot.');});}}><label>Google Client ID<input value={google.GOOGLE_CLIENT_ID} onChange={e=>setGoogle(v=>({...v,GOOGLE_CLIENT_ID:e.target.value}))}/></label><label>Google Client Secret<input type="password" autoComplete="off" value={google.GOOGLE_CLIENT_SECRET} onChange={e=>setGoogle(v=>({...v,GOOGLE_CLIENT_SECRET:e.target.value}))}/></label><button>Kliens mentése</button></form><p className="muted">Google tesztállapotban a tartós engedély korlátozott ideig élhet. Ha lejár, az app újracsatlakoztatást kér.</p></details>
    </section>
    <section className="setup-step"><span className="step-number">3</span><h3>Privát WhatsApp Androidról</h3><p className="muted">A WhatsApp-üzenetek kétféleképpen juthatnak be:</p>
      <details><summary>📱 1. Teljesen Automata továbbítás (MacroDroid / Tasker Androidon)</summary><p className="muted">Nem kell exportálnod semmit! Telepítsd az ingyenes <strong>MacroDroid</strong> vagy <strong>Tasker</strong> appot Androidra. Állíts be egy triggert: <em>Értesítés érkezett (WhatsApp)</em> → Akció: <em>HTTP POST</em> az alábbi címre:</p><code className="callback-url">https://mybrain.ferkomes.workers.dev/api/import/whatsapp-notification</code><p className="muted">Body (JSON): <code>{"{\"sender\":\"[notification_title]\", \"text\":\"[notification_text]\"}"}</code></p></details>
      <details><summary>📂 2. Kézi megosztás vagy .txt importálás</summary><p className="muted">WhatsApp → Beszélgetés → Menü → Továbbiak → Beszélgetés exportálása (Média nélkül) → Megosztás a MyBrain-nel, vagy az Importálás fülön tallózd be a .txt fájlt.</p></details>
    </section>
    <section className="setup-step zoofy-section">
      <span className="step-number">4</span>
      <div className="zoofy-header">
        <h3>Zoofy Megbízáskezelő & Automatikus Elfogadás</h3>
        {setup?.zoofy?.hasToken ? (
          <span className="badge-connected">✓ Csatlakoztatva (Aktív)</span>
        ) : (
          <span className="badge-pending">ℹ️ Kód / Értesítés aktív</span>
        )}
      </div>
      
      <p className="muted">
        A rendszer a megadott paraméterek alapján azonnal lecsapja a jövedelmező munkákat, rögzíti a <strong>„Most”</strong> listádban (CRITICAL prioritással), és megírja a holland WhatsApp egyeztető üzenetet az ügyfélnek.
      </p>

      {/* 1. Authentication & SMS / Token Code Management */}
      <div className="zoofy-subcard">
        <h4>🔑 Zoofy Fiók & Belépési Kód</h4>
        <p className="muted">
          Ha a Zoofy Pro app kilépne vagy új hitelesítést kérne, itt bármikor beírhatod a kapott SMS kódot vagy tokent:
        </p>
        <div className="field-row">
          <label>Telefonszám (Zoofy Pro)
            <input 
              value={zoofyPhone} 
              onChange={e => setZoofyPhone(e.target.value)} 
              placeholder="+31 6 ... vagy +36 ..." 
            />
          </label>
          <label>SMS Kód / Auth Token
            <input 
              value={zoofyCode} 
              onChange={e => setZoofyCode(e.target.value)} 
              placeholder="pl. 123456 vagy token..." 
            />
          </label>
          <button 
            type="button" 
            className="primary"
            onClick={() => void run(async () => {
              const res = await api<{success:boolean;message:string}>('/settings/zoofy-token', {
                phone: zoofyPhone,
                code: zoofyCode
              });
              setZoofyCode('');
              setZoofyStatusMsg(res.message || '✓ Kód elmentve.');
              await load();
            })}
          >
            Kód mentése
          </button>
        </div>
      </div>

      {/* 2. Search & Auto-Accept Parameters */}
      <div className="zoofy-subcard">
        <h4>🎯 Keresési Paraméterek & Munkatípusok</h4>
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            await api('/settings', {
              ZOOFY_PHONE: zoofyPhone,
              ZOOFY_AUTO_ACCEPT_ENABLED: String(zoofyAutoAccept),
              ZOOFY_MIN_PRICE: zoofyMinPrice,
              ZOOFY_MAX_DISTANCE_KM: zoofyMaxDist,
              ZOOFY_KEYWORDS: zoofyKeywords,
              ZOOFY_WHATSAPP_TEMPLATE: zoofyTemplate,
              ZOOFY_AI_INSTRUCTION: zoofyInstruction
            });
            await load();
            setZoofyStatusMsg('✓ Zoofy szabályok és paraméterek sikeresen elmentve!');
          });
        }}>
          <label className="checkbox-label" style={{margin: '12px 0 16px'}}>
            <input 
              type="checkbox" 
              checked={zoofyAutoAccept} 
              onChange={e => setZoofyAutoAccept(e.target.checked)} 
            />
            <strong>Automatikus azonnali elfogadás bekapcsolva</strong> (azonnal kiemeli a feltételeknek megfelelő munkákat)
          </label>

          <div className="field-row">
            <label>Minimum bevétel (€)
              <input 
                type="number" 
                value={zoofyMinPrice} 
                onChange={e => setZoofyMinPrice(e.target.value)} 
                min="0" 
                step="5"
                placeholder="150" 
              />
            </label>
            <label>Maximum távolság (km)
              <input 
                type="number" 
                value={zoofyMaxDist} 
                onChange={e => setZoofyMaxDist(e.target.value)} 
                min="1" 
                max="100"
                placeholder="15" 
              />
            </label>
          </div>

          <label>Keresett Munkatípusok / Kulcsszavak (vesszővel elválasztva)
            <input 
              value={zoofyKeywords} 
              onChange={e => setZoofyKeywords(e.target.value)} 
              placeholder="meubel, bútor, ikea, pax, villanyszerelés, elektra, loodgieter, szerelés" 
            />
          </label>
          <p className="tag-input-hint">
            💡 <em>Tipp: Ide bármikor beírhatsz új területeket (pl. villanyszerelés, elektra, konyha, csapcsere), és a rendszer azonnal azokat is figyelni és fogadni fogja!</em>
          </p>

          <label>AI Szabály leírása (Prompt)
            <input 
              value={zoofyInstruction} 
              onChange={e => setZoofyInstruction(e.target.value)} 
              placeholder="Bútor és villanyszerelési munkák kiemelt kezelése..." 
            />
          </label>

          <label>Holland WhatsApp válasz sablon (Ügyféllel való időpont-egyeztetéshez)
            <textarea 
              rows={3} 
              value={zoofyTemplate} 
              onChange={e => setZoofyTemplate(e.target.value)} 
            />
          </label>

          <div className="actions" style={{marginTop: '16px'}}>
            <button className="primary">Szabályok Mentése</button>
            <button 
              type="button" 
              onClick={() => {
                try {
                  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
                  if (AudioCtx) {
                    const ctx = new AudioCtx();
                    const now = ctx.currentTime;
                    [784, 1046.5, 1567.98].forEach((f, idx) => {
                      const osc = ctx.createOscillator();
                      const gain = ctx.createGain();
                      osc.type = 'triangle';
                      osc.frequency.setValueAtTime(f, now + idx * 0.12);
                      gain.gain.setValueAtTime(0.9, now + idx * 0.12);
                      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + (idx === 2 ? 0.35 : 0.12));
                      osc.connect(gain);
                      gain.connect(ctx.destination);
                      osc.start(now + idx * 0.12);
                      osc.stop(now + idx * 0.12 + 0.4);
                    });
                  }
                } catch(e) {}
              }}
            >
              🔊 Jelzőhang meghallgatása
            </button>
            <button 
              type="button" 
              disabled={zoofyTesting}
              onClick={async () => {
                setZoofyTesting(true);
                setZoofyStatusMsg('Teszt megbízás futtatása…');
                try {
                  const testRes = await api<{success:boolean;details?:any;whatsapp_template?:string}>('/import/zoofy-notification', {
                    sender: 'Zoofy Pro Teszt',
                    text: `Nieuwe klus: ${zoofyKeywords.split(',')[0].trim()} in Amsterdam (8 km) - Verdien €${Number(zoofyMinPrice) + 20}`,
                    app: 'zoofy'
                  });
                  if (testRes.success) {
                    setZoofyStatusMsg(`✓ Teszt sikeres! Megbízás automatikusan elfogadva (€${Number(zoofyMinPrice) + 20}, 8 km). WhatsApp sablon kész.`);
                  } else {
                    setZoofyStatusMsg('✕ Teszt nem sikerült.');
                  }
                } catch (err) {
                  setZoofyStatusMsg(`✕ Hiba: ${(err as Error).message}`);
                } finally {
                  setZoofyTesting(false);
                }
              }}
            >
              {zoofyTesting ? 'Tesztelés…' : 'Szabály & AI Tesztelése'}
            </button>
          </div>
          {zoofyStatusMsg && <p className={zoofyStatusMsg.startsWith('✓') ? 'notice' : 'error'}>{zoofyStatusMsg}</p>}
        </form>
      </div>

      <details style={{marginTop: '18px'}}>
        <summary>📱 MacroDroid / Értesítés-továbbítás webhook URL</summary>
        <p className="muted">Ha Android értesítés-figyelővel is továbbítanád az üzeneteket:</p>
        <code className="callback-url">https://mybrain.ferkomes.workers.dev/api/import/zoofy-notification</code>
        <p className="muted">HTTP Body (JSON): <code>{"{\"sender\":\"[notification_title]\", \"text\":\"[notification_text]\", \"app\":\"zoofy\"}"}</code></p>
      </details>
    </section>
    <label className="checkbox-label"><input type="checkbox" checked={setup?.learnDrafts||false} onChange={e=>void run(async()=>{await api('/memory/preferences',{learnDrafts:e.target.checked});await load();})}/> Tanuljon a mentett választervezeteimből rövid példákkal</label><p className="muted">Legfeljebb 100 rövid példa marad meg; egy elemzés legfeljebb 3 releváns példát kap. A Memória nézetben keresheted és törölheted őket. A bejövő üzenetekből nem lesz automatikusan személyes szabály.</p>
    {setup&&<SyncProgress refresh={refresh} autoStart={setup.aiReady&&setup.googleReady&&!setup.sync.initialComplete}/>}{message&&<p className="notice" role="status">{message}</p>}
    <div className="actions"><button onClick={()=>void run(async()=>{await api('/auth/logout',{});location.reload();})}>Kijelentkezés ezen az eszközön</button></div>
  </section>;
}

export function MemoryView({run}:{run:Run}){
  const [examples,setExamples]=useState<MemoryExample[]>([]),[query,setQuery]=useState(''),[topic,setTopic]=useState('Általános'),[instruction,setInstruction]=useState(''),[example,setExample]=useState('');
  async function load(q=query){setExamples((await api<{examples:MemoryExample[]}>(`/memory?q=${encodeURIComponent(q)}`)).examples);}
  useEffect(()=>{void run(()=>load(''));},[]);
  return <section className="panel"><h2>Rövid példák, személyes memória</h2><p className="muted">A saját példáid segítik a válaszstílust. A korábbi árakat, dátumokat és ígéreteket nem tekintjük aktuális ténynek.</p><form onSubmit={e=>{e.preventDefault();void run(async()=>{await api('/memory',{topic,instruction,example});setExample('');setInstruction('');await load();});}}><label>Téma vagy személy<input required maxLength={120} value={topic} onChange={e=>setTopic(e.target.value)} placeholder="Például: Tom, Kamado vagy Általános"/></label><label>Rövid szabály (opcionális)<input maxLength={240} value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="Tomnak röviden, angolul, barátságosan válaszolj."/></label><label>Jó válaszpélda<textarea required maxLength={600} value={example} onChange={e=>setExample(e.target.value)} placeholder="Hi Tom, thanks! Please confirm the updated quote including the grids."/></label><p className="muted">{example.length}/600 karakter</p><button className="primary">Példa megjegyzése</button></form><form className="field-row" onSubmit={e=>{e.preventDefault();void run(()=>load());}}><label>Keresés a memóriában<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button>Keresés</button></form><div className="memory-list">{examples.map(item=><article key={item.id}><h3>{item.topic}</h3><p>{item.instruction}</p><blockquote>{item.example}</blockquote><button onClick={()=>void run(async()=>{await api(`/memory/${encodeURIComponent(item.id)}/delete`,{});await load();})}>Elfelejtés</button></article>)}{!examples.length&&<p className="muted">Még nincs ide illő megjegyzett példa.</p>}</div></section>;
}

export function ImportView({run,refresh}:{run:Run;refresh:()=>Promise<void>}){
  const [name,setName]=useState('WhatsApp beszélgetés'),[text,setText]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{let cancelled=false;async function shared(){const id=new URLSearchParams(location.search).get('share');if(!id)return;const cache=await caches.open('mybrain-shared');const key=`/__shared/${id}`;const response=await cache.match(key);if(response&&!cancelled){const data=await response.json() as {name:string;text:string};setName(data.name);setText(data.text);await cache.delete(key);history.replaceState(null,'','/?tab=import');}}void shared().catch(()=>setMessage('A megosztott tartalom nem elérhető. Válaszd ki újra a fájlt.'));return()=>{cancelled=true;};},[]);
  return <section className="panel"><h2>WhatsApp-szöveg importálása</h2><p className="muted">WhatsApp → beszélgetés → menü → Továbbiak → Beszélgetés exportálása → Média nélkül. Válaszd a MyBraint a megosztásnál, vagy itt nyisd meg a .txt fájlt. Ha egy üzenet nem osztható meg közvetlenül, másold ide.</p><form onSubmit={e=>{e.preventDefault();void run(async()=>{const result=await api<{added:number}>('/import/whatsapp',{name,text});setMessage(`${result.added} szövegrész feldolgozásra vár. Az ismétlődő részeket kihagyjuk.`);setText('');});}}><label>Beszélgetés neve<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label>Szöveges export kiválasztása<input type="file" accept="text/plain,.txt" onChange={e=>{const file=e.target.files?.[0];if(!file)return;void run(async()=>{if(file.size>1500000)throw new Error('Legfeljebb 1,5 MB-os szöveges export választható.');const content=await file.text();if(content.length>500000)throw new Error('Legfeljebb 500 000 karakter importálható egyszerre.');setName(file.name.slice(0,120));setText(content);});}}/></label><label>Átnézhető szöveg<textarea required maxLength={500000} value={text} onChange={e=>setText(e.target.value)}/></label><p className="muted">{text.length.toLocaleString('hu-HU')} karakter. Az importálással ezt a tartalmat adod át az általad beállított AI-nak teendőelemzéshez.</p><button className="primary" disabled={!text.trim()}>Kiválasztott szöveg elemzése</button></form>{message&&<p role="status" className="notice">{message}</p>}<SyncProgress refresh={refresh}/></section>;
}
