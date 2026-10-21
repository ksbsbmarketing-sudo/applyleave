// Gmail SMTP sender. Credentials come from Vercel env vars, never the client:
//   GMAIL_USER          the sending Gmail address
//   GMAIL_APP_PASSWORD  a Google "App Password" (16 chars) for that account
import nodemailer from "nodemailer";

let transporter;

export function mailConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function sendMail({ to, subject, html, text }) {
  if (!mailConfigured()) throw new Error("mail_not_configured");
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
    });
  }
  return transporter.sendMail({
    from: { name: "KSB Leave System", address: process.env.GMAIL_USER },
    to, subject, html, text,
  });
}
