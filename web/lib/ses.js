import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import nodemailer from "nodemailer";

let client;
let smtpTransporter;

function getClient() {
  const region = String(process.env.AWS_REGION || "").trim();
  if (!region) throw new Error("AWS_REGION is required to send OTP email");
  if (!client) client = new SESClient({ region });
  return client;
}

function smtpConfig() {
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  return user && pass ? { user, pass } : null;
}

function getSmtpTransporter(config) {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: config,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  return smtpTransporter;
}

async function sendEmail({ to, subject, text, html }) {
  const requestedTransport = String(process.env.EMAIL_TRANSPORT || "").trim().toLowerCase();
  const smtp = smtpConfig();
  const sesFrom = String(process.env.SES_FROM_EMAIL || "").trim();
  const useSes = requestedTransport === "ses" || (!smtp && Boolean(sesFrom));

  if (!useSes && smtp) {
    await getSmtpTransporter(smtp).sendMail({
      from: `"JobLookout" <${smtp.user}>`,
      to,
      subject,
      text,
      html,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return;
  }

  if (!sesFrom) {
    throw new Error("Configure SES_FROM_EMAIL or both SMTP_USER and SMTP_PASS to send email");
  }

  await getClient().send(new SendEmailCommand({
    Source: sesFrom,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: text, Charset: "UTF-8" },
        Html: { Data: html, Charset: "UTF-8" },
      },
    },
  }));
}

export async function sendOtpEmail(to, code) {
  await sendEmail({
    to,
    subject: "Your JobLookout verification code",
    text: `Your JobLookout verification code is: ${code}. It expires in 5 minutes. If you did not request this code, ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:28px;background:#07100e;color:#f4f8f1;border-radius:20px"><div style="color:#d7ff70;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase">JobLookout</div><h2 style="margin:18px 0 8px;font-size:24px">Your verification code</h2><p style="color:#a7b2aa;line-height:1.6">Use this code to finish setting up your lookout:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:18px;background:#12201b;border:1px solid #294036;border-radius:12px;text-align:center;color:#d7ff70">${code}</div><p style="color:#7f8c84;font-size:13px;line-height:1.6;margin-top:18px">This code expires in 5 minutes. If you did not request it, you can ignore this email.</p></div>`,
  });
}

export async function sendPasswordResetEmail(to, code) {
  await sendEmail({
    to,
    subject: "Reset your JobLookout password",
    text: `Your JobLookout password reset code is: ${code}. It expires in 10 minutes. If you did not request this reset, ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:28px;background:#07100e;color:#f4f8f1;border-radius:20px"><div style="color:#d7ff70;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase">JobLookout</div><h2 style="margin:18px 0 8px;font-size:24px">Reset your password</h2><p style="color:#a7b2aa;line-height:1.6">Use this one-time code to choose a new password:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:18px;background:#12201b;border:1px solid #294036;border-radius:12px;text-align:center;color:#d7ff70">${code}</div><p style="color:#7f8c84;font-size:13px;line-height:1.6;margin-top:18px">This code expires in 10 minutes. If you did not request a reset, your password remains unchanged.</p></div>`,
  });
}
