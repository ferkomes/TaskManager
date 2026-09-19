import { DataSourceAdapter } from './base';
import type { EventRecord } from '../types';
export class ManualAdapter extends DataSourceAdapter {
  sourceName = 'manual';
  async testConnection() { return {success:true,message:'Text, forwarded messages, simulated voice transcripts and image attachments are available.'}; }
  async fetchNewEvents(): Promise<EventRecord[]> { return []; }
}
