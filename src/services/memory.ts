import type { EventRecord, TaskRecord } from '../types';
export interface MemoryExample {id:string;topic:string;instruction:string;example:string;task_id?:string|null;created_at:string;updated_at:string}
export class MemoryStore {
  constructor(private db:D1Database){}
  async list(query=''):Promise<MemoryExample[]> {
    const {results}=await this.db.prepare('SELECT * FROM memory_examples ORDER BY updated_at DESC LIMIT 100').all<MemoryExample>();
    const words=query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>2);
    return words.length?results.filter(m=>words.some(w=>`${m.topic} ${m.instruction} ${m.example}`.toLocaleLowerCase().includes(w))):results;
  }
  async save(input:{id?:string;topic:string;instruction?:string;example:string;task_id?:string}) {
    const now=new Date().toISOString();const id=input.id || crypto.randomUUID();
    await this.db.prepare('INSERT INTO memory_examples (id,topic,instruction,example,task_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET topic=excluded.topic,instruction=excluded.instruction,example=excluded.example,updated_at=excluded.updated_at')
      .bind(id,input.topic.trim().slice(0,120),(input.instruction||'').trim().slice(0,240),input.example.trim().slice(0,600),input.task_id||null,now,now).run();
    await this.db.prepare('DELETE FROM memory_examples WHERE id NOT IN (SELECT id FROM memory_examples ORDER BY updated_at DESC LIMIT 100)').run();
    return id;
  }
  async remove(id:string){await this.db.prepare('DELETE FROM memory_examples WHERE id=?').bind(id).run();}
  async learnDraft(task:TaskRecord,example:string) {
    await this.save({id:`draft_${task.id}`,topic:`${task.project_category} ${task.people_involved?.join(' ') || ''}`.trim(),instruction:'A tulajdonos által jóváhagyott válaszstílus-példa. A tényeket és dátumokat mindig az aktuális ügyből vedd.',example,task_id:task.id});
  }
  async context(event:EventRecord) {
    const text=`${event.sender} ${event.subject||''} ${event.raw_content.slice(0,1500)}`.toLocaleLowerCase();
    const scored=(await this.list()).map(item=>{
      const terms=[...new Set(`${item.topic} ${item.instruction}`.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>2))];
      return {item,score:terms.reduce((n,w)=>n+(text.includes(w)?1:0),0)+(item.topic==='Általános'?1:0)};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
    if(!scored.length)return '';
    return `OWNER-APPROVED STYLE EXAMPLES (not current facts; never copy old dates, prices, codes or promises):\n${JSON.stringify(scored.map(({item})=>({topic:item.topic,instruction:item.instruction,example:item.example}))).slice(0,2600)}`;
  }
}
