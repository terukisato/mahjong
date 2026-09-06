'use strict';
// Regression tests for profiles.js's email sign-up path (signUpWithEmail/
// verifyEmailLogin/verifyEmailToken/resendVerification) — the existing
// name+code path (createProfile/verifyProfile) already has real-world
// mileage and no dedicated test file of its own; this one focuses on what's
// new. Same plain-assertion convention as economy.test.js/friends.test.js.
// Run with: node server/profiles.test.js
//
// DATA_DIR is read once, at module load — set it to a fresh temp directory
// BEFORE requiring profiles.js so these tests never touch server/data.
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-profiles-test-'));
const P = require('./profiles');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; failures.push({ name, error: e.message }); }
}
let n = 0;
const freshName = () => `Player${n++}`;
const freshEmail = () => `player${n++}@example.com`;

test('signUpWithEmail creates an account and returns a verify token', () => {
  const name = freshName(), email = freshEmail();
  const r = P.signUpWithEmail(name, email, 'hunter2pass', true);
  assert.strictEqual(r.ok, true);
  assert.ok(r.id);
  assert.strictEqual(r.name, name);
  assert.ok(r.verifyToken && r.verifyToken.length > 0);
});

test('signUpWithEmail lowercases and trims the email for storage/lookup', () => {
  const name = freshName(), email = freshEmail();
  P.signUpWithEmail(name, `  ${email.toUpperCase()}  `, 'hunter2pass', true);
  const login = P.verifyEmailLogin(email, 'hunter2pass');
  assert.ok(login);
  assert.strictEqual(login.name, name);
});

test('signUpWithEmail rejects a duplicate name', () => {
  const name = freshName();
  P.signUpWithEmail(name, freshEmail(), 'hunter2pass', true);
  const r = P.signUpWithEmail(name, freshEmail(), 'hunter2pass', true);
  assert.strictEqual(r.ok, false);
});

test('signUpWithEmail rejects a duplicate email', () => {
  const email = freshEmail();
  P.signUpWithEmail(freshName(), email, 'hunter2pass', true);
  const r = P.signUpWithEmail(freshName(), email, 'hunter2pass', true);
  assert.strictEqual(r.ok, false);
});

test('signUpWithEmail rejects a malformed email', () => {
  const r = P.signUpWithEmail(freshName(), 'not-an-email', 'hunter2pass', true);
  assert.strictEqual(r.ok, false);
});

test('signUpWithEmail rejects a short password', () => {
  const r = P.signUpWithEmail(freshName(), freshEmail(), 'short', true);
  assert.strictEqual(r.ok, false);
});

test('signUpWithEmail rejects when terms are not accepted', () => {
  const r = P.signUpWithEmail(freshName(), freshEmail(), 'hunter2pass', false);
  assert.strictEqual(r.ok, false);
});

test('verifyEmailLogin succeeds with the right password, fails with the wrong one', () => {
  const email = freshEmail();
  P.signUpWithEmail(freshName(), email, 'correct-password', true);
  assert.ok(P.verifyEmailLogin(email, 'correct-password'));
  assert.strictEqual(P.verifyEmailLogin(email, 'wrong-password'), null);
});

test('verifyEmailLogin fails for an unknown email', () => {
  assert.strictEqual(P.verifyEmailLogin('nobody@example.com', 'whatever1'), null);
});

test('a fresh signup starts unverified, and the right token verifies it', () => {
  const name = freshName(), email = freshEmail();
  const r = P.signUpWithEmail(name, email, 'hunter2pass', true);
  assert.strictEqual(P.verifyEmailLogin(email, 'hunter2pass').emailVerified, false);
  const v = P.verifyEmailToken(r.verifyToken);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.name, name);
  assert.strictEqual(P.verifyEmailLogin(email, 'hunter2pass').emailVerified, true);
});

test('verifyEmailToken rejects an unknown token', () => {
  const r = P.verifyEmailToken('not-a-real-token');
  assert.strictEqual(r.ok, false);
});

test('verifyEmailToken rejects reusing an already-consumed token', () => {
  const email = freshEmail();
  const r = P.signUpWithEmail(freshName(), email, 'hunter2pass', true);
  assert.strictEqual(P.verifyEmailToken(r.verifyToken).ok, true);
  assert.strictEqual(P.verifyEmailToken(r.verifyToken).ok, false);
});

test('resendVerification issues a fresh token for an unverified account', () => {
  const email = freshEmail();
  P.signUpWithEmail(freshName(), email, 'hunter2pass', true);
  const r = P.resendVerification(email);
  assert.strictEqual(r.ok, true);
  assert.ok(r.verifyToken);
  assert.strictEqual(P.verifyEmailToken(r.verifyToken).ok, true);
});

test('resendVerification is a generic ok:true, no token, for an unknown email (anti-enumeration)', () => {
  const r = P.resendVerification('nobody-here@example.com');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verifyToken, null);
});

test('resendVerification is a no-op once already verified', () => {
  const email = freshEmail();
  const signup = P.signUpWithEmail(freshName(), email, 'hunter2pass', true);
  P.verifyEmailToken(signup.verifyToken);
  const r = P.resendVerification(email);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verifyToken, null);
});

test('name+code profiles are unaffected by the email path existing', () => {
  const name = freshName();
  assert.strictEqual(P.createProfile(name, 'somecode123').ok, true);
  assert.strictEqual(P.verifyProfile(name, 'somecode123'), true);
  assert.strictEqual(P.verifyProfile(name, 'wrongcode'), false);
});

// login() is the single entry point the Log In form calls (see 'login' in
// server/index.js) — it has to work for a name+code profile AND an
// email+password one from the exact same two fields, without the caller
// saying which kind of account it is up front.
test('login succeeds for a name+code profile using the name as the identifier', () => {
  const name = freshName();
  P.createProfile(name, 'somecode123');
  const r = P.login(name, 'somecode123');
  assert.ok(r);
  assert.strictEqual(r.name, name);
  assert.strictEqual(r.emailVerified, false);
});

test('login succeeds for an email+password profile using the email as the identifier', () => {
  const name = freshName(), email = freshEmail();
  P.signUpWithEmail(name, email, 'hunter2pass', true);
  const r = P.login(email, 'hunter2pass');
  assert.ok(r);
  assert.strictEqual(r.name, name);
});

test('login also succeeds for an email+password profile using its NAME as the identifier', () => {
  const name = freshName(), email = freshEmail();
  P.signUpWithEmail(name, email, 'hunter2pass', true);
  const r = P.login(name, 'hunter2pass');
  assert.ok(r);
  assert.strictEqual(r.name, name);
  assert.strictEqual(r.id, P.getId(name));
});

test('login fails with the right identifier but the wrong secret, for either kind of account', () => {
  const codeName = freshName();
  P.createProfile(codeName, 'somecode123');
  assert.strictEqual(P.login(codeName, 'wrongcode'), null);

  const email = freshEmail();
  P.signUpWithEmail(freshName(), email, 'hunter2pass', true);
  assert.strictEqual(P.login(email, 'wrongpass'), null);
});

test('login returns null for an unknown identifier', () => {
  assert.strictEqual(P.login('nobody-at-all', 'whatever1'), null);
  assert.strictEqual(P.login('', 'whatever1'), null);
  assert.strictEqual(P.login('somebody', ''), null);
});

test('requestPasswordReset issues a token for a registered email, and it actually resets the password', () => {
  const name = freshName(), email = freshEmail();
  P.signUpWithEmail(name, email, 'oldpassword1', true);
  const r = P.requestPasswordReset(email);
  assert.strictEqual(r.ok, true);
  assert.ok(r.resetToken);
  const done = P.resetPassword(r.resetToken, 'newpassword1');
  assert.strictEqual(done.ok, true);
  assert.strictEqual(done.name, name);
  assert.strictEqual(P.login(email, 'oldpassword1'), null);
  assert.ok(P.login(email, 'newpassword1'));
});

test('requestPasswordReset is a generic ok:true, no token, for an unknown email (anti-enumeration)', () => {
  const r = P.requestPasswordReset('nobody-here-either@example.com');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.resetToken, null);
});

test('requestPasswordReset finds nothing for a name+code-only profile (no email on file)', () => {
  const name = freshName();
  P.createProfile(name, 'somecode123');
  const r = P.requestPasswordReset(name);
  assert.strictEqual(r.resetToken, null);
});

test('resetPassword rejects an unknown or already-used token', () => {
  assert.strictEqual(P.resetPassword('not-a-real-token', 'newpassword1').ok, false);
  const email = freshEmail();
  const signup = P.signUpWithEmail(freshName(), email, 'oldpassword1', true);
  const reset = P.requestPasswordReset(email);
  P.resetPassword(reset.resetToken, 'newpassword1');
  assert.strictEqual(P.resetPassword(reset.resetToken, 'anotherpassword1').ok, false);
});

test('resetPassword rejects a short new password', () => {
  const email = freshEmail();
  P.signUpWithEmail(freshName(), email, 'oldpassword1', true);
  const reset = P.requestPasswordReset(email);
  assert.strictEqual(P.resetPassword(reset.resetToken, 'short').ok, false);
});

console.log(`\nprofiles.test.js: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f.name}\n    ${f.error}`);
  process.exit(1);
}
