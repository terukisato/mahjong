'use strict';
// Dev-mode "sender" for email sign-up (see profiles.js's signUpWithEmail/
// resendVerification and 'signup'/'resend_verification' in index.js) — no
// SMTP relay or transactional email API (nodemailer, SES, Resend, Postmark,
// etc) is wired up yet, so this just logs the message to the server
// console/logs instead of actually delivering it. That keeps the whole
// signup -> verify loop testable end-to-end today (open the server log,
// copy the link) without any external account or credentials.
//
// Swap the body of sendMail for a real provider when one's set up — every
// caller already only depends on this one function's signature, so nothing
// else in the codebase needs to change.
function sendMail({ to, subject, text }) {
  console.log(`\n📧 [dev-mode email — not actually sent, see server/mailer.js]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
}

module.exports = { sendMail };
