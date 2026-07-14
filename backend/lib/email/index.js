const nodemailer = require('nodemailer')

const HOST = process.env.SMTP_HOST || ''
const PORT = Number(process.env.SMTP_PORT || 465)
const SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : PORT === 465
const USER = process.env.SMTP_USER || ''
const PASS = process.env.SMTP_PASS || ''
const FROM = process.env.SMTP_FROM || USER

let transporter = null

function isConfigured() {
  return Boolean(HOST && USER && PASS)
}

function getTransport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: SECURE,
      auth: { user: USER, pass: PASS }
    })
  }
  return transporter
}

/**
 * Send an email.
 * @param {object} p { to, subject, html, text, attachments:[{filename, content(Buffer)}] }
 */
async function sendMail({ to, subject, html, text, attachments = [] }) {
  if (!isConfigured()) {
    return { ok: false, error: 'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)' }
  }
  if (!to) return { ok: false, error: 'No recipient email set' }

  try {
    const info = await getTransport().sendMail({ from: FROM, to, subject, html, text, attachments })
    return { ok: true, messageId: info.messageId }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function verifyConnection() {
  if (!isConfigured()) return { ok: false, error: 'SMTP not configured' }
  try {
    await getTransport().verify()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = { sendMail, verifyConnection, isConfigured, FROM }
