import { DataSourceAdapter } from './base';
import { EventRecord } from '../types';

export class CleaningCalendarAdapter extends DataSourceAdapter {
  sourceName = 'cleaning';
  private icsUrl?: string;

  constructor(config: { icsUrl?: string }) {
    super();
    this.icsUrl = config.icsUrl;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.icsUrl) {
      return { success: false, message: 'Cleaning Calendar iCal URL not configured.' };
    }
    try {
      const res = await fetch(this.icsUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes('BEGIN:VCALENDAR')) {
        return { success: false, message: 'Invalid iCal format from URL' };
      }
      return { success: true, message: 'Connected to Cleaning Calendar iCal feed' };
    } catch (e: any) {
      return { success: false, message: `iCal fetch failed: ${e.message}` };
    }
  }

  async fetchNewEvents(): Promise<EventRecord[]> {
    if (!this.icsUrl) return [];

    try {
      const res = await fetch(this.icsUrl);
      if (!res.ok) return [];
      const icsData = await res.text();
      return this.parseIcs(icsData);
    } catch (err) {
      console.error('Failed to parse cleaning ics:', err);
      return [];
    }
  }

  private parseIcs(icsData: string): EventRecord[] {
    const events: EventRecord[] = [];
    const eventBlocks = icsData.split('BEGIN:VEVENT');

    for (let i = 1; i < eventBlocks.length; i++) {
      const block = eventBlocks[i].split('END:VEVENT')[0];
      const summaryMatch = block.match(/SUMMARY:(.*)/i);
      const startMatch = block.match(/DTSTART(?:;[^:]+)?:(.*)/i);
      const uidMatch = block.match(/UID:(.*)/i);
      const descMatch = block.match(/DESCRIPTION:(.*)/i);

      const summary = summaryMatch ? summaryMatch[1].trim() : 'Cleaning Shift';
      const uid = uidMatch ? uidMatch[1].trim() : `clean_${i}_${Date.now()}`;
      const startRaw = startMatch ? startMatch[1].trim() : '';

      events.push({
        id: `cleaning_${uid}`,
        source: 'cleaning',
        source_id: uid,
        sender: 'Cleaning Management Team',
        subject: `Cleaning: ${summary}`,
        raw_content: `Scheduled Turnover Cleaning:\nSummary: ${summary}\nDate/Time: ${startRaw}\nNotes: ${descMatch ? descMatch[1].trim() : 'None'}`,
        received_at: new Date().toISOString(),
        metadata: { summary, scheduledStart: startRaw },
      });
    }

    return events;
  }
}
