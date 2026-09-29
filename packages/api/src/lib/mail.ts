/**
 * Sending email: readthicket.com only (HOSTED). Four messages, all about
 * getting into your account — confirm an address, a note to the old address
 * when it changes, a reset link, and "your password was changed". thicket
 * sends nothing else.
 *
 * Plain SMTP, so any provider works. With no SMTP_URL (dev), the message is
 * printed to the log so the links can be clicked while testing.
 *
 * send() never throws. A message that didn't go out returns false and logs the
 * provider's own reason, so support can see why; the caller tells the person.
 */
import nodemailer from "nodemailer";
import { MAIL_FROM, PUBLIC_URL, SMTP_URL } from "./config.js";

const transport = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null;

export type Message = { to: string; subject: string; text: string };

export async function send(msg: Message): Promise<boolean> {
  if (!transport) {
    console.log(`[mail] (not sent: no SMTP_URL) to ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`);
    return true;
  }
  try {
    await transport.sendMail({ from: MAIL_FROM, ...msg });
    return true;
  } catch (e) {
    console.error(`[mail] sending "${msg.subject}" to ${msg.to} failed:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/** A loose check: something@something.something, no spaces. The confirmation link is the real test. */
export function looksLikeEmail(s: string): boolean {
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function cleanEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

const sign = "\n\n— thicket\nreadthicket.com";

export const messages = {
  confirm: (handle: string, token: string): Omit<Message, "to"> => ({
    subject: "Confirm your email for thicket",
    text: `Hi @${handle},\n\nClick this link to confirm this is your email. Then, if you ever forget your password, we can send you a link to reset it.\n\n${PUBLIC_URL}/confirm-email?token=${token}\n\nThe link expires in 24 hours. If you didn't sign up for thicket or add this email, you can ignore this message.${sign}`,
  }),
  changed: (handle: string, next: string): Omit<Message, "to"> => ({
    subject: "Your thicket email is changing",
    text: `Hi @${handle},\n\nSomeone asked to change the email on your thicket account to ${next}. Once that address is confirmed, password reset links will go there instead of here.\n\nIf this wasn't you, log in and change your password right away.${sign}`,
  }),
  reset: (handle: string, token: string): Omit<Message, "to"> => ({
    subject: "Reset your thicket password",
    text: `Hi @${handle},\n\nSomeone asked to reset the password for your thicket account. To choose a new one, click this link:\n\n${PUBLIC_URL}/reset-password?token=${token}\n\nThe link expires in 1 hour and works once. If you didn't ask for this, you can ignore this message. Your password won't change.${sign}`,
  }),
  passwordChanged: (handle: string): Omit<Message, "to"> => ({
    subject: "Your thicket password was changed",
    text: `Hi @${handle},\n\nThe password for your thicket account was just changed, and every other device was logged out.\n\nIf this wasn't you, reset your password right away at ${PUBLIC_URL}/forgot-password.${sign}`,
  }),
};
