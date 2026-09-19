import { CallerContact } from '../types';

export interface UrgentEvaluationResult {
  isUrgent: boolean;
  isNightTime: boolean;
  matchedContact?: CallerContact;
  isCurrentlyCheckedIn: boolean;
  priority: 'CRITICAL' | 'NORMAL';
  alertReason: string;
  recommendedAction: string;
}

export class UrgentCorrelatorService {
  /**
   * Evaluates an incoming phone call or SMS against property reservation records
   */
  evaluateCaller(
    phoneNumber: string,
    contacts: CallerContact[],
    options?: {
      callCountInLast15Min?: number;
      messageSnippet?: string;
      customTimestamp?: Date;
    }
  ): UrgentEvaluationResult {
    const now = options?.customTimestamp || new Date();
    const currentHour = now.getHours();
    // Night hours: 22:00 to 07:00
    const isNightTime = currentHour >= 22 || currentHour < 7;

    // Normalize phone number (strip whitespace, dashes, parens)
    const cleanPhone = phoneNumber.replace(/\D/g, '').replace(/^00/, '');

    // Look for matching registered contact
    const contact = contacts.find((c) => {
      const storedClean = c.phone_number.replace(/\D/g, '').replace(/^00/, '');
      return cleanPhone.length >= 8 && storedClean === cleanPhone;
    });

    let isCurrentlyCheckedIn = false;
    if (contact?.check_in && contact?.check_out) {
      const checkInDate = new Date(contact.check_in);
      const checkOutDate = new Date(contact.check_out);
      // Give 24h grace period around dates
      isCurrentlyCheckedIn = now >= checkInDate && now <= checkOutDate;
    }

    const snippet = (options?.messageSnippet || '').toLowerCase();
    const urgentKeywords = [
      'leak',
      'water',
      'locked out',
      'key',
      'burst',
      'fire',
      'emergency',
      'police',
      'csőtörés',
      'kizártuk',
      'baj van',
      'sürgős',
      'help',
    ];
    const containsUrgentKeywords = urgentKeywords.some((w) => snippet.includes(w));
    const callCount = options?.callCountInLast15Min || 1;
    const isRepeatedNightCall = isNightTime && callCount >= 2;

    // Decision Logic:
    // 1. Current guest calling repeatedly during night hours OR with emergency keywords
    if (contact && (isCurrentlyCheckedIn || contact.source === 'cleaning')) {
      if (isRepeatedNightCall || containsUrgentKeywords) {
        return {
          isUrgent: true,
          isNightTime,
          matchedContact: contact,
          isCurrentlyCheckedIn,
          priority: 'CRITICAL',
          alertReason: `CRITICAL ALERT: Currently checked-in guest ${contact.guest_name} at ${contact.property_name || 'Property'} is calling ${isNightTime ? 'during the night' : 'urgently'} (${callCount} attempts). ${containsUrgentKeywords ? 'Message indicates immediate on-site emergency.' : ''}`,
          recommendedAction: `Answer or immediately call back ${contact.guest_name} at ${contact.phone_number}. Check smart lock or contact local maintenance.`,
        };
      }
    }

    // 2. Unknown caller at night without emergency keywords -> Do not wake
    if (isNightTime && !containsUrgentKeywords) {
      return {
        isUrgent: false,
        isNightTime: true,
        matchedContact: contact,
        isCurrentlyCheckedIn,
        priority: 'NORMAL',
        alertReason: contact
          ? `Guest ${contact.guest_name} called once at night with no critical keywords. Held for morning brief.`
          : `Unknown number ${phoneNumber} called during quiet hours. Silenced.`,
        recommendedAction: 'Logged in inbox; no urgent wake-up required.',
      };
    }

    // 3. Regular daytime or general inquiry
    return {
      isUrgent: false,
      isNightTime,
      matchedContact: contact,
      isCurrentlyCheckedIn,
      priority: 'NORMAL',
      alertReason: contact
        ? `Call from ${contact.guest_name} (${contact.property_name || 'Property'}). Standard operational inquiry.`
        : `Call from ${phoneNumber}.`,
      recommendedAction: 'Add to daily callback agenda.',
    };
  }
}
