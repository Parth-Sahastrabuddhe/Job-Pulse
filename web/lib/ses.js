import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendOtpEmail(to, code) {
  const from = process.env.SMTP_USER;
  await transporter.sendMail({
    from: `"JobPulse" <${from}>`,
    to,
    subject: `JobPulse verification code: ${code}`,
    text: `Your JobPulse verification code is: ${code}. It expires in 5 minutes.`,
    html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px;"><h2 style="color:#5865F2;">JobPulse</h2><p>Your verification code is:</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#f0f0f0;border-radius:8px;text-align:center;">${code}</div><p style="color:#666;font-size:14px;margin-top:16px;">This code expires in 5 minutes.</p></div>`,
  });
}
