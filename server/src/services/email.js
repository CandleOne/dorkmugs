// src/services/email.js — transactional email via Nodemailer
const nodemailer = require('nodemailer');
const config = require('../config');

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }
  return _transporter;
}

async function send({ to, subject, html }) {
  if (!config.email.host) {
    // Email not configured — log to console in development
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    return;
  }
  await getTransporter().sendMail({ from: config.email.from, to, subject, html });
}

// ─── Email templates ─────────────────────────────────────────────────────────

function wrap(title, body) {
  return `
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      body { font-family: Arial, sans-serif; background:#f4f4f4; margin:0; padding:0; }
      .box { max-width:560px; margin:40px auto; background:#fff; border-radius:8px;
             padding:32px; box-shadow:0 2px 8px rgba(0,0,0,.08); }
      h1 { color:#1a1a1a; font-size:22px; margin:0 0 16px; }
      p  { color:#444; line-height:1.6; }
      a.btn { display:inline-block; margin:20px 0; padding:12px 24px;
              background:#222; color:#fff; text-decoration:none; border-radius:4px; }
      .footer { margin-top:32px; font-size:12px; color:#999; }
    </style></head><body>
    <div class="box">
      <h1>${title}</h1>
      ${body}
      <div class="footer">&copy; 2026 Dork Mugs &mdash; <a href="${config.siteUrl}">${new URL(config.siteUrl).hostname}</a></div>
    </div></body></html>`;
}

async function sendWelcome(to, name) {
  await send({
    to,
    subject: 'Welcome to Dork Mugs!',
    html: wrap(
      `Welcome, ${name}!`,
      `<p>Your account is all set. Start browsing our collection of mugs for dorks.</p>
       <a class="btn" href="${config.siteUrl}/product.html">Shop Now</a>`
    ),
  });
}

async function sendPasswordReset(to, resetUrl) {
  await send({
    to,
    subject: 'Reset your Dork Mugs password',
    html: wrap(
      'Password Reset Request',
      `<p>We received a request to reset your password. Click the button below to create a new one.
       The link expires in <strong>1 hour</strong>.</p>
       <a class="btn" href="${resetUrl}">Reset Password</a>
       <p>If you didn't request this, you can safely ignore this email.</p>`
    ),
  });
}

async function sendOrderConfirmation(to, order) {
  const itemRows = order.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${i.name}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${(i.price * i.qty).toFixed(2)}</td>
        </tr>`
    )
    .join('');

  await send({
    to,
    subject: `Order Confirmed — Dork Mugs #${order.id.slice(-8).toUpperCase()}`,
    html: wrap(
      'Your order is confirmed!',
      `<p>Thanks for your order. We&rsquo;ll send another email when it ships.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0">
         <thead>
           <tr style="background:#f4f4f4">
             <th style="padding:8px;text-align:left">Item</th>
             <th style="padding:8px;text-align:center">Qty</th>
             <th style="padding:8px;text-align:right">Price</th>
           </tr>
         </thead>
         <tbody>${itemRows}</tbody>
         <tfoot>
           <tr>
             <td colspan="2" style="padding:8px;text-align:right;font-weight:bold">Total</td>
             <td style="padding:8px;text-align:right;font-weight:bold">$${order.total.toFixed(2)}</td>
           </tr>
         </tfoot>
       </table>
       <a class="btn" href="${config.siteUrl}/account.html">View Order</a>`
    ),
  });
}

async function sendShippingUpdate(to, order) {
  await send({
    to,
    subject: `Your Dork Mugs order has shipped!`,
    html: wrap(
      'Your mug is on the way!',
      `<p>Order <strong>#${order.id.slice(-8).toUpperCase()}</strong> has shipped.</p>
       ${order.trackingUrl ? `<a class="btn" href="${order.trackingUrl}">Track Package</a>` : ''}
       ${order.trackingNumber ? `<p>Tracking number: <strong>${order.trackingNumber}</strong></p>` : ''}`
    ),
  });
}

async function sendContactMessage({ name, email, subject, message }) {
  const CONTACT_TO = process.env.CONTACT_EMAIL || config.email.from || 'hello@dorkmugs.shop';
  await send({
    to: CONTACT_TO,
    subject: `[Contact] ${subject} — from ${name}`,
    html: wrap(
      'New contact form message',
      `<p><strong>From:</strong> ${name} &lt;${email}&gt;</p>
       <p><strong>Subject:</strong> ${subject}</p>
       <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
       <p style="white-space:pre-wrap">${message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
       <p style="color:#999;font-size:12px">Reply directly to: <a href="mailto:${email}">${email}</a></p>`
    ),
  });
}

module.exports = { sendWelcome, sendPasswordReset, sendOrderConfirmation, sendShippingUpdate, sendContactMessage };
