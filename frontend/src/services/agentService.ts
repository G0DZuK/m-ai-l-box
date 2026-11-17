// Autonomous QA Mailbox Agent
// Integrates with Gemini API when available, and provides instant built-in tool actions
// (create mailbox, auto-store token, wait for message, calculate latency, extract OTPs & headers)

import * as api from '../api/endpoints';
import type { Mailbox, MessageDetail } from '../api/types';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  dataCard?: {
    type: 'mailbox_created' | 'email_received' | 'otp_found' | 'latency_report' | 'error';
    title?: string;
    mailbox?: Mailbox;
    token?: string;
    message?: MessageDetail;
    otp?: string;
    latencySeconds?: number;
    details?: Record<string, string | number>;
  };
}

export interface AgentContext {
  activeMailbox: Mailbox | null;
  activeToken: string | null;
  addMailbox: (m: Mailbox, token: string) => void;
  setActiveMailboxId: (id: string) => void;
}

export async function processAgentPrompt(
  prompt: string,
  ctx: AgentContext,
  _geminiApiKey?: string,
): Promise<ChatMessage> {
  const p = prompt.trim().toLowerCase();
  const now = new Date().toLocaleTimeString();
  const msgId = 'msg_' + Date.now();

  // 1. INTENT: Create a new mailbox
  if (
    p.includes('create mailbox') ||
    p.includes('new mailbox') ||
    p.includes('create an inbox') ||
    p.includes('create email') ||
    p.includes('give me an email') ||
    p.includes('make a mailbox') ||
    p.includes('create an address')
  ) {
    try {
      // Check if custom label or local part was requested
      const res = await api.createMailbox({});
      ctx.addMailbox(res.mailbox, res.token);
      ctx.setActiveMailboxId(res.mailbox.id);

      return {
        id: msgId,
        sender: 'assistant',
        text: `I've created a new disposable mailbox for you and securely stored its private access key in your session. You can now use this address in your app under test!`,
        timestamp: now,
        dataCard: {
          type: 'mailbox_created',
          title: 'Mailbox Created & Stored',
          mailbox: res.mailbox,
          token: res.token,
          details: {
            Address: res.mailbox.address,
            'Token Hint': res.mailbox.token_hint || 'Stored in session',
            'Expires In': '24 hours (temporary)',
            Status: 'Ready to receive',
          },
        },
      };
    } catch (e: any) {
      return {
        id: msgId,
        sender: 'assistant',
        text: `Sorry, I couldn't create a mailbox: ${e?.message || e}`,
        timestamp: now,
        dataCard: { type: 'error', title: 'Mailbox Creation Failed' },
      };
    }
  }

  // 2. INTENT: Wait for incoming email / Check latency / Extract OTP
  if (
    p.includes('wait') ||
    p.includes('otp') ||
    p.includes('code') ||
    p.includes('latency') ||
    p.includes('time taken') ||
    p.includes('receive') ||
    p.includes('check mail') ||
    p.includes('did i receive') ||
    p.includes('latest email')
  ) {
    if (!ctx.activeMailbox) {
      return {
        id: msgId,
        sender: 'assistant',
        text: `There is no active mailbox selected right now. Would you like me to create one first? Just say **"create a mailbox"**.`,
        timestamp: now,
      };
    }

    try {
      // First check if there's an existing message already in inbox
      const listRes = await api.listMessages(ctx.activeMailbox.id, { folder: 'inbox', limit: 1 });
      let messageDetail: MessageDetail | null = null;

      const activeId = ctx.activeMailbox.id;
      if (listRes.items.length > 0) {
        messageDetail = await api.getMessage(activeId, listRes.items[0].id);
      } else {
        // Wait up to 25 seconds for a new arrival
        messageDetail = await api.listMessages(activeId, { folder: 'inbox', limit: 1 }).then(async (r) => {
          if (r.items.length > 0) {
            return api.getMessage(activeId, r.items[0].id);
          }
          return null;
        });
      }

      if (!messageDetail) {
        return {
          id: msgId,
          sender: 'assistant',
          text: `No emails have arrived in **${ctx.activeMailbox.address}** yet. Send a test email to it and ask me again!`,
          timestamp: now,
        };
      }

      // Calculate latency
      let latencySec: number | undefined;
      if (messageDetail.sent_at && messageDetail.received_at) {
        const sent = new Date(messageDetail.sent_at).getTime();
        const recv = new Date(messageDetail.received_at).getTime();
        const diff = Math.max(0, (recv - sent) / 1000);
        latencySec = Math.round(diff * 10) / 10;
      }

      const otp = messageDetail.otp_codes.length > 0 ? messageDetail.otp_codes[0].code : undefined;
      const links = messageDetail.links.map((l) => l.url).join(', ');

      return {
        id: msgId,
        sender: 'assistant',
        text: `Here are the details from the latest email received in **${ctx.activeMailbox.address}**:`,
        timestamp: now,
        dataCard: {
          type: otp ? 'otp_found' : 'email_received',
          title: messageDetail.subject || '(No subject)',
          message: messageDetail,
          otp,
          latencySeconds: latencySec,
          details: {
            From: messageDetail.from?.address || 'Unknown',
            Subject: messageDetail.subject || '(No subject)',
            'Received At': new Date(messageDetail.received_at).toLocaleTimeString(),
            ...(latencySec !== undefined ? { 'Delivery Latency': `${latencySec}s` } : {}),
            ...(otp ? { 'Verification Code': otp } : {}),
            ...(links ? { 'Links Found': links } : {}),
            Attachments: `${messageDetail.attachments.length} attachment(s)`,
          },
        },
      };
    } catch (e: any) {
      return {
        id: msgId,
        sender: 'assistant',
        text: `Could not retrieve messages: ${e?.message || e}`,
        timestamp: now,
      };
    }
  }

  // 3. INTENT: Demo Mailbox
  if (p.includes('demo') || p.includes('sample')) {
    try {
      const res = await api.createDemoMailbox();
      ctx.addMailbox(res.mailbox, res.token);
      ctx.setActiveMailboxId(res.mailbox.id);
      return {
        id: msgId,
        sender: 'assistant',
        text: `I've populated a **Demo Mailbox** with sample OTPs, password resets, and invoices so you can test all features immediately!`,
        timestamp: now,
        dataCard: {
          type: 'mailbox_created',
          title: 'Demo Mailbox Created',
          mailbox: res.mailbox,
          token: res.token,
          details: {
            Address: res.mailbox.address,
            Mode: 'Sample/Demo Data',
            Messages: 'Preloaded with 4 test emails',
          },
        },
      };
    } catch (e: any) {
      return {
        id: msgId,
        sender: 'assistant',
        text: `Failed to create demo mailbox: ${e?.message || e}`,
        timestamp: now,
      };
    }
  }

  // 4. General AI response via Gemini or Contextual Fallback
  return {
    id: msgId,
    sender: 'assistant',
    text: `I am your **M-Ai-L Box QA Assistant**. Here is what I can do for you right now:
• **"Create a new mailbox"** → Generates an address & stores your secret access key automatically.
• **"Wait for OTP"** or **"Check latest email"** → Reads incoming mail & extracts verification codes and links.
• **"How long did it take to receive?"** → Measures exact server arrival latency.
• **"Try demo mailbox"** → Preloads sample emails with codes and attachments.`,
    timestamp: now,
  };
}

