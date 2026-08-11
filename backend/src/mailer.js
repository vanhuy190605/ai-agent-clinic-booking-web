const nodemailer = require('nodemailer');

function isDryRun() {
  return String(process.env.EMAIL_DRY_RUN || 'true').toLowerCase() === 'true';
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
    disableFileAccess: true,
    disableUrlAccess: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendResetCode(to, code) {
  if (isDryRun() || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[EMAIL_DRY_RUN] Reset code for ${to}: ${code}`);
    return { dryRun: true, code };
  }

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `Clinic AI Agent <${process.env.SMTP_USER}>`,
    to,
    subject: 'Mã khôi phục mật khẩu Clinic AI Agent',
    text: `Mã khôi phục mật khẩu của bạn là: ${code}. Mã có hiệu lực trong 10 phút.`,
    html: `<p>Mã khôi phục mật khẩu của bạn là:</p><h2>${code}</h2><p>Mã có hiệu lực trong 10 phút.</p>`,
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return { dryRun: false };
}

module.exports = { sendResetCode };
