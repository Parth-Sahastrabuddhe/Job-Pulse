import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });

export async function sendOtpEmail(to, code) {
  const from = process.env.SES_FROM_EMAIL || "noreply@jobpulse.app";
  const command = new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: `JobPulse verification code: ${code}` },
      Body: {
        Html: {
          Data: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px;"><h2 style="color:#5865F2;">JobPulse</h2><p>Your verification code is:</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#f0f0f0;border-radius:8px;text-align:center;">${code}</div><p style="color:#666;font-size:14px;margin-top:16px;">This code expires in 5 minutes.</p></div>`
        },
        Text: { Data: `Your JobPulse verification code is: ${code}. It expires in 5 minutes.` }
      }
    }
  });
  await ses.send(command);
}
