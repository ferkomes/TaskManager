import { DataSourceAdapter } from './base';
import { EventRecord, CallerContact } from '../types';

export class LodgifyAdapter extends DataSourceAdapter {
  sourceName = 'lodgify';
  private apiKey?: string;

  constructor(config: { apiKey?: string }) {
    super();
    this.apiKey = config.apiKey;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.apiKey) {
      return { success: false, message: 'Lodgify API key not provided in Settings.' };
    }
    try {
      const res = await fetch('https://api.lodgify.com/v2/properties', {
        headers: { 'X-ApiKey': this.apiKey, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { success: true, message: 'Connected to Lodgify API (Read-only)' };
    } catch (e: any) {
      return { success: false, message: `Lodgify Auth failed: ${e.message}` };
    }
  }

  async fetchNewEvents(): Promise<EventRecord[]> {
    if (!this.apiKey) return [];

    try {
      // 1. Fetch recent messages (guest communications across Lodgify & Airbnb channel manager)
      const res = await fetch('https://api.lodgify.com/v1/messages?page=1&size=10', {
        headers: { 'X-ApiKey': this.apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const messages = (await res.json()) as any[];

      return messages.map((m: any) => {
        const isAirbnb = m.channel === 'Airbnb' || (m.subject && m.subject.toLowerCase().includes('airbnb'));
        return {
          id: `lodgify_${m.id || Date.now()}`,
          source: isAirbnb ? 'airbnb' : 'lodgify',
          source_id: String(m.id),
          sender: m.guestName || m.sender || 'Lodgify Guest',
          subject: m.subject || `Inquiry for ${m.propertyName || 'Property'}`,
          raw_content: m.text || m.content || '',
          received_at: m.created_at || new Date().toISOString(),
          metadata: {
            guestPhone: m.guestPhone,
            reservationId: m.bookingId,
            propertyName: m.propertyName,
            channel: m.channel,
          },
        };
      });
    } catch (err) {
      console.error('Failed to fetch Lodgify events:', err);
      return [];
    }
  }

  /**
   * Helper to synchronize active guests with phone numbers into the caller directory
   */
  async fetchActiveGuestContacts(): Promise<CallerContact[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch('https://api.lodgify.com/v2/reservations/bookings?status=Booked', {
        headers: { 'X-ApiKey': this.apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as any;
      const bookings = data.items || [];

      return bookings
        .filter((b: any) => b.guest?.phone)
        .map((b: any) => ({
          id: `contact_${b.id}`,
          phone_number: b.guest.phone.replace(/[\s\-\(\)]/g, ''),
          guest_name: `${b.guest.first_name || ''} ${b.guest.last_name || ''}`.trim() || 'Guest',
          source: (b.source?.toLowerCase().includes('airbnb') ? 'airbnb' : 'lodgify') as 'lodgify' | 'airbnb',
          reservation_id: String(b.id),
          property_name: b.property_name || 'Property',
          check_in: b.arrival,
          check_out: b.departure,
        }));
    } catch (err) {
      console.error('Failed to fetch Lodgify guest contacts:', err);
      return [];
    }
  }
}
