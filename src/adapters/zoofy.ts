import { DataSourceAdapter } from './base';
import { EventRecord } from '../types';

export interface ZoofyJobDetails {
  service: string;
  price: number | null;
  distanceKm: number | null;
  location: string | null;
  customerName?: string;
  customerPhone?: string;
  preferredDate?: string;
  isFurniture: boolean;
  meetsAutoAcceptCriteria: boolean;
  autoAcceptReason: string;
  whatsappTemplate: string;
}

export class ZoofyAdapter extends DataSourceAdapter {
  sourceName = 'zoofy';
  private apiKey?: string;
  private minPrice: number;
  private maxDistanceKm: number;

  constructor(config: { apiKey?: string; minPrice?: number; maxDistanceKm?: number } = {}) {
    super();
    this.apiKey = config.apiKey;
    this.minPrice = config.minPrice ?? 150;
    this.maxDistanceKm = config.maxDistanceKm ?? 15;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Zoofy adapter active (Push notification & Auto-Accept enabled).' };
  }

  async fetchNewEvents(): Promise<EventRecord[]> {
    return [];
  }

  /**
   * Parse details from notification text
   */
  parseDetails(text: string): ZoofyJobDetails {
    const lower = text.toLowerCase();

    // 1. Service / Work type detection
    const isFurniture = /meubel|bútor|kast|ikea|pax|tafel|stoel|bed|montage|monteren|assembly|in elkaar zetten/i.test(text);
    let service = 'Klus / Megbízás';
    if (/meubelmontage|meubels monteren|bútor/i.test(text)) service = 'Bútor összeszerelés (Meubelmontage)';
    else if (/ikea|pax/i.test(text)) service = 'IKEA / PAX Bútorszerelés';
    else if (/keuken/i.test(text)) service = 'Konyhaszerelés (Keukenmontage)';
    else if (/loodgieter/i.test(text)) service = 'Vízszerelés (Loodgieter)';
    else if (/elektra|elektricien/i.test(text)) service = 'Villanyszerelés (Elektra)';
    else if (/tuin/i.test(text)) service = 'Kertgondozás (Tuin)';

    // 2. Price extraction: looks for €150, 150€, € 150, 150 EUR, 150 euro
    let price: number | null = null;
    const priceMatch = text.match(/(?:€\s*|eur(?:o)?\s*)(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:€|eur(?:o)?)/i);
    if (priceMatch) {
      const rawPrice = priceMatch[1] || priceMatch[2];
      price = parseFloat(rawPrice.replace(',', '.'));
    }

    // 3. Distance extraction: looks for 12 km, 7.5km, 12 kilometer, 12km van jou
    let distanceKm: number | null = null;
    const distMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:km|kilometer)/i);
    if (distMatch) {
      distanceKm = parseFloat(distMatch[1].replace(',', '.'));
    }

    // 4. Location extraction: looks for "in [City]" or city names
    let location: string | null = null;
    const locMatch = text.match(/\bin\s+([A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű\s-]+?)(?=[,\.\(\-\n]|\s+\d|\s+voor|\s+om|$)/);
    if (locMatch) {
      location = locMatch[1].trim();
    }

    // 5. Auto-accept criteria check: Furniture AND Price >= 150 EUR AND Distance <= 15 km
    const priceOk = price !== null && price >= this.minPrice;
    const distOk = distanceKm === null || distanceKm <= this.maxDistanceKm;
    const meetsAutoAcceptCriteria = isFurniture && priceOk && distOk;

    let autoAcceptReason = '';
    if (meetsAutoAcceptCriteria) {
      autoAcceptReason = `✅ Megfelel az auto-accept szabálynak: Bútor szerelés, €${price} (>=${this.minPrice}€), ${distanceKm ? distanceKm + ' km' : 'közeli'} (<=${this.maxDistanceKm}km).`;
    } else {
      const reasons: string[] = [];
      if (!isFurniture) reasons.push('nem bútoros munka');
      if (price !== null && price < this.minPrice) reasons.push(`ár alacsonyabb (€${price} < €${this.minPrice})`);
      if (distanceKm !== null && distanceKm > this.maxDistanceKm) reasons.push(`távolság nagyobb (${distanceKm}km > ${this.maxDistanceKm}km)`);
      autoAcceptReason = `ℹ️ Kézi áttekintést igényel (${reasons.join(', ')}).`;
    }

    // 6. Pre-generated polite Dutch WhatsApp template for the customer
    const greeting = 'Beste,';
    const whatsappTemplate = `${greeting} bedankt voor de opdracht via Zoofy! Ik heb de klus zojuist geaccepteerd. Schikt het opgegeven moment voor u, of zullen we even overleggen over een andere dag/tijd die u beter past? Met vriendelijke groet, Ferenc`;

    return {
      service,
      price,
      distanceKm,
      location,
      isFurniture,
      meetsAutoAcceptCriteria,
      autoAcceptReason,
      whatsappTemplate,
    };
  }

  /**
   * Convert incoming Zoofy notification into structured EventRecord
   */
  createEvent(sender: string, rawContent: string, receivedAt?: string): EventRecord {
    const details = this.parseDetails(rawContent);
    const eventId = `zoofy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    return {
      id: eventId,
      source: 'zoofy',
      source_id: eventId,
      sender: sender || 'Zoofy Pro',
      subject: details.meetsAutoAcceptCriteria
        ? `🎯 ZOOFY [AUTO-ELFOGADVA]: ${details.service} - €${details.price || '?'} (${details.distanceKm || '?'} km)`
        : `Zoofy megbízás: ${details.service}${details.price ? ` - €${details.price}` : ''}`,
      raw_content: rawContent,
      received_at: receivedAt || new Date().toISOString(),
      metadata: {
        zoofyDetails: details,
        isAutoAccepted: details.meetsAutoAcceptCriteria,
        service: details.service,
        price: details.price,
        distanceKm: details.distanceKm,
        location: details.location,
        whatsappTemplate: details.whatsappTemplate,
      },
    };
  }
}
