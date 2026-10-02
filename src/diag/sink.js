// Where the records go. Every record is kept in memory as one JSON line (so the whole session can be saved or copied from the
// page whatever happens to the network) and, when a collector answers (tools/metrics-collector.mjs, part of `npm run preview`),
// sent to it in batches every couple of seconds, and what is left over when the page closes goes out with sendBeacon.
// The wire format is NDJSON: one `{"sid":…,"k":…}` object a line, POSTed as text/plain.

const BATCH = 300000;      // bytes a POST carries at most
const BEACON = 60000;      // sendBeacon refuses more than about 64 KB

export class Sink {
  constructor({ sid, url = '/__metrics', win = window, keep = 14e6 } = {}) {
    this.sid = sid; this.url = url; this.win = win; this.keep = keep;
    this.state = url === 'off' ? 'local' : 'probing';      // probing | ok | offline | local (nobody to send to)
    this.lines = []; this.bytes = 0; this.next = 0;        // everything, and how many lines were sent
    this.sent = 0; this.failures = 0; this.truncated = 0; this.server = '';
  }

  // Asks the server whether it collects. A page served from anywhere else (Pages, an artifact) says no and stays local.
  async probe() {
    if (this.state === 'local') return this.state;
    try {
      const r = await this.win.fetch(this.url, { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (j?.ok) { this.state = 'ok'; this.server = j.name ?? ''; } else this.state = 'local';
    } catch { this.state = 'local'; }
    return this.state;
  }

  push(records) {
    for (const r of records) {
      const line = JSON.stringify({ sid: this.sid, ...r });
      this.lines.push(line); this.bytes += line.length + 1;
    }
    // Over the cap: drop the oldest raw frame chunks (the per-second buckets and events stay), and say so.
    for (let i = 0; this.bytes > this.keep && i < this.lines.length; i++) {
      const l = this.lines[i];
      if (l && l.slice(0, 80).includes('"k":"fr"')) { this.bytes -= l.length + 1; this.lines[i] = ''; this.truncated++; }
    }
  }

  get pending() { return this.lines.length - this.next; }

  // Sends what has not been sent. Resolves true when there is nothing left to send.
  async flush() {
    if (this.state !== 'ok' && this.state !== 'offline') return this.state === 'local';
    while (this.next < this.lines.length) {
      const from = this.next;
      let end = from, size = 0;
      while (end < this.lines.length && size < BATCH) size += this.lines[end++].length + 1;
      const body = this.lines.slice(from, end).filter(Boolean).join('\n');
      try {
        const r = await this.win.fetch(this.url, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: body.length < 60000 });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        this.next = end; this.sent += end - from; this.state = 'ok'; this.failures = 0;
      } catch {
        this.failures++; this.state = this.failures > 6 ? 'local' : 'offline';
        return false;
      }
    }
    return true;
  }

  // The page is going away: whatever is unsent goes out in beacons (they survive the page).
  beacon() {
    if (this.state !== 'ok' && this.state !== 'offline') return;
    const send = this.win.navigator.sendBeacon?.bind(this.win.navigator);
    if (!send) return;
    let chunk = [], size = 0;
    const out = () => { if (chunk.length && send(this.url, new Blob([chunk.join('\n')], { type: 'text/plain' }))) this.sent += chunk.length; chunk = []; size = 0; };
    for (let i = this.next; i < this.lines.length; i++) {
      const l = this.lines[i];
      if (!l) continue;
      if (size + l.length > BEACON) out();
      chunk.push(l); size += l.length + 1;
    }
    out();
    this.next = this.lines.length;
  }

  // The whole session as NDJSON text.
  ndjson() { return this.lines.filter(Boolean).join('\n') + '\n'; }
  records() { return this.lines.filter(Boolean).map((l) => JSON.parse(l)); }

  // Hands the session to the person as a file.
  save(name = `paludarium-${this.sid}.ndjson`) {
    const doc = this.win.document, a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.ndjson()], { type: 'application/x-ndjson' }));
    a.download = name; doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
}
