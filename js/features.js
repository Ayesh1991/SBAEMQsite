/* ============================================================
   features.js — the switches the owner throws, and everyone obeys.

   WHY THIS EXISTS

   The Real station — two people, two devices, one live OSCE — is the
   most expensive thing in the application to leave switched on, and it
   is expensive even when nobody is using it. A candidate who opens the
   page and leaves the tab there is asking the database "has anybody
   invited me yet?" every ten seconds, for as long as the tab is open,
   at a whole row set per ask. Nothing is happening; the bill is not
   zero. Multiply by a class of registrars who each opened it once out of
   curiosity, and a feature that is used for an hour a fortnight is
   quietly the second-largest line in the egress.

   The honest answer to a feature like that is not to optimise it into
   the ground. It is to be able to TURN IT OFF, and to turn it on for the
   evening it is wanted. Which is what this is.

   THE RULES A SWITCH MUST FOLLOW

   • OFF MEANS NOTHING RUNS. Not a hidden tab with the timer still
     ticking behind it — no poll, no realtime subscription, no lookup
     of a remembered session, nothing on any page. A switch that only
     hides the button saves nothing and is worse than no switch,
     because it looks like it worked.

   • OFF MUST NOT BREAK A ROUTE. Somebody has the link, or a bookmark,
     or scanned the code. They get a page that says the feature is off,
     not a white screen and not a redirect to somewhere they did not
     ask for.

   • THE ANSWER IS CACHED, AND CACHED HONESTLY. Reading a config row on
     every page load would be its own small tax on the thing this is
     meant to reduce. It is read once per session and held; the
     developer's own save updates it immediately, so the person turning
     it on never has to explain the delay to themselves.

   • WHEN IT CANNOT BE READ, THE ANSWER IS THE DEFAULT — never an
     error, and never "on" by accident. An unreachable backend must not
     be able to switch a feature on.

   • A SWITCH IS NOT SECURITY. It decides what the app does, not what
     the database permits; anyone determined can still call the API.
     That is fine — this is a cost control and a convenience, and it
     says so rather than pretending otherwise.

   DEFAULTS

   `realStation` is OFF, because that is what was asked for: on for the
   evenings it is wanted and off the rest of the time. Everything not
   listed here is on — a switch nobody has defined cannot disable
   anything.
   ============================================================ */

const Features = (() => {

  /* The switches that exist, what they mean, and what they are when
     nobody has said. Adding one is adding a line here and reading it
     where it matters. */
  const DEFAULTS = {
    realStation: false      // the live two-person OSCE across devices
  };

  const META = {
    realStation: {
      label: 'Real station',
      what: 'Two people, two devices, one live OSCE — the examiner sends each question from their sheet and the candidate answers on theirs.',
      cost: 'While it is on, an open Real station page asks the database for your invitations every ten seconds. That is its whole cost when nobody is using it, and it is not nothing.',
      off: 'The tab is hidden, the page says it is off, and nothing polls or subscribes anywhere in the app.'
    }
  };

  let held = null;          // what the backend said, once we have asked
  let asking = null;
  const listeners = new Set();
  const ping = () => listeners.forEach(fn => { try { fn(); } catch {} });

  /** Ask once. Never throws; an unreachable backend leaves the defaults. */
  async function load(force) {
    if (held && !force) return held;
    if (asking && !force) return asking;
    asking = (async () => {
      let got = null;
      try { got = await Backend.getFeatureSwitches(); } catch { got = null; }
      /* Only known keys, and only real booleans. A stray value in the
         config row cannot invent a switch or leave one undefined. */
      const out = Object.assign({}, DEFAULTS);
      if (got && typeof got === 'object') {
        Object.keys(DEFAULTS).forEach(k => { if (typeof got[k] === 'boolean') out[k] = got[k]; });
      }
      held = out; asking = null; ping();
      return held;
    })();
    return asking;
  }

  /**
   * Is it on, right now, without waiting?
   *
   * Before load() has answered this is the DEFAULT, which for an
   * expensive feature means off. That is deliberate: a page that draws
   * before the switch arrives must not start a poll it will have to be
   * told to stop.
   */
  const on = name => (held ? held[name] : DEFAULTS[name]) === true;
  const known = () => held != null;
  const all = () => Object.assign({}, DEFAULTS, held || {});

  /** Set one switch. Developer only — the database says so, not this. */
  async function set(name, value) {
    if (!(name in DEFAULTS)) throw new Error('There is no switch called ' + name + '.');
    const next = Object.assign({}, all(), { [name]: !!value });
    await Backend.saveFeatureSwitches(next);
    held = next; ping();
    return next;
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function bust() { held = null; asking = null; }

  /** The card a switched-off feature shows in place of itself. */
  function offCard(name, extra) {
    const m = META[name] || {};
    return `<div class="card ft-off" data-animate>
      <h3 class="card-title">⏻ ${esc(m.label || name)} is switched off</h3>
      <p class="muted">${esc(m.what || '')}</p>
      <p class="muted tiny">It is off at the moment, and nothing about it is running. ${esc(extra || '')}</p>
      <p class="muted tiny">The site owner turns it on in <strong>Developer → Settings</strong> when it is wanted.</p>
    </div>`;
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return { DEFAULTS, META, load, on, known, all, set, onChange, bust, offCard };
})();
