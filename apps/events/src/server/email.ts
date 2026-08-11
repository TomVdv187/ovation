import { Resend } from "resend";

/**
 * Outbound mail.
 *
 * With RESEND_API_KEY set, mail goes out through Resend. Without it, the whole
 * message — headers, text body, attachment manifest — is printed to the server
 * console instead. That is deliberate and load-bearing: a fresh clone with no
 * credentials must still be able to complete a registration end to end, and the
 * developer must be able to read the confirmation they would have received.
 */

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface EmailResult {
  /** True when a provider accepted it. False means it was logged, not sent. */
  delivered: boolean;
  providerMessageId: string | null;
  error: string | null;
}

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function from(): string {
  return process.env.EMAIL_FROM ?? "OVATION <hello@ovation.local>";
}

export async function sendEmail(email: OutboundEmail): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    logToConsole(email);
    return { delivered: false, providerMessageId: null, error: null };
  }

  try {
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({
      from: from(),
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
      ...(email.attachments?.length
        ? {
            attachments: email.attachments.map((a) => ({
              filename: a.filename,
              content: a.content.toString("base64"),
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
    });

    if (error) {
      console.error("[email] Resend rejected the message:", error.message);
      return {
        delivered: false,
        providerMessageId: null,
        error: error.message,
      };
    }

    return { delivered: true, providerMessageId: data?.id ?? null, error: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error("[email] send failed:", message);
    return { delivered: false, providerMessageId: null, error: message };
  }
}

function logToConsole(email: OutboundEmail): void {
  const rule = "─".repeat(72);
  const attachments = (email.attachments ?? [])
    .map((a) => `  • ${a.filename} (${a.contentType ?? "?"}, ${a.content.length} bytes)`)
    .join("\n");

  console.log(
    [
      "",
      rule,
      "  EMAIL — not sent (RESEND_API_KEY is unset). Printed instead.",
      rule,
      `  From:    ${from()}`,
      `  To:      ${email.to}`,
      `  Subject: ${email.subject}`,
      attachments ? `  Attachments:\n${attachments}` : "  Attachments: none",
      rule,
      email.text.trim(),
      rule,
      "",
    ].join("\n"),
  );
}
