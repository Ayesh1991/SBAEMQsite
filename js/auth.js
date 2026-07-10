/* ============================================================
   auth.js — client-side account management.
   Passwords are never stored in plain text: they are salted and
   hashed with SHA-256 via the Web Crypto API.

   NOTE: this is browser-local authentication for a static site.
   Accounts and progress live in the browser that created them.
   See README.md for the path to a hosted backend (Supabase /
   Firebase) if cross-device sync is ever needed.
   ============================================================ */

const Auth = (() => {

  async function hash(text) {
    if (window.crypto && crypto.subtle) {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback (non-secure contexts): FNV-1a, better than plain text but weak.
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return 'fnv-' + (h >>> 0).toString(16);
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    (window.crypto || {}).getRandomValues
      ? crypto.getRandomValues(bytes)
      : bytes.forEach((_, i) => bytes[i] = Math.floor(Math.random() * 256));
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function normaliseEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  async function register(name, email, password) {
    name = String(name || '').trim();
    email = normaliseEmail(email);

    if (name.length < 2) throw new Error('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address.');
    if (String(password).length < 8) throw new Error('Password must be at least 8 characters.');
    if (Store.getUser(email)) throw new Error('An account with this email already exists. Try signing in.');

    const salt = randomSalt();
    const passHash = await hash(salt + password);
    const user = { name, email, salt, passHash, createdAt: Date.now() };
    Store.saveUser(user);
    Store.setSession(email);
    return user;
  }

  async function login(email, password) {
    email = normaliseEmail(email);
    const user = Store.getUser(email);
    if (!user) throw new Error('No account found for this email. Create one first.');
    const passHash = await hash(user.salt + password);
    if (passHash !== user.passHash) throw new Error('Incorrect password. Please try again.');
    Store.setSession(email);
    return user;
  }

  function logout() {
    Store.clearSession();
  }

  function currentUser() {
    const session = Store.getSession();
    if (!session) return null;
    return Store.getUser(session.email);
  }

  return { register, login, logout, currentUser };
})();
