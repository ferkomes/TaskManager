import { DataSourceAdapter } from './base';
import { EventRecord } from '../types';

export class WhatsAppAdapter extends DataSourceAdapter {
  sourceName = 'whatsapp';
  private verifyToken?: string;
  private accessToken?: string;

  constructor(config: { verifyToken?: string; accessToken?: string }) {
    super();
    this.verifyToken = config.verifyToken;
    this.accessToken = config.accessToken;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.verifyToken) {
      return { success: false, message: 'WhatsApp verify token not set.' };
    }
    return { success: true, message: 'WhatsApp Webhook endpoint active & ready for incoming payloads.' };
  }

  async fetchNewEvents(): Promise<EventRecord[]> {
    // WhatsApp is a push-based webhook adapter rather than polling
    return [];
  }

  /**
   * Parse incoming Meta WhatsApp Cloud API webhook payload
   */
  parseWebhookPayload(body: any): EventRecord[] {
    const events: EventRecord[] = [];
    try {
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages || [];
      const contact = value?.contacts?.[0];
      const senderName = contact?.profile?.name || 'WhatsApp Contact';

      for (const msg of messages) {
        const from = msg.from; // e.g. "36301234567"
        let rawContent = '';
        let subject = `WhatsApp message from ${senderName}`;

        if (msg.type === 'text') {
          rawContent = msg.text?.body || '';
        } else if (msg.type === 'audio' || msg.type === 'voice') {
          rawContent = `[Voice Note received from ${senderName} (${from}). Duration: ${msg.voice?.duration || 'unknown'}s. Audio ID: ${msg.voice?.id}]`;
          subject = `Voice note from ${senderName}`;
        } else if (msg.type === 'image') {
          rawContent = `[Image received: ${msg.image?.caption || 'No caption'}. Media ID: ${msg.image?.id}]`;
          subject = `Image from ${senderName}`;
        }

        events.push({
          id: `whatsapp_${msg.id}`,
          source: 'whatsapp',
          source_id: msg.id,
          sender: `${senderName} (+${from})`,
          subject,
          raw_content: rawContent,
          received_at: new Date(Number(msg.timestamp) * 1000).toISOString(),
          metadata: {
            fromPhone: `+${from}`,
            messageType: msg.type,
            mediaId: msg.audio?.id || msg.voice?.id || msg.image?.id,
          },
        });
      }
    } catch (e) {
      console.error('Failed to parse WhatsApp webhook:', e);
    }
    return events;
  }
}
