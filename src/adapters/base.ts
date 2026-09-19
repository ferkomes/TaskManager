import { EventRecord } from '../types';

export interface AdapterSyncResult {
  source: string;
  newEvents: EventRecord[];
  errors?: string[];
}

export abstract class DataSourceAdapter {
  abstract sourceName: string;
  abstract testConnection(): Promise<{ success: boolean; message: string }>;
  abstract fetchNewEvents(since?: Date): Promise<EventRecord[]>;
}
