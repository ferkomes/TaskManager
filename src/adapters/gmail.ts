import { DataSourceAdapter } from './base';
import type { EventRecord } from '../types';
import { googleToken,googleGet,type GoogleConfig } from './google';
function decode(value:string){try{return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));}catch{return '';}}
function plainText(part:any):string {
  if(part?.mimeType==='text/plain'&&part.body?.data)return decode(part.body.data);
  return (part?.parts||[]).map(plainText).filter(Boolean).join('\n');
}
export class GmailAdapter extends DataSourceAdapter {
  sourceName='gmail';constructor(private config:GoogleConfig){super();}
  async testConnection(){try{const token=await googleToken(this.config);await googleGet('https://gmail.googleapis.com/gmail/v1/users/me/profile',token);return {success:true,message:'Gmail csatlakoztatva · csak olvasás'};}catch(e){return {success:false,message:(e as Error).message};}}
  async fetchNewEvents(since?:Date):Promise<EventRecord[]> {
    if(!this.config.refreshToken)return [];
    const token=await googleToken(this.config);
    const query=`in:inbox after:${Math.floor((since?.getTime() || Date.now()-30*86400000)/1000)}`;
    const list=await googleGet<{messages?:{id:string}[]}>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${encodeURIComponent(query)}`,token);
    const events:EventRecord[]=[];
    // Bounded initial import: newest 20 inbox messages in the last 30 days.
    for(let i=0;i<(list.messages||[]).length;i+=5){
      const batch=await Promise.all(list.messages!.slice(i,i+5).map(async item=>{
        const msg=await googleGet<any>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`,token);
        const header=(name:string)=>(msg.payload?.headers||[]).find((h:any)=>h.name.toLowerCase()===name)?.value;
        return {id:`gmail_${msg.id}`,source:'gmail' as const,source_id:msg.id,sender:header('from')||'Unknown sender',subject:header('subject')||'Email',raw_content:(plainText(msg.payload)||msg.snippet||'').slice(0,16000),received_at:new Date(Number(msg.internalDate)||Date.now()).toISOString(),metadata:{threadId:msg.threadId}};
      }));events.push(...batch);
    }
    return events;
  }
}
