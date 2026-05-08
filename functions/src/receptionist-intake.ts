/**
 * functions/src/receptionist-intake.ts
 *
 * AI Receptionist "Carmela" — handles inbound phone calls via Twilio Voice.
 *
 * Architecture:
 *   Twilio Phone → receptionistWebhook (TwiML <Gather>) → Claude Haiku → TwiML response
 *   Call ends     → receptionistStatus → save intake to firms/{firmId}/intakes
 *
 * Two HTTPS functions (not callable — Twilio uses plain HTTP):
 *   receptionistWebhook  — Configure in Twilio as "A Call Comes In" webhook
 *                          URL: https://<function-url>/?firmId=<your-firm-id>
 *   receptionistStatus   — Configure as "Call Status Changes" webhook
 *
 * Voice: Amazon Polly "Joanna-Neural" via Twilio <Say> (zero extra latency)
 * STT:   Twilio built-in enhanced speech recognition (phone_call model)
 * AI:    Claude Haiku 4.5 — fastest response, ~200-400ms
 *
 * Session state stored in: receptionistSessions/{callSid}
 * Final intakes stored in:  firms/{firmId}/intakes/{intakeId}
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';
import { callAI, type FirmData } from './ai-client';

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

interface IntakeData {
  name?: string;
  phone?: string;
  email?: string;
  legalMatter?: string;
  description?: string;
  urgency?: 'normal' | 'high' | 'urgent';
  existingClient?: boolean;
}

interface ReceptionistSession {
  callSid: string;
  callerPhone: string;
  firmId: string;
  conversation: ConversationTurn[];
  intake: IntakeData;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed';
  turnCount: number;
  timeoutCount: number;
}

// ---------------------------------------------------------------------------
// Carmela's system prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Carmela, the receptionist at Elias Counsel LLC — an estate planning law firm in Monroe Township, New Jersey. You're an Italian-American woman in your early 30s. Warm, real, sharp. Central Jersey is home. You talk like a real person — professional but genuinely friendly. Think of yourself as the knowledgeable friend at the front desk who actually cares.

YOUR JOB: Screen calls, collect basic intake info, make callers feel comfortable.

INFO TO COLLECT (naturally, in conversation — never interrogate):
1. Full name
2. Best callback number (may differ from the number they called from)
3. Email address
4. What they need help with (estate planning, will, trust, power of attorney, deed, Medicaid planning, etc.)
5. Brief description of their situation
6. New or existing client?
7. Any urgency (recent death, upcoming court date, time-sensitive deadline)

STYLE:
- MAX 2 SHORT SENTENCES per response. This is a phone call.
- Natural and warm. "Listen," "So what's going on?" "Gotcha," "No worries at all," "I hear ya," "for sure," "absolutely," "that totally makes sense"
- Never give legal advice. If they ask legal questions: "Oh that's a great one — Adam the attorney will definitely go over all of that with you."
- Once you have name + contact info + legal matter — you have enough to wrap up.
- Wrap up: "Perfect, I got everything I need — Adam and his team will reach out to get something on the calendar real soon."

STRUCTURED OUTPUT (system use only — caller does NOT hear this):
After your spoken response, on a new line, include any newly learned intake info:
##INTAKE## {"name":"...","phone":"...","email":"...","legalMatter":"...","description":"...","urgency":"normal","existingClient":false}
Only include fields you've actually confirmed. Omit fields you don't know yet.

When you've said your goodbye and the call is fully complete, add this on its own line:
##DONE##`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const sortedStr = Object.keys(params)
    .sort()
    .map(k => k + params[k])
    .join('');
  const computed = crypto
    .createHmac('sha1', authToken)
    .update(url + sortedStr)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'base64'),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildGatherTwiml(spokenText: string, actionUrl: string): string {
  const safe = escapeXml(spokenText);
  const safeUrl = escapeXml(actionUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${safeUrl}" method="POST"
          speechTimeout="auto" speechModel="phone_call" enhanced="true"
          language="en-US">
    <Say voice="Polly.Joanna-Neural">${safe}</Say>
  </Gather>
  <Redirect method="POST">${safeUrl}</Redirect>
</Response>`;
}

function buildHangupTwiml(spokenText: string): string {
  const safe = escapeXml(spokenText);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">${safe}</Say>
  <Hangup />
</Response>`;
}

function parseAiResponse(raw: string): {
  spoken: string;
  intake: Partial<IntakeData>;
  done: boolean;
} {
  let text = raw.trim();
  const intake: Partial<IntakeData> = {};
  let done = false;

  if (text.includes('##DONE##')) {
    done = true;
    text = text.replace(/##DONE##/g, '').trim();
  }

  const intakeMatch = text.match(/##INTAKE##\s*(\{[^}]+\})/);
  if (intakeMatch) {
    try {
      const parsed = JSON.parse(intakeMatch[1]) as Partial<IntakeData>;
      Object.assign(intake, parsed);
    } catch {
      // Malformed JSON — ignore and continue
    }
    text = text.replace(/##INTAKE##[\s\S]*/, '').trim();
  }

  return {
    spoken: text || "No worries, we'll be in touch soon!",
    intake,
    done,
  };
}

async function saveIntake(
  db: admin.firestore.Firestore,
  session: ReceptionistSession,
): Promise<void> {
  if (!session.firmId) return;

  await db
    .collection('firms')
    .doc(session.firmId)
    .collection('intakes')
    .add({
      callSid: session.callSid,
      callerPhone: session.callerPhone,
      firmId: session.firmId,
      intake: session.intake,
      urgency: session.intake.urgency ?? 'normal',
      status: 'new',
      turnCount: session.turnCount,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

// ---------------------------------------------------------------------------
// receptionistWebhook — handles initial call + every gather callback
// ---------------------------------------------------------------------------

export const receptionistWebhook = onRequest(
  {
    region: 'us-east1',
    secrets: [TWILIO_AUTH_TOKEN],
    timeoutSeconds: 30,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const db = admin.firestore();
    const body = req.body as Record<string, string>;

    const callSid = body.CallSid ?? '';
    const callerPhone = body.From ?? 'unknown';
    const speechResult = (body.SpeechResult ?? '').trim();
    const firmId = (req.query.firmId as string) ?? '';

    if (!callSid) {
      res.status(400).type('text/xml').send('<Response><Hangup /></Response>');
      return;
    }

    // Validate Twilio webhook signature.
    // When TWILIO_AUTH_TOKEN is set, both the presence and correctness of
    // x-twilio-signature are required — missing header is rejected, not bypassed.
    const authToken = TWILIO_AUTH_TOKEN.value();
    if (authToken) {
      const twilioSig = req.headers['x-twilio-signature'] as string | undefined;
      if (!twilioSig) {
        logger.warn('Missing x-twilio-signature header', { callSid });
        res.status(403).send('Forbidden');
        return;
      }
      const fullUrl = `https://${req.headers['host'] as string}${req.originalUrl}`;
      if (!validateTwilioSignature(authToken, fullUrl, body, twilioSig)) {
        logger.warn('Invalid Twilio signature', { callSid });
        res.status(403).send('Forbidden');
        return;
      }
    }

    // Action URL — Twilio POSTs here after each gather
    const host = req.headers['host'] as string;
    const actionUrl = `https://${host}${req.path}?firmId=${encodeURIComponent(firmId)}`;

    // Load or initialize session
    const sessionRef = db.collection('receptionistSessions').doc(callSid);
    const sessionSnap = await sessionRef.get();

    let session: ReceptionistSession;
    if (!sessionSnap.exists) {
      session = {
        callSid,
        callerPhone,
        firmId,
        conversation: [],
        intake: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
        turnCount: 0,
        timeoutCount: 0,
      };
    } else {
      session = sessionSnap.data() as ReceptionistSession;
    }

    // ── Initial greeting ──────────────────────────────────────────────────────
    if (!speechResult && session.turnCount === 0) {
      const greeting =
        "Hey! Thanks for calling Elias Counsel, this is Carmela — how can I help you today?";
      session.conversation.push({ role: 'assistant', content: greeting, ts: Date.now() });
      session.turnCount = 1;
      session.updatedAt = Date.now();
      await sessionRef.set(session);
      res.set('Content-Type', 'text/xml');
      res.send(buildGatherTwiml(greeting, actionUrl));
      return;
    }

    // ── Gather timeout (caller not speaking) ──────────────────────────────────
    if (!speechResult) {
      session.timeoutCount = (session.timeoutCount ?? 0) + 1;
      session.updatedAt = Date.now();

      if (session.timeoutCount >= 3) {
        session.status = 'completed';
        await sessionRef.set(session);
        if (session.intake.name || session.intake.phone || session.intake.email) {
          await saveIntake(db, session);
        }
        res.set('Content-Type', 'text/xml');
        res.send(
          buildHangupTwiml(
            "I'm having a little trouble hearing you — if you'd like a callback, give us a ring at 609-655-3200. Have a great day!",
          ),
        );
        return;
      }

      await sessionRef.set(session);
      const reprompt = session.timeoutCount === 1
        ? "Sorry, didn't quite catch that — what can I help you with today?"
        : "Still having trouble hearing you — go ahead and speak anytime.";
      res.set('Content-Type', 'text/xml');
      res.send(buildGatherTwiml(reprompt, actionUrl));
      return;
    }

    // ── Process speech result ─────────────────────────────────────────────────
    session.conversation.push({ role: 'user', content: speechResult, ts: Date.now() });
    session.timeoutCount = 0;

    // Build history string for AI (last 14 turns to stay within token budget)
    const historyLines = session.conversation
      .slice(-14)
      .map(t => `${t.role === 'user' ? 'Caller' : 'Carmela'}: ${t.content}`)
      .join('\n');

    const userPrompt = `Conversation so far:\n${historyLines}\n\nContinue as Carmela — max 2 sentences. Append ##INTAKE## JSON with any new info learned, and ##DONE## if you've said goodbye.`;

    // Load firm data for AI provider selection
    let firmData: FirmData = {};
    if (firmId) {
      try {
        const firmSnap = await db.collection('firms').doc(firmId).get();
        if (firmSnap.exists) firmData = firmSnap.data() as FirmData;
      } catch {
        // Non-fatal — AI falls back to env-var API keys
      }
    }

    // Call Claude Haiku for minimal latency
    let aiText: string;
    try {
      aiText = await callAI(
        SYSTEM_PROMPT,
        userPrompt,
        firmData,
        { model: 'claude-haiku-4-5-20251001', temperature: 0.65, maxTokens: 300 },
      );
    } catch (err) {
      logger.error('AI call failed', { callSid, err });
      aiText =
        "Sorry, I'm having a quick technical moment — can you give me your name and best number and I'll make sure someone calls you right back?";
    }

    const { spoken, intake: newIntake, done } = parseAiResponse(aiText);

    // Merge newly extracted intake fields
    session.intake = { ...session.intake, ...newIntake };
    session.conversation.push({ role: 'assistant', content: spoken, ts: Date.now() });
    session.turnCount += 1;
    session.updatedAt = Date.now();

    // Hard cutoff at 18 turns to prevent runaway calls
    const callComplete = done || session.turnCount >= 18;

    if (callComplete) {
      session.status = 'completed';
      await sessionRef.set(session);
      await saveIntake(db, session);

      const farewell = done
        ? spoken
        : "Alright, I got what I need! Adam and his team will reach out to get something on the calendar. Thanks so much for calling!";
      res.set('Content-Type', 'text/xml');
      res.send(buildHangupTwiml(farewell));
      return;
    }

    await sessionRef.set(session);
    res.set('Content-Type', 'text/xml');
    res.send(buildGatherTwiml(spoken, actionUrl));
  },
);

// ---------------------------------------------------------------------------
// receptionistStatus — Twilio call-status callback
// Saves intake if call ended before receptionistWebhook completed the flow
// ---------------------------------------------------------------------------

export const receptionistStatus = onRequest(
  {
    region: 'us-east1',
    secrets: [TWILIO_AUTH_TOKEN],
    timeoutSeconds: 30,
  },
  async (req, res) => {
    const body = req.body as Record<string, string>;
    const callSid = body.CallSid ?? '';
    const callStatus = body.CallStatus ?? '';

    // Validate signature before any writes — same rules as receptionistWebhook.
    const authToken = TWILIO_AUTH_TOKEN.value();
    if (authToken) {
      const twilioSig = req.headers['x-twilio-signature'] as string | undefined;
      if (!twilioSig) {
        logger.warn('Missing x-twilio-signature in status callback', { callSid });
        res.status(403).send('Forbidden');
        return;
      }
      const fullUrl = `https://${req.headers['host'] as string}${req.originalUrl}`;
      if (!validateTwilioSignature(authToken, fullUrl, body, twilioSig)) {
        logger.warn('Invalid Twilio signature in status callback', { callSid });
        res.status(403).send('Forbidden');
        return;
      }
    }

    // Respond after validation — Twilio doesn't need the response body
    res.status(200).send('ok');

    if (!callSid) return;

    const terminal = new Set(['completed', 'no-answer', 'busy', 'failed', 'canceled']);
    if (!terminal.has(callStatus)) return;

    const db = admin.firestore();
    const sessionRef = db.collection('receptionistSessions').doc(callSid);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) return;

    const session = sessionSnap.data() as ReceptionistSession;
    if (session.status === 'completed') return;

    // Call ended unexpectedly — save whatever intake was collected
    const hasData =
      session.intake.name || session.intake.phone || session.intake.email;
    if (hasData) {
      session.status = 'completed';
      await sessionRef.set(session);
      await saveIntake(db, session);
    }
  },
);
