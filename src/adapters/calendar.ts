import { DataSourceAdapter } from './base';
import type { EventRecord } from '../types';
import { googleToken,googleGet,type GoogleConfig } from './google';
export class GoogleCalendarAdapter extends DataSourceAdapter {
  sourceName='calendar';constructor(private config:GoogleConfig){super();}
  async testConnection(){try{const token=await googleToken(this.config);await googleGet('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',token);return {success:true,message:'Google Naptár csatlakoztatva · csak olvasás'};}catch(e){return {success:false,message:(e as Error).message};}}
  async fetchNewEvents(since?:Date):Promise<EventRecord[]> {
    if(!this.config.refreshToken)return [];
    const token=await googleToken(this.config);const start=since||new Date();
    const params=new URLSearchParams({timeMin:start.toISOString(),timeMax:new Date(start.getTime()+30*86400000).toISOString(),maxResults:'50',singleEvents:'true',orderBy:'startTime'});
    const data=await googleGet<{items?:any[]}>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,token);
    return (data.items||[]).filter(item=>item.status!=='cancelled').map(item=>({id:`gcal_${item.id}_${item.updated||'v1'}`,source:'calendar',source_id:item.id,sender:item.organizer?.email||'Google Calendar',subject:item.summary||'Calendar event',raw_content:`Calendar Event: ${item.summary}\nTime: ${item.start?.dateTime||item.start?.date}\nLocation: ${item.location||''}\nDescription: ${item.description||''}`.slice(0,16000),received_at:item.updated||new Date().toISOString(),metadata:{threadId:item.id,start:item.start?.dateTime||item.start?.date,end:item.end?.dateTime||item.end?.date,htmlLink:item.htmlLink}}));
  }
}
