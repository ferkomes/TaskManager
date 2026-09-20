import { DataSourceAdapter } from './base';
import { EventRecord } from '../types';

export interface ZoofyConfig {
  apiKey?: string;
  authToken?: string;
  phone?: string;
  autoAcceptEnabled?: boolean | string;
  minPrice?: number | string;
  maxDistanceKm?: number | string;
  keywords?: string;
  whatsappTemplate?: string;
  aiInstruction?: string;
}

export interface ZoofyJobDetails {
  service: string;
  price: number | null;
  distanceKm: number | null;
  location: string | null;
  customerName?: string;
  customerPhone?: string;
  preferredDate?: string;
  isMatchingWorkType: boolean;
  matchedKeywords: string[];
  meetsAutoAcceptCriteria: boolean;
  autoAcceptReason: string;
  whatsappTemplate: string;
  minPrice: number;
  maxDistanceKm: number;
}

export class ZoofyAdapter extends DataSourceAdapter {
  sourceName = 'zoofy';
  apiKey?: string;
  authToken?: string;
  phone?: string;
  autoAcceptEnabled: boolean;
  minPrice: number;
  maxDistanceKm: number;
  keywords: string[];
  whatsappTemplate: string;
  aiInstruction?: string;

  constructor(config: ZoofyConfig = {}) {
    super();
    this.apiKey = config.apiKey;
    this.authToken = config.authToken;
    this.phone = config.phone;
    this.autoAcceptEnabled = config.autoAcceptEnabled !== false && config.autoAcceptEnabled !== 'false';
    this.minPrice = Number(config.minPrice || 150);
    this.maxDistanceKm = Number(config.maxDistanceKm || 15);
    
    // If keywords is explicitly empty (""), allow ALL work types!
    if (config.keywords !== undefined) {
      this.keywords = config.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    } else {
      this.keywords = ['meubel', 'bútor', 'ikea', 'pax', 'kast', 'tafel', 'stoel', 'bed', 'montage', 'monteren', 'assembly', 'villanyszerelés', 'elektra', 'elektricien', 'loodgieter'];
    }

    this.whatsappTemplate = config.whatsappTemplate || 
      'Beste, bedankt voor de opdracht via Zoofy! Ik heb de klus zojuist geaccepteerd. Schikt het opgegeven moment voor u, of zullen we even overleggen over een andere dag/tijd die u beter past? Met vriendelijke groet, Ferenc';
    this.aiInstruction = config.aiInstruction;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const hasAuth = !!this.authToken || !!this.apiKey;
    return {
      success: true,
      message: hasAuth
        ? `Zoofy aktív (Fiók csatlakoztatva: ${this.phone || 'Bejelentkezve'}, Min. ár: €${this.minPrice}, Max. távolság: ${this.maxDistanceKm}km).`
        : `Zoofy figyelő aktív (Min. ár: €${this.minPrice}, Max. távolság: ${this.maxDistanceKm}km, SMS/Token kód megadható a beállításokban).`
    };
  }

  async fetchNewEvents(): Promise<EventRecord[]> {
    return [];
  }

  /**
   * Parse details from notification text using dynamic keywords and rules
   */
  parseDetails(text: string): ZoofyJobDetails {
    const lower = text.toLowerCase();

    // 1. Check keyword matches
    // 1. Check keyword matches (if keywords array is empty, match ALL work types!)
    const matchedKeywords = this.keywords.length === 0 ? [] : this.keywords.filter(kw => lower.includes(kw));
    const isMatchingWorkType = this.keywords.length === 0 || matchedKeywords.length > 0;

    // Determine readable service category name
    let service = 'Klus / Megbízás';
    if (/elektra|elektricien|villanyszerelés|világítás|dugalj/i.test(text)) {
      service = 'Villanyszerelés (Elektra)';
    } else if (/meubelmontage|meubels monteren|bútor|kast|ikea|pax|bed|tafel/i.test(text)) {
      service = 'Bútor összeszerelés (Meubelmontage)';
    } else if (/keuken/i.test(text)) {
      service = 'Konyhaszerelés (Keukenmontage)';
    } else if (/loodgieter|csőtörés|lefolyó|csap/i.test(text)) {
      service = 'Vízszerelés (Loodgieter)';
    } else if (/tuin/i.test(text)) {
      service = 'Kertgondozás (Tuin)';
    } else if (matchedKeywords.length > 0) {
      service = `Megbízás (${matchedKeywords[0]})`;
    }

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

    // 4. Location extraction: looks for "in [City]"
    let location: string | null = null;
    const locMatch = text.match(/\bin\s+([A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű\s-]+?)(?=[,\.\(\-\n]|\s+\d|\s+voor|\s+om|$)/);
    if (locMatch) {
      location = locMatch[1].trim();
    }

    // 5. Auto-accept criteria check
    const priceOk = price !== null && price >= this.minPrice;
    const distOk = distanceKm === null || distanceKm <= this.maxDistanceKm;
    const meetsAutoAcceptCriteria = this.autoAcceptEnabled && isMatchingWorkType && priceOk && distOk;

    let autoAcceptReason = '';
    if (meetsAutoAcceptCriteria) {
      autoAcceptReason = `✅ Megfelel az auto-accept szabálynak: ${service}, €${price} (>=${this.minPrice}€), ${distanceKm ? distanceKm + ' km' : 'közeli'} (<=${this.maxDistanceKm}km).`;
    } else {
      const reasons: string[] = [];
      if (!this.autoAcceptEnabled) reasons.push('auto-accept kikapcsolva');
      if (!isMatchingWorkType) reasons.push('nem egyezik a megadott kulcsszavakkal');
      if (price !== null && price < this.minPrice) reasons.push(`ár alacsonyabb (€${price} < €${this.minPrice})`);
      if (distanceKm !== null && distanceKm > this.maxDistanceKm) reasons.push(`távolság nagyobb (${distanceKm}km > ${this.maxDistanceKm}km)`);
      autoAcceptReason = `ℹ️ Kézi áttekintést igényel (${reasons.join(', ')}).`;
    }

    return {
      service,
      price,
      distanceKm,
      location,
      isMatchingWorkType,
      matchedKeywords,
      meetsAutoAcceptCriteria,
      autoAcceptReason,
      whatsappTemplate: this.whatsappTemplate,
      minPrice: this.minPrice,
      maxDistanceKm: this.maxDistanceKm
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
        autoAcceptReason: details.autoAcceptReason,
      },
    };
  }
}
