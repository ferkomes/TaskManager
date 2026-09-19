import { DataSourceAdapter } from './base';
import { LodgifyAdapter } from './lodgify';
export class AirbnbAdapter extends DataSourceAdapter {
  sourceName = 'airbnb';
  constructor(private lodgify: LodgifyAdapter) { super(); }
  async testConnection() { const result = await this.lodgify.testConnection(); return {...result,message:`Airbnb via Lodgify channel manager: ${result.message}`}; }
  async fetchNewEvents() { return (await this.lodgify.fetchNewEvents()).filter(e => e.source === 'airbnb'); }
}
