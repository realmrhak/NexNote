/**
 * COMBINED FIX #1: Gmail SMTP (Nodemailer) only — Resend removed entirely.
 *
 * Previously this module supported BOTH Resend (primary) and Nodemailer/SMTP
 * (fallback). Per the user's instruction we now use Gmail SMTP ONLY:
 *
 *   - Removed the `resend` package from package.json
 *   - Removed all `RESEND_API_KEY` references
 *   - The `sendTeamInvite` and `sendTestEmail` functions go straight to
 *     Nodemailer with the `service: 'gmail'` shortcut (so we don't need to
 *     remember SMTP_HOST/SMTP_PORT — Gmail's defaults are baked in).
 *
 * Required env vars (see backend/.env.example):
 *   SMTP_USER = your-email@gmail.com
 *   SMTP_PASS = your-16-char Gmail App Password (NO spaces)
 *
 * To generate an App Password:
 *   1. https://myaccount.google.com → Security
 *   2. Enable 2-Step Verification
 *   3. Search "App Passwords" → create one for "NexNote"
 *   4. Copy the 16-char password, remove spaces, set as SMTP_PASS
 */
const nodemailer = require("nodemailer");
const logger     = require("./logger");

// Create transporter lazily so missing SMTP config doesn't crash the whole app
// on startup (we'll log a warning the first time someone tries to send).
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  // COMBINED FIX #1: Use `service: 'gmail'` shortcut. This auto-configures
  // host/port/secure for Gmail so the user only needs to set SMTP_USER and
  // SMTP_PASS. We still honor SMTP_HOST/SMTP_PORT if explicitly set (for
  // users who want to use a different SMTP provider later).
  const usingGmailService = !process.env.SMTP_HOST && !process.env.SMTP_PORT;

  _transporter = nodemailer.createTransport(
    usingGmailService
      ? {
          service: "gmail",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
          // Better connection settings for Gmail
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 10000,
        }
      : {
          host:   process.env.SMTP_HOST,
          port:   parseInt(process.env.SMTP_PORT, 10) || 587,
          secure: false,
          requireTLS: true,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 10000,
        }
  );
  return _transporter;
}

/**
 * isSMTPConfigured — check if SMTP credentials are set
 */
function isSMTPConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * isEmailConfigured — kept for backwards compatibility with app.js.
 * Now equivalent to isSMTPConfigured() since Resend is gone.
 */
function isEmailConfigured() {
  return isSMTPConfigured();
}

/**
 * verifySMTP — verify the SMTP transporter can connect
 */
async function verifySMTP() {
  if (!isSMTPConfigured()) {
    return { ok: false, error: "SMTP_USER and SMTP_PASS are not set in .env" };
  }
  try {
    const transporter = getTransporter();
    await transporter.verify();
    logger.info("SMTP connection verified successfully");
    return { ok: true };
  } catch (err) {
    logger.error(`SMTP verification failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * getFromAddress — Always use SMTP_USER as the FROM address.
 * Gmail REJECTS or REPLACES the FROM header if it doesn't match the
 * authenticated user, so we ALWAYS use SMTP_USER as the sender.
 */
function getFromAddress() {
  const smtpUser = process.env.SMTP_USER;
  if (process.env.EMAIL_FROM && process.env.EMAIL_FROM.includes(smtpUser)) {
    return process.env.EMAIL_FROM;
  }
  return `"NexNote" <${smtpUser}>`;
}

/**
 * sendTeamInvite
 * Sends an invitation email to join a NexNote team via Gmail SMTP.
 * Includes BOTH HTML and plain-text versions for better deliverability,
 * plus anti-spam headers (List-Unsubscribe, Reply-To).
 */
async function sendTeamInvite({ toEmail, inviterName, teamName, inviteLink }) {
  const subject = `${inviterName} invited you to join "${teamName}" on NexNote`;

  // Plain-text version — important for spam filters and accessibility
  const text = `
NexNote — Your personal cloud notebook

${inviterName} has invited you to join the team "${teamName}" on NexNote.

As a team member, you will only have access to the notes and folders that are explicitly shared within the team — your personal notes stay completely private.

Accept the invitation:
${inviteLink}

This link expires in 7 days. If you did not expect this invitation, you can safely ignore this email.

NexNote
${process.env.FRONTEND_URL || "https://nexnote.app"}
  `.trim();

  // HTML version
  const html = `
    <div style="font-family:'Poppins',Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border:1px solid #e9e9e7;border-radius:10px;">
      <h2 style="font-size:22px;font-weight:800;color:#1a1a1a;margin:0 0 4px;">
        Nex<span style="color:#2383E2;">Note</span>
      </h2>
      <p style="color:#9b9a97;font-size:13px;margin:0 0 28px;">Your personal cloud notebook</p>

      <p style="font-size:15px;color:#1a1a1a;line-height:1.7;">
        <strong>${inviterName}</strong> has invited you to join the team
        <strong>"${teamName}"</strong> on NexNote.
      </p>

      <p style="font-size:14px;color:#6b6b6b;line-height:1.7;">
        As a team member, you will only have access to the notes and folders that are
        explicitly shared within the team — your personal notes stay completely private.
      </p>

      <a href="${inviteLink}"
         style="display:inline-block;margin:24px 0;padding:12px 28px;background:#2383E2;color:#fff;
                font-weight:700;font-size:15px;border-radius:8px;text-decoration:none;">
        Accept Invitation
      </a>

      <p style="font-size:12px;color:#9b9a97;margin-top:32px;">
        This link expires in <strong>7 days</strong>. If you did not expect this invitation, you can safely ignore this email.
      </p>

      <hr style="border:none;border-top:1px solid #e9e9e7;margin:24px 0;" />
      <p style="font-size:11px;color:#bbb;">
        If the button above does not work, copy and paste this link into your browser:<br/>
        <a href="${inviteLink}" style="color:#2383E2;word-break:break-all;">${inviteLink}</a>
      </p>
    </div>
  `;

  // COMBINED FIX #1: Resend branch removed — straight to Nodemailer/SMTP.
  if (!isSMTPConfigured()) {
    logger.warn("No email provider available — skipping invite email. Set SMTP_USER/SMTP_PASS in .env");
    return { sent: false, reason: "No email provider configured" };
  }

  const fromAddress = getFromAddress();

  try {
    const info = await getTransporter().sendMail({
      from:    fromAddress,
      to:      toEmail,
      subject: subject,
      text:    text,   // Plain-text version — critical for deliverability
      html:    html,   // HTML version
      // Anti-spam headers for better deliverability
      headers: {
        "X-Mailer":         "NexNote Mailer",
        "X-Priority":       "3",
        "List-Unsubscribe":  `<mailto:${process.env.SMTP_USER}?subject=Unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "Reply-To":         process.env.EMAIL_REPLY_TO || process.env.SMTP_USER,
        "X-Auto-Response-Suppress": "OOF, AutoReply",
        "Precedence":       "bulk",
      },
    });

    logger.info(`Team invite email sent to ${toEmail} via SMTP — MessageID: ${info.messageId} — Response: ${info.response}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`Failed to send invite email to ${toEmail}: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

/**
 * sendTestEmail — Send a simple test email to verify SMTP is working end-to-end
 */
async function sendTestEmail(toEmail) {
  if (!isEmailConfigured()) {
    return { sent: false, reason: "SMTP_USER and SMTP_PASS not configured. Set them in backend/.env (Gmail App Password — NOT your regular Gmail password)." };
  }

  const fromAddress = getFromAddress();

  try {
    const info = await getTransporter().sendMail({
      from:    fromAddress,
      to:      toEmail,
      subject: "NexNote SMTP Test — Email is working!",
      text:    "If you received this email, your NexNote SMTP configuration is working correctly!",
      html:    `<div style="font-family:Arial,sans-serif;padding:24px;">
        <h2 style="color:#2383E2;">NexNote SMTP Test</h2>
        <p>If you received this email, your SMTP configuration is <strong>working correctly</strong>!</p>
        <p style="color:#888;font-size:12px;">Sent from: ${fromAddress}</p>
      </div>`,
      headers: {
        "X-Mailer":         "NexNote Mailer",
        "Reply-To":         process.env.EMAIL_REPLY_TO || process.env.SMTP_USER,
        "List-Unsubscribe":  `<mailto:${process.env.SMTP_USER}?subject=Unsubscribe>`,
      },
    });

    logger.info(`Test email sent to ${toEmail} — MessageID: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`Test email failed: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendTeamInvite, sendTestEmail, isSMTPConfigured, isEmailConfigured, verifySMTP };
