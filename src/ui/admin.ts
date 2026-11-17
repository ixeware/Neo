// «Журнал админа»: the admin panel. Opens on #admin (or on the path /admin of self-hosted and
// Vercel builds) behind a password that only gates this panel in this browser. Every change to
// the world is an admin command (Cmd k: 'adm', src/sim/admin.ts) handed to the AdminChannel that
// main.ts picks for the game being played (src/net/adminChannel.ts): local → the session; the
// artifact's shared war → editors only, over the 'adm' channels; Vercel → the server checks the
// password (login) and each command. So snapshots, rollback and replays stay consistent. Speed,
// toggles, camera and saves are local UI only.
import './admin.css';
import * as THREE from 'three';
import { UNITS, CARDS, EVENTS, HQ, HEROES, BOSS, ECON, WAR_RESET, Fx, cardText, type Side } from '../sim/defs';
import { Sim, hashState, type FxEv, type State } from '../sim/sim';
import { ADM_MAX, cleanSay, type AdmOp } from '../sim/admin';
import { heightY, type Terrain } from '../world/terrain';
import { LocalBackend, type Session } from '../net/session';
import type { Shared } from '../net/shared';
import type { AdminChannel } from '../net/adminChannel';
import type { Stage } from '../render/scene';
import type { Hud } from './hud';
import { DONER, cardLore } from '../data/heroes';

/** PBKDF2-SHA256 of the panel password (salt below, 210 000 rounds, 32 bytes). Only the hash lives here. */
const PASS_HASH = '313e8dce89c55905201163fdcadb5eeebe0e2b27bc5b2a0f8b4ef31a7e1e7355';
const PASS_SALT = 'vysotka-admin-v1';
const PASS_ROUNDS = 210000;
const MAX_TRIES = 5, LOCK_MS = 30000;
const K_UNLOCK = 'vysotka.adm.unlock', K_FAILS = 'vysotka.adm.fails';

export interface AdminHooks {
  sim: Sim; terrain: Terrain; stage: Stage; hud: Hud;
  prefs: { pid: string; spicy: boolean; music: boolean };
  session(): Session | null;
  /** The artifact's shared war, for the debug tools (keeper, checkpoint, resync); null elsewhere. */
  shared(): Shared | null;
  /** Who may run admin commands in the game being played, and how they get there. Asked often: return a kept object. */
  channel(): AdminChannel;
  side(): Side;
  setSpicy(on: boolean): void;
  setMusic(on: boolean): void;
  /** Throw away the local save and start a fresh local war. */
  newLocal(): void;
  /** Load the local save (written by the import) into a new local session. */
  resumeLocal(): void;
}
export interface Admin {
  /** Sim events for the panel: 'adminSay' (banner + feed for everyone) and 'adm' (what an admin did). */
  fx(e: FxEv): void;
  readonly isOpen: boolean;
}

// ---- small helpers -------------------------------------------------------------------------
const ss = {
  get(k: string): string | null { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* blocked: works without it */ } },
  del(k: string) { try { sessionStorage.removeItem(k); } catch { /* blocked */ } },
};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function btn(label: string, cls: string, on: () => void): HTMLButtonElement {
  const b = el('button', 'adm-btn ' + cls, label);
  b.type = 'button';
  b.addEventListener('click', () => { if (!b.disabled) on(); });
  return b;
}
const setText = (e: HTMLElement, t: string) => { if (e.textContent !== t) e.textContent = t; };
const fmt = (n: number) => Math.floor(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
const mmss = (ticks: number) => { const s = Math.max(0, Math.ceil(ticks / 10)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const SIDE_NOM = ['Атаги', 'Курчалой'], SIDE_GEN = ['Атагов', 'Курчалоя'], SIDE_DAT = ['Атагам', 'Курчалою'];
const DIFF = ['Легко', 'Нормально', 'Как Зураб'];
const AI_MODE = ['авто', 'всегда ИИ', 'без ИИ'];

async function checkPassword(pw: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(PASS_SALT), iterations: PASS_ROUNDS }, key, 256);
  const hex = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  let d = hex.length ^ PASS_HASH.length;
  for (let i = 0; i < PASS_HASH.length; i++) d |= hex.charCodeAt(i) ^ PASS_HASH.charCodeAt(i);
  return d === 0;
}

/** A ring draped over the drawn ground (capture zones, the placement ghost). */
function ringGeo(t: Terrain, x: number, z: number, r: number, w: number, segs = 64): THREE.BufferGeometry {
  const pos = new Float32Array((segs + 1) * 6), idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < 2; k++) {
      const rr = Math.max(0.05, r + (k ? w / 2 : -w / 2)), px = x + c * rr, pz = z + s * rr, j = (i * 2 + k) * 3;
      pos[j] = px; pos[j + 1] = heightY(t, px, pz) + 0.3; pos[j + 2] = pz;
    }
    if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
const ringMat = (color: string, opacity = 0.85) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
const OWNER_COLOR = ['#2a52d1', '#d8361f'], NEUTRAL = '#23262b';

type Tab = 'money' | 'units' | 'hq' | 'heroes' | 'pts' | 'vote' | 'events' | 'war' | 'ai' | 'say' | 'debug';
const TABS: [Tab, string][] = [
  ['money', 'Деньги'], ['units', 'Юниты'], ['hq', 'Высотки'], ['heroes', 'Герои'], ['pts', 'Точки'], ['vote', 'Сход'],
  ['events', 'События'], ['war', 'Война'], ['ai', 'ИИ и скорость'], ['say', 'Объявление'], ['debug', 'Отладка'],
];
type Place = { kind: 'spawn'; s: Side; u: number; n: number } | { kind: 'kill'; s: -1 | 0 | 1; r: number; at: { x: number; z: number } | null };

export function initAdmin(h: AdminHooks): Admin {
  const { sim, stage, terrain } = h;
  const host = document.getElementById('app') ?? document.body;
  const root = el('div', 'adm-root');
  root.setAttribute('aria-live', 'off');
  const sheet = el('section', 'adm-sheet paper');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Журнал админа');
  const bar = el('div', 'adm-bar paper'); bar.hidden = true;
  const chip = el('div', 'adm-chip'); chip.hidden = true;
  const sayBox = el('div', 'adm-say paper'); sayBox.hidden = true;
  sheet.hidden = true;
  root.append(sheet, bar, chip); // the root itself never takes pointer events
  host.append(root, sayBox);

  let open = false;
  const ADMIN_PATH = /\/admin(\/[^?#]*)?$/; // /admin, /admin/, /admin/… (vercel.json rewrites them to the game)
  let pathMode = ADMIN_PATH.test(location.pathname);
  let tab: Tab = 'money';
  let selSide: Side = h.side();
  let updaters: (() => void)[] = [];
  let cancelConfirm: (() => void) | null = null;
  let place: Place | null = null;
  let statusEl: HTMLElement | null = null;
  let timer = 0;

  // keys typed into the panel never reach the game's hotkeys (cards on 1–9, WASD camera)
  root.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onEsc(); } });
  root.addEventListener('keyup', e => e.stopPropagation());
  addEventListener('keydown', e => { if (open && e.key === 'Escape') onEsc(); });
  function onEsc() {
    if (place) { stopPlace(); return; }
    if (cancelConfirm) { cancelConfirm(); return; }
    close();
  }

  // ---- open / close ------------------------------------------------------------------------
  const wanted = () => location.hash === '#admin' || pathMode;
  addEventListener('hashchange', () => { if (location.hash === '#admin') show(); else if (open && !pathMode) hide(); });
  addEventListener('popstate', () => { pathMode = ADMIN_PATH.test(location.pathname); if (wanted()) show(); else hide(); });
  function show() {
    if (open) return;
    open = true;
    selSide = h.side();
    sheet.hidden = false;
    render();
    timer = window.setInterval(tick, 300);
    requestAnimationFrame(() => (sheet.querySelector('#adm-pass, .adm-tab.on') as HTMLElement | null)?.focus({ preventScroll: true }));
  }
  function hide() {
    if (!open) return;
    open = false;
    stopPlace();
    clearInterval(timer);
    sheet.hidden = true;
    updaters = []; tabUpd = [];
    setZones(false, true);
    paintChip();
  }
  function close() {
    hide();
    const path = pathMode ? location.pathname.replace(ADMIN_PATH, '/') : location.pathname;
    pathMode = false;
    if (location.hash === '#admin' || path !== location.pathname) {
      try { history.replaceState(null, '', path + location.search); } catch { if (location.hash === '#admin') location.hash = ''; }
    }
  }

  // ---- password gate ---------------------------------------------------------------------------
  const unlocked = () => ss.get(K_UNLOCK) === '1';
  let memUnlocked = false; // when sessionStorage is blocked
  const fails = (): { n: number; until: number } => {
    try { const j = JSON.parse(ss.get(K_FAILS) || '{}'); return { n: Number(j.n) || 0, until: Number(j.until) || 0 }; } catch { return { n: 0, until: 0 }; }
  };
  let memFails = { n: 0, until: 0 };
  const getFails = () => (ss.get(K_FAILS) !== null ? fails() : memFails);
  const setFails = (f: { n: number; until: number }) => { memFails = f; ss.set(K_FAILS, JSON.stringify(f)); };

  function render() {
    updaters = []; tabUpd = [];
    cancelConfirm = null;
    sheet.textContent = '';
    if (unlocked() || memUnlocked) renderMain(); else renderLogin();
  }

  function header(title: string, extra?: HTMLElement): HTMLElement {
    const hd = el('header', 'adm-head');
    const t = el('h2', 'adm-title', title);
    const x = btn('✕', 'adm-x', () => close());
    x.setAttribute('aria-label', 'Закрыть журнал');
    hd.append(t);
    if (extra) hd.append(extra);
    hd.append(x);
    return hd;
  }

  function renderLogin() {
    sheet.classList.add('adm-locked');
    sheet.append(header('Журнал админа'));
    const body = el('div', 'adm-body');
    const note = el('p', 'adm-note', 'Пароль открывает эту панель только в этом браузере. В общей войне артефакта команды админа проходят, только если у тебя роль редактора: это проверяет сама платформа, а не пароль. В онлайн-войне на сайте пароль и каждую команду проверяет сервер.');
    const form = el('form', 'adm-login');
    const lab = el('label', 'adm-lab', 'Пароль');
    const inp = el('input', 'adm-in');
    inp.type = 'password'; inp.name = 'adm-pass'; inp.autocomplete = 'off'; inp.id = 'adm-pass';
    inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('autocorrect', 'off'); inp.spellcheck = false;
    lab.htmlFor = 'adm-pass';
    const go = el('button', 'adm-btn go', 'Открыть журнал');
    go.type = 'submit';
    const err = el('div', 'adm-err'); err.hidden = true;
    const stamp = el('span', 'adm-stamp', 'Н');
    const errT = el('div', 'adm-err-t');
    const errM = el('b', '', 'Неверный пароль');
    const errS = el('span', 'adm-err-s');
    errT.append(errM, errS);
    err.append(stamp, errT);
    form.append(lab, inp, go, err);
    body.append(note, form);
    // the server can check the password too (Vercel): then a page without crypto.subtle still works
    const canCheck = () => !!(globalThis.crypto && crypto.subtle) || !!h.channel().login;
    if (!canCheck()) {
      body.append(el('p', 'adm-note err', 'Браузер не даёт проверить пароль: нужна страница по https.'));
      inp.disabled = true; go.disabled = true;
    }
    sheet.append(body);
    let busy = false;
    const paint = () => {
      const f = getFails(), now = Date.now();
      const locked = f.until > now;
      inp.disabled = locked || busy || !canCheck();
      go.disabled = inp.disabled;
      if (locked) {
        err.hidden = false;
        setText(errM, 'Неверный пароль');
        setText(errS, `Пять ошибок. Журнал закрыт на ${Math.ceil((f.until - now) / 1000)} с`);
      } else if (f.n > 0) {
        err.hidden = false;
        setText(errS, `Осталось попыток: ${MAX_TRIES - f.n}`);
      } else if (!busy) err.hidden = true;
      go.textContent = busy ? 'Проверяю…' : 'Открыть журнал';
    };
    updaters.push(paint);
    paint();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = getFails();
      if (busy || f.until > Date.now()) return;
      const pw = inp.value.trim();
      if (!pw) { inp.focus(); return; }
      busy = true; paint();
      // local hash and, where the channel has one, the server login at once: either opens the panel
      // (the server is the authority there); the server's verdict decides whether commands go through
      const ch = h.channel();
      Promise.all([
        checkPassword(pw).catch(() => false),
        ch.login ? ch.login(pw).catch(() => 'Сервер не ответил') : Promise.resolve(undefined),
      ]).then(([okLocal, srv]) => {
        busy = false;
        inp.value = '';
        if (okLocal || srv === null) {
          setFails({ n: 0, until: 0 });
          ss.set(K_UNLOCK, '1'); memUnlocked = true;
          sheet.classList.remove('adm-locked');
          render();
          if (srv === null) status('Сервер принял вход', 'ok');
          else if (typeof srv === 'string') status(`Сервер: ${srv}`, 'err');
          recheck();
          return;
        }
        const n = getFails().n + 1;
        setFails(n >= MAX_TRIES ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 });
        err.classList.remove('hit'); void err.offsetWidth; err.classList.add('hit');
        paint();
        if (!inp.disabled) inp.focus();
      });
    });
  }

  function lock() {
    ss.del(K_UNLOCK); memUnlocked = false;
    try { h.channel().logout?.(); } catch { /* nothing to forget */ }
    verdictAt = 0;
    stopPlace();
    setZones(false, true);
    render();
  }

  // ---- main sheet ------------------------------------------------------------------------------
  function mode(): 'none' | 'local' | 'shared' {
    const s = h.session();
    return !s ? 'none' : s.backend.kind === 'shared' ? 'shared' : 'local';
  }
  // ---- authority: the AdminChannel main.ts picks for the game being played --------------------
  let chan: AdminChannel | null = null;
  let verdict: string | null | undefined; // null: allowed; a reason; undefined: still asking
  let verdictAt = 0, asking = false;
  /** The current channel; re-asks check() every few seconds (and right away when it changes). */
  function authority(): AdminChannel {
    const ch = h.channel();
    if (ch !== chan) {
      chan = ch; verdict = undefined; verdictAt = 0;
      ch.onRefused = why => { if (chan === ch) { verdict = why; verdictAt = performance.now(); } status(why, 'err'); };
    }
    if (!asking && performance.now() - verdictAt > 2500) recheck();
    return ch;
  }
  function recheck() {
    const ch = chan ?? h.channel();
    asking = true;
    ch.check().catch(() => 'Не удалось проверить права').then(v => {
      asking = false;
      if (chan === ch) { verdict = v; verdictAt = performance.now(); }
    });
  }
  const WHERE = { local: 'Одиночная игра', artifact: 'Общая война', vercel: 'Онлайн-война' } as const;
  const ALLOWED = {
    local: 'Одиночная игра · команды идут в симуляцию',
    artifact: 'Общая война · ты редактор: команды увидят все',
    vercel: 'Онлайн-война · сервер принял вход: команды увидят все',
  } as const;

  function renderMain() {
    const out = btn('Выйти', 'adm-out', () => lock());
    out.setAttribute('aria-label', 'Выйти из журнала');
    sheet.append(header('Журнал админа', out));
    const sub = el('div', 'adm-sub');
    const modeEl = el('span', 'adm-mode');
    statusEl = el('span', 'adm-status');
    sub.append(modeEl, statusEl);
    // server login (a channel with login(), e.g. Vercel): shown while the server has not let us in
    const srv = el('form', 'adm-srv');
    const srvIn = el('input', 'adm-in');
    srvIn.type = 'password'; srvIn.autocomplete = 'off'; srvIn.placeholder = 'Пароль для сервера';
    srvIn.setAttribute('aria-label', 'Пароль для сервера');
    const srvGo = el('button', 'adm-btn go', 'Войти на сервер');
    srvGo.type = 'submit';
    srv.append(srvIn, srvGo);
    srv.hidden = true;
    let srvBusy = false;
    srv.addEventListener('submit', e => {
      e.preventDefault();
      const ch = authority(), pw = srvIn.value.trim();
      if (srvBusy || !ch.login || !pw) return;
      srvBusy = true; srvGo.disabled = true; setText(srvGo, 'Проверяю…');
      ch.login(pw).catch(() => 'Сервер не ответил').then(why => {
        srvBusy = false; srvGo.disabled = false; setText(srvGo, 'Войти на сервер');
        srvIn.value = '';
        if (why === null) { status('Сервер принял вход', 'ok'); recheck(); } else status(`Сервер: ${why}`, 'err');
      });
    });
    updaters.push(() => {
      const ch = authority(), idle = mode() === 'none' && ch.kind === 'local';
      const t = idle ? 'Игра не начата — команды ждут войны'
        : verdict === undefined ? `${WHERE[ch.kind]} · проверяю права…`
        : verdict === null ? ALLOWED[ch.kind]
        : `${WHERE[ch.kind]} · ${verdict}`;
      setText(modeEl, t);
      modeEl.className = 'adm-mode' + (!idle && typeof verdict === 'string' ? ' err' : '');
      srv.hidden = !(ch.login && typeof verdict === 'string');
    });
    sub.append(srv);
    // whose side the per-side tools act on
    const sides = el('div', 'adm-seg adm-sides');
    sides.setAttribute('role', 'group'); sides.setAttribute('aria-label', 'Сторона');
    for (const s of [0, 1] as Side[]) {
      const b = el('button', `s${s}`, SIDE_NOM[s]);
      b.type = 'button'; b.dataset.v = String(s);
      b.setAttribute('aria-pressed', String(selSide === s));
      b.addEventListener('click', () => { selSide = s; sides.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderTab(); });
      sides.append(b);
    }
    const sideRow = el('div', 'adm-siderow');
    sideRow.append(el('span', 'adm-lab', 'Для кого'), sides);
    const tabs = el('nav', 'adm-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [k, label] of TABS) {
      const b = el('button', 'adm-tab' + (k === tab ? ' on' : ''), label);
      b.type = 'button'; b.dataset.tab = k;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(k === tab));
      b.addEventListener('click', () => {
        tab = k;
        tabs.querySelectorAll('.adm-tab').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
        b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        renderTab();
      });
      tabs.append(b);
    }
    const body = el('div', 'adm-body');
    body.id = 'adm-body';
    sheet.append(sub, sideRow, tabs, body);
    renderTab();
    requestAnimationFrame(() => tabs.querySelector('.adm-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  /** Header-level updaters stay; tab ones are rebuilt. */
  let tabUpd: (() => void)[] = [];
  function renderTab() {
    const body = sheet.querySelector('#adm-body') as HTMLElement | null;
    if (!body) return;
    cancelConfirm?.();
    body.textContent = '';
    tabUpd = [];
    const fill = PAGES[tab];
    fill(body);
    body.scrollTop = 0;
    tick();
  }
  function tick() {
    if (!open) return;
    for (const f of updaters) f();
    for (const f of tabUpd) f();
    paintChip();
  }

  let statusT = 0;
  function status(text: string, kind: 'ok' | 'err' | '' = '') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'adm-status ' + kind;
    clearTimeout(statusT);
    statusT = window.setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 6000);
  }

  /** Hand an admin command to the channel. Resolves false (and says why) when it may not go out. */
  async function send(b: { op: AdmOp } & Record<string, unknown>, done: string): Promise<boolean> {
    if (!h.session()) { status('Сначала начни игру: меню → сторона', 'err'); return false; }
    const ch = authority();
    const v = await ch.check().catch(() => 'Не удалось проверить права');
    if (chan === ch) { verdict = v; verdictAt = performance.now(); }
    if (v !== null) { status(v, 'err'); return false; }
    ch.send({ k: 'adm', ...b });
    status(done, 'ok');
    return true;
  }

  // ---- building blocks --------------------------------------------------------------------------
  function sec(body: HTMLElement, title: string, note = ''): HTMLElement {
    const s = el('section', 'adm-sec');
    s.append(el('h3', 'adm-h', title));
    if (note) s.append(el('p', 'adm-note', note));
    body.append(s);
    return s;
  }
  const upd = (f: () => void) => tabUpd.push(f);
  const grid = (n: number, ...kids: HTMLElement[]) => { const g = el('div', `adm-g${n}`); g.append(...kids); return g; };

  /**
   * The confirm step of a destructive action: a red «Н» stamp, the question, «Да» and «Отмена».
   * `trigger` hides while it is open. Closes itself after 9 s, on Esc and when another one opens.
   */
  function confirmBox(trigger: HTMLElement, ask: () => string, yes: string, run: () => void): { el: HTMLElement; open(): void } {
    const box = el('div', 'adm-confirm'); box.hidden = true;
    box.setAttribute('role', 'alertdialog');
    const q = el('div', 'adm-ask'), qt = el('span');
    q.append(el('span', 'adm-stamp', 'Н'), qt);
    const ok = btn(yes, 'redfill', () => { closeC(); run(); });
    const no = btn('Отмена', '', () => closeC());
    box.append(q, grid(2, ok, no));
    let t = 0;
    function openC() {
      cancelConfirm?.();
      qt.textContent = ask();
      trigger.hidden = true; box.hidden = false;
      cancelConfirm = closeC;
      t = window.setTimeout(closeC, 9000);
      ok.focus({ preventScroll: true });
    }
    function closeC() {
      clearTimeout(t);
      trigger.hidden = false; box.hidden = true;
      if (cancelConfirm === closeC) cancelConfirm = null;
    }
    return { el: box, open: openC };
  }
  /** A destructive button: the first tap turns it into the red «Н» confirm step. */
  function danger(label: string, ask: string, yes: string, run: () => void, cls = ''): HTMLElement {
    const w = el('div', 'adm-danger ' + cls);
    const b = btn(label, 'red', () => c.open());
    const c = confirmBox(b, () => ask, yes, run);
    w.append(b, c.el);
    return w;
  }

  function seg<T extends string | number>(opts: [string, T][], get: () => T, set: (v: T) => void, label: string, cls = ''): HTMLElement {
    const g = el('div', 'adm-seg ' + cls);
    g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    const bs = opts.map(([t, v]) => {
      const b = el('button', '', t);
      b.type = 'button'; b.dataset.v = String(v);
      b.addEventListener('click', () => { if (!b.disabled) set(v); });
      g.append(b);
      return [b, v] as const;
    });
    upd(() => { const cur = get(); for (const [b, v] of bs) { const on = String(v === cur); if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on); } });
    return g;
  }

  function toggle(label: string, get: () => boolean, set: (v: boolean) => void, note = ''): HTMLElement {
    const b = el('button', 'adm-sw');
    b.type = 'button'; b.setAttribute('role', 'switch');
    const t = el('span', 'adm-sw-t', label);
    const n = note ? el('small', '', note) : null;
    const lab = el('span', 'adm-sw-l'); lab.append(t); if (n) lab.append(n);
    const pill = el('span', 'adm-pill');
    b.append(lab, pill);
    b.addEventListener('click', () => set(!get()));
    upd(() => { const on = get(); b.setAttribute('aria-checked', String(on)); setText(pill, on ? 'вкл' : 'выкл'); });
    return b;
  }

  function stepper(min: number, max: number, init: number, label: string): { el: HTMLElement; get(): number; set(v: number): void } {
    const w = el('div', 'adm-step');
    const inp = el('input', 'adm-in num');
    inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.step = '1'; inp.inputMode = 'numeric';
    inp.value = String(init); inp.setAttribute('aria-label', label);
    const val = () => { const v = Math.round(Number(inp.value)); return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min; };
    const set = (v: number) => { inp.value = String(Math.max(min, Math.min(max, v))); };
    const minus = btn('−', 'sq', () => set(val() - 1)); minus.setAttribute('aria-label', 'Меньше');
    const plus = btn('+', 'sq', () => set(val() + 1)); plus.setAttribute('aria-label', 'Больше');
    inp.addEventListener('change', () => set(val()));
    w.append(minus, inp, plus);
    return { el: w, get: val, set };
  }

  const st = () => sim.st;
  const ptName = (i: number) => { const p = st().pts[i]; return p.kind === 2 ? (h.prefs.spicy ? DONER.spicy : DONER.clean) : p.name; };
  const ptKind = (i: number) => {
    const p = st().pts[i];
    return p.kind === 0 ? 'высотка' : p.kind === 1 ? 'село' : p.kind === 2 ? 'шаурмичная' : `место · ${({ sportiki: 'стадион', gelik: 'мойка', gym: 'качалка', market: 'рынок' } as Record<string, string>)[p.perk ?? ''] ?? 'перк'}`;
  };
  /** Card title for the 18+ setting; «Все на {V}!» names the village the card picked (any, in the list). */
  const cardTitle = (id: number, village = 'любое село') => cardLore(id, h.prefs.spicy)?.title ?? cardText(CARDS[id], h.prefs.spicy, village).title;
  const ownerName = (o: number) => (o === 0 ? 'Атаги' : o === 1 ? 'Курчалой' : 'ничьё');

  // ---- pages -----------------------------------------------------------------------------------------
  const PAGES: Record<Tab, (b: HTMLElement) => void> = {
    money(body) {
      const s = selSide;
      const box = sec(body, `Касса: ${SIDE_NOM[s]}`);
      const big = el('div', `adm-big num s${s}`);
      const inc = el('div', 'adm-hand');
      box.append(big, inc);
      upd(() => { const sd = st().sides[s]; setText(big, `${fmt(sd.money)} ₽`); setText(inc, `доход ${fmt(sd.income)} ₽/с · у ${SIDE_GEN[1 - s]} ${fmt(st().sides[1 - s].money)} ₽`); });
      box.append(grid(3,
        btn('+100', `s${s}`, () => send({ op: 'money', s, v: 100 }, `${SIDE_DAT[s]} +100 ₽`)),
        btn('+1 000', `s${s}`, () => send({ op: 'money', s, v: 1000 }, `${SIDE_DAT[s]} +1 000 ₽`)),
        btn('+10 000', `s${s}`, () => send({ op: 'money', s, v: 10000 }, `${SIDE_DAT[s]} +10 000 ₽`)),
      ));
      box.append(danger('Обнулить кассу', `Обнулить кассу ${SIDE_GEN[s]}?`, 'Да, в ноль', () => send({ op: 'moneySet', s, v: 0 }, `Касса ${SIDE_GEN[s]}: 0 ₽`)));
      const set = sec(body, 'Поставить ровно', `От 0 до ${fmt(ADM_MAX.bank)} ₽`);
      const inp = el('input', 'adm-in num');
      inp.type = 'number'; inp.min = '0'; inp.max = String(ADM_MAX.bank); inp.inputMode = 'numeric'; inp.placeholder = '5000';
      inp.setAttribute('aria-label', 'Сумма в кассе');
      set.append(grid(2, inp, btn('Поставить', 'go', () => {
        const v = Math.round(Number(inp.value));
        if (!inp.value || !Number.isFinite(v) || v < 0) { status('Нужна сумма от 0', 'err'); return; }
        const c = Math.min(ADM_MAX.bank, v);
        send({ op: 'moneySet', s, v: c }, `Касса ${SIDE_GEN[s]}: ${fmt(c)} ₽`);
      })));
    },

    units(body) {
      const s = selSide;
      let u = 1;
      const spawn = sec(body, `Поставить юнитов: ${SIDE_NOM[s]}`, 'Герой — один на сторону: если он уже на поле или на парах, его не будет. Предел — 150 юнитов на сторону.');
      const types = el('div', 'adm-types');
      types.setAttribute('role', 'group'); types.setAttribute('aria-label', 'Тип юнита');
      const typeBtns: HTMLButtonElement[] = [];
      for (let t = 0; t < UNITS.length; t++) {
        if (t === BOSS) continue;
        const d = UNITS[t];
        const b = el('button', 'adm-type');
        b.type = 'button'; b.dataset.u = String(t);
        b.append(el('b', '', d.name[s]));
        const tag = d.hero ? (d.avail[s] ? 'герой' : 'герой · не их') : d.summon ? 'призыв' : d.carry ? 'транспорт' : d.max ? `не больше ${d.max} в игре` : '';
        if (tag) b.append(el('small', '', tag));
        b.addEventListener('click', () => { u = t; paintTypes(); });
        types.append(b); typeBtns.push(b);
      }
      const paintTypes = () => typeBtns.forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.u) === u)));
      paintTypes();
      spawn.append(types);
      const cnt = stepper(1, ADM_MAX.spawn, 5, 'Сколько');
      const quick = el('div', 'adm-quick');
      for (const n of [1, 5, 10, 25, 50]) quick.append(btn(String(n), 'sm', () => cnt.set(n)));
      const cntRow = el('div', 'adm-line');
      cntRow.append(el('span', 'adm-lab', 'Сколько'), cnt.el);
      spawn.append(cntRow, quick);
      let where: 'hq' | 'pt' | 'map' = 'hq';
      const ptSel = el('select', 'adm-in');
      ptSel.setAttribute('aria-label', 'Точка');
      st().pts.forEach((p, i) => { const o = el('option', '', `${ptName(i)} · ${ptKind(i)}`); o.value = String(i); ptSel.append(o); });
      ptSel.hidden = true;
      spawn.append(el('span', 'adm-lab', 'Где'), seg<'hq' | 'pt' | 'map'>([['У высотки', 'hq'], ['В точке', 'pt'], ['Тапнуть по карте', 'map']], () => where, v => { where = v; ptSel.hidden = v !== 'pt'; tick(); }, 'Где поставить'), ptSel);
      const go = btn('Поставить', `go s${s}`, () => {
        const n = UNITS[u].hero ? 1 : cnt.get();
        if (where === 'map') { startPlace({ kind: 'spawn', s, u, n }); return; }
        const b: Record<string, unknown> = { op: 'spawn', s, u, n };
        if (where === 'pt') { const p = st().pts[Number(ptSel.value)]; if (p) { b.x = p.x; b.z = p.z; } }
        send(b as { op: AdmOp }, `${SIDE_DAT[s]}: ${UNITS[u].name[s]} ×${n}`);
      });
      const live = el('div', 'adm-hand');
      spawn.append(go, live);
      upd(() => {
        const n = UNITS[u].hero ? 1 : cnt.get();
        setText(go, where === 'map' ? `Выбрать место на карте: ${UNITS[u].name[s]} ×${n}` : `Поставить: ${UNITS[u].name[s]} ×${n}`);
        setText(live, `сейчас у ${SIDE_GEN[s]} ${sim.count(s)} из ${ECON.unitCap} юнитов`);
      });

      const boss = sec(body, 'Босс', s === 0 ? 'Ислам #1 ranked chad выходит у высотки Атагов.' : 'Качок Зураб выходит у высотки Курчалоя.');
      const bb = btn('Вызвать босса', `go s${s}`, () => send({ op: 'boss', s }, `Вызван босс ${SIDE_GEN[s]}`));
      const bossSt = el('div', 'adm-hand');
      boss.append(bb, bossSt);
      upd(() => { const on = st().sides[s].boss !== -1; bb.disabled = on; setText(bossSt, on ? 'босс уже на поле' : ''); });

      const kill = sec(body, 'Убрать', 'Без награды за убийство и без взрывов. Герои уходят на обычный откат.');
      kill.append(danger(`Убрать всех: ${SIDE_NOM[s]}`, `Убрать всех юнитов ${SIDE_GEN[s]}?`, 'Да, убрать', () => send({ op: 'kill', s }, `Убраны все юниты ${SIDE_GEN[s]}`)));
      kill.append(btn('Убрать в круге на карте…', 'red', () => startPlace({ kind: 'kill', s, r: 8, at: null })));

      const heal = sec(body, 'Лечение');
      heal.append(btn(`Вылечить всех: ${SIDE_NOM[s]}`, `s${s}`, () => send({ op: 'heal', s }, `${SIDE_NOM[s]} вылечены`)));

      const modes = sec(body, 'Режимы', 'Хранятся в мире и переживают перезагрузку. Сброс мира их снимает.');
      const adm = () => st().adm;
      modes.append(
        toggle(`Заморозить: ${SIDE_NOM[s]}`, () => !!adm()?.frz[s], v => send({ op: 'freeze', s, v: v ? 1 : 0 }, v ? `${SIDE_NOM[s]} заморожены` : `${SIDE_NOM[s]} разморожены`), 'стоят и не бьют'),
        toggle(`Бессмертие: ${SIDE_NOM[s]}`, () => !!adm()?.god[s], v => send({ op: 'god', s, v: v ? 1 : 0 }, v ? `${SIDE_NOM[s]} бессмертны` : `Бессмертие ${SIDE_GEN[s]} снято`), 'юниты и высотка без урона'),
      );
      const both = el('div', 'adm-hand');
      modes.append(both);
      upd(() => {
        const a = adm(), f = (k: 'frz' | 'god', i: number) => (a?.[k][i] ? (k === 'frz' ? 'заморожены' : 'бессмертны') : '');
        const parts = [0, 1].map(i => [f('frz', i), f('god', i)].filter(Boolean).join(', ')).map((t, i) => (t ? `${SIDE_NOM[i]}: ${t}` : ''));
        setText(both, parts.filter(Boolean).join(' · ') || 'обе стороны как обычно');
      });
    },

    hq(body) {
      const s = selSide, max = HQ.maxFloors[s];
      const box = sec(body, `Высотка: ${SIDE_NOM[s]}`);
      const big = el('div', `adm-big num s${s}`);
      const tower = el('div', `adm-tower s${s}`);
      const hp = el('div', 'adm-hand');
      box.append(grid(2, big, tower), hp);
      const floorsEls: HTMLElement[] = [];
      for (let i = 0; i < max; i++) { const f = el('i'); tower.prepend(f); floorsEls.push(f); }
      upd(() => {
        const sd = st().sides[s];
        setText(big, `${sd.floors} из ${max}`);
        floorsEls.forEach((f, i) => f.classList.toggle('on', i < sd.floors));
        setText(hp, `прочность ${fmt(Math.max(0, sd.hq))} из ${fmt(sd.floors * HQ.floorHp[s])}`);
      });
      const step = stepper(0, max, st().sides[s].floors, 'Этажей');
      const row = el('div', 'adm-line'); row.append(el('span', 'adm-lab', 'Этажей'), step.el);
      box.append(row);
      const plain = btn('Поставить этажи', `go s${s}`, () => {
        const v = step.get(), cur = st().sides[s].floors;
        if (v < cur) { warn.open(); return; }
        send({ op: 'floors', s, v }, `Высотка ${SIDE_GEN[s]}: ${v} эт.`);
      });
      const warn = confirmBox(plain, () => (step.get() === 0 ? `Снести высотку ${SIDE_GEN[s]} целиком? Это конец войны.` : `Снести высотку ${SIDE_GEN[s]} до ${step.get()} эт.?`), 'Да, снести', () => {
        const v = step.get();
        send({ op: 'floors', s, v }, v === 0 ? `Высотка ${SIDE_GEN[s]} снесена` : `Высотка ${SIDE_GEN[s]}: ${v} эт.`);
      });
      box.append(plain, warn.el);
      upd(() => { const v = step.get(), cur = st().sides[s].floors; setText(plain, v < cur ? `Снести до ${v} эт.` : v > cur ? `Надстроить до ${v} эт.` : 'Восстановить этажи'); plain.classList.toggle('red', v < cur); });
      box.append(btn('Починить полностью', `s${s}`, () => send({ op: 'repair', s }, `Высотка ${SIDE_GEN[s]} как новая`)));
      const f4 = sec(body, '4-й этаж', 'Ислам находит четвёртый этаж трёхэтажки Атагов прямо сейчас.');
      const f4b = btn('Найти 4-й этаж сейчас', 'go s0', () => send({ op: 'found4' }, 'Ислам нашёл 4-й этаж'));
      const f4s = el('div', 'adm-hand');
      f4.append(f4b, f4s);
      upd(() => { const a = st().sides[0]; setText(f4s, a.found4 ? `уже нашёл · этажей у Атагов ${a.floors}` : `ещё ищет · этажей у Атагов ${a.floors}`); });
    },

    heroes(body) {
      const s = selSide;
      const list = sec(body, `Герои: ${SIDE_NOM[s]}`);
      const rows: [number, HTMLElement][] = [];
      for (const t of HEROES) {
        const r = el('div', 'adm-row');
        const n = el('span', 'adm-row-n'); n.append(el('b', '', UNITS[t].name[s]));
        const v = el('span', 'adm-row-v');
        r.append(n, v);
        list.append(r); rows.push([t, v]);
      }
      upd(() => {
        for (const [t, v] of rows) {
          const w = sim.heroWait(s, t);
          setText(v, !UNITS[t].avail[s] && st().sides[s].hero[t] === -1 ? 'не за эту сторону' : w === -1 ? 'на поле' : w === -2 ? 'на парах' : w > 0 ? `откат ${mmss(w * 10)}` : 'готов');
        }
      });
      const act = sec(body, 'Откаты и пары');
      act.append(
        btn('Сбросить все откаты: обе стороны', 'go', () => send({ op: 'heroCd', s: -1 }, 'Откаты героев сброшены')),
        btn(`Сбросить откаты: ${SIDE_NOM[s]}`, `s${s}`, () => send({ op: 'heroCd', s }, `Откаты ${SIDE_GEN[s]} сброшены`)),
      );
      const back = btn('Вернуть всех с пар', '', () => send({ op: 'heroBack' }, 'Герои вернулись с пар'));
      act.append(back);
      upd(() => { const n = st().away.length; back.disabled = n === 0; setText(back, n ? `Вернуть всех с пар (${n})` : 'С пар возвращать некого'); });
    },

    pts(body) {
      const list = sec(body, 'Точки', 'Кто держит село, место или Донер Бей. Высотки не меняют хозяина.');
      st().pts.forEach((p, i) => {
        const r = el('div', 'adm-pt');
        const n = el('div', 'adm-row-n');
        n.append(el('b', '', ptName(i)), el('small', '', ptKind(i)));
        const fly = btn('Показать', 'sm', () => stage.flyTo(p.x, p.z, 45));
        const top = el('div', 'adm-pt-top'); top.append(n, fly);
        r.append(top);
        if (p.kind !== 0) {
          r.append(seg<number>([['Атаги', 0], ['Курчалой', 1], ['Ничьё', -1]], () => st().pts[i]?.owner ?? -1,
            v => send({ op: 'owner', n: i, s: v }, `${ptName(i)}: ${ownerName(v)}`), `Хозяин: ${ptName(i)}`, 'adm-own'));
        }
        list.append(r);
      });
    },

    vote(body) {
      const s = selSide;
      const now = sec(body, `Сход: ${SIDE_NOM[s]}`);
      const ob = btn('Открыть сход сейчас', `go s${s}`, () => send({ op: 'vote', s }, `Сход у ${SIDE_GEN[s]} открыт`));
      const vs = el('div', 'adm-hand');
      now.append(ob, vs);
      upd(() => { const v = st().votes[s]; ob.disabled = !!v.open || st().winner !== -1; setText(vs, v.open ? `идёт сход, ещё ${mmss(v.end - st().tick)}` : `следующий по расписанию через ${mmss(st().nextVote - st().tick)}`); });
      const cards = sec(body, 'Карточки', `Сразу применить за ${SIDE_NOM[s]}, без голосования.`);
      for (const c of CARDS) {
        const r = el('div', 'adm-row');
        const n = el('span', 'adm-row-n');
        n.append(el('b', '', `${c.id}. ${cardTitle(c.id)}`), el('small', '', c.side === -1 ? 'обеим сторонам' : `карточка ${SIDE_GEN[c.side]}`));
        r.append(n, btn('Применить', `sm s${s}`, () => send({ op: 'card', s, n: c.id }, `${SIDE_DAT[s]}: «${cardTitle(c.id)}»`)));
        cards.append(r);
      }
    },

    events(body) {
      const act = sec(body, 'Сейчас идёт');
      const now = el('div', 'adm-hand');
      act.append(now, btn('Закончить все события', 'red', () => send({ op: 'endEvents' }, 'Все события закончены')));
      upd(() => {
        const S = st(), ev = S.ev, t = S.tick, on: string[] = [];
        const add = (k: string, until: number) => { if (until > t) on.push(`${EVENTS.find(e => e.key === k)?.title ?? k} · ${mmss(until - t)}`); };
        add('jam', ev.jam); add('blackout', ev.black); add('sale', ev.sale); add('friday', ev.friday); add('flood', ev.flood);
        if (S.away.length) on.push(`Герои на парах: ${S.away.length}`);
        setText(now, on.length ? on.join(' · ') : `ничего · следующее само через ${mmss(ev.next - t)}`);
      });
      const list = sec(body, 'Начать событие');
      for (const E of EVENTS) {
        const r = el('div', 'adm-row');
        const n = el('span', 'adm-row-n');
        n.append(el('b', '', E.title), el('small', '', E.quote));
        r.append(n, btn('Начать', 'sm go', () => send({ op: 'event', key: E.key }, `Событие: ${E.title}`)));
        list.append(r);
      }
    },

    war(body) {
      const info = sec(body, 'Война');
      const big = el('div', 'adm-big num');
      const line = el('div', 'adm-hand');
      info.append(big, line);
      upd(() => {
        const S = st();
        setText(big, `№${S.era} · ${S.sides[0].wins}:${S.sides[1].wins}`);
        setText(line, S.winner === -1 ? `идёт, тик ${S.tick}` : `победили ${SIDE_NOM[S.winner]}, новая война через ${mmss(S.overAt + WAR_RESET - S.tick)}`);
      });
      const win = sec(body, 'Объявить победителя', 'Высотка проигравших падает: обычная победа, через 40 секунд — новая война.');
      win.append(grid(2,
        danger('Победа Атагов', 'Атаги победили?', 'Да', () => send({ op: 'win', s: 0 }, 'Победа Атагов'), 's0'),
        danger('Победа Курчалоя', 'Курчалой победил?', 'Да', () => send({ op: 'win', s: 1 }, 'Победа Курчалоя'), 's1'),
      ));
      const rst = sec(body, 'Сбросы');
      rst.append(
        danger('Новая война сейчас', 'Начать новую войну? Счёт сохранится.', 'Да, новая', () => send({ op: 'newWar' }, 'Новая война')),
        danger('Обнулить счёт', 'Обнулить счёт войн до 0:0?', 'Да, 0:0', () => send({ op: 'score' }, 'Счёт 0:0')),
        danger('Полный сброс мира', 'Новый мир с новым сидом: счёт 0:0, война №1, режимы админа сняты.', 'Да, сбросить', () => send({ op: 'reset', v: (Math.random() * 2 ** 31) | 0 }, 'Мир сброшен')),
      );
      if (mode() !== 'shared') {
        const loc = sec(body, 'Это устройство', 'Удаляет сохранение в этом браузере и начинает новую одиночную войну.');
        loc.append(danger('Сбросить локальное сохранение', 'Стереть сохранение одиночной войны?', 'Да, стереть', () => { h.newLocal(); status('Сохранение стёрто, новая война', 'ok'); }));
      }
    },

    ai(body) {
      const d = sec(body, 'Сложность ИИ');
      d.append(seg<number>(DIFF.map((t, i) => [t, i] as [string, number]), () => st().diff, v => send({ op: 'diff', v }, `Сложность: ${DIFF[v]}`), 'Сложность'));
      const ai = sec(body, 'Кто ведёт стороны', 'Авто — ИИ ведёт сторону, за которую никто не играет. «Всегда ИИ» — даже если игрок есть.');
      for (const s of [0, 1] as Side[]) {
        const r = el('div', 'adm-airow');
        const n = el('div', 'adm-line');
        const live = el('span', 'adm-hand');
        n.append(el('b', `adm-side s${s}`, SIDE_NOM[s]), live);
        r.append(n, seg<number>(AI_MODE.map((t, i) => [t, i] as [string, number]), () => st().adm?.ai[s] ?? 0, v => send({ op: 'ai', s, v }, `ИИ за ${SIDE_GEN[s]}: ${AI_MODE[v]}`), `ИИ: ${SIDE_NOM[s]}`));
        upd(() => setText(live, sim.aiActive(s) ? 'сейчас ведёт ИИ' : 'сейчас ведут люди'));
        ai.append(r);
      }
      const sp = sec(body, 'Скорость', 'Только в одиночной игре: в общей войне время у всех одно.');
      const rate = () => { const s = h.session(); return !s ? 1 : s.paused ? 0 : s.rate; };
      const sg = seg<number>([['Пауза', 0], ['×0.5', 0.5], ['×1', 1], ['×2', 2], ['×4', 4]], rate, v => {
        const s = h.session();
        if (!s || s.backend.kind !== 'local') { status('Скорость — только в одиночной игре', 'err'); return; }
        speedBy = s; // the chip below speaks for this change only (a menu pause is not the admin's)
        if (v === 0) { s.pause(true); status('Пауза', 'ok'); paintChip(); return; }
        s.pause(false); s.setRate(v); status(`Скорость ×${v}`, 'ok'); paintChip();
      }, 'Скорость');
      sp.append(sg);
      upd(() => { const local = mode() === 'local'; sg.querySelectorAll('button').forEach(b => { b.disabled = !local; }); });
    },

    say(body) {
      const box = sec(body, 'Объявление', 'Видно всем, кто сейчас в войне: в беседе от «админ» и большим листком по центру. Только текст.');
      const ta = el('textarea', 'adm-in adm-ta');
      ta.maxLength = ADM_MAX.say; ta.rows = 3; ta.placeholder = 'Сход в 10:20 у молла. Опоздавшим Н';
      ta.setAttribute('aria-label', 'Текст объявления');
      const cnt = el('div', 'adm-count');
      const go = btn('Объявить всем', 'go', () => {
        const t = cleanSay(ta.value);
        if (!t) { status('Пустое объявление', 'err'); return; }
        void send({ op: 'say', txt: t }, 'Объявлено').then(ok => { if (ok) ta.value = ''; });
      });
      box.append(ta, cnt, go);
      upd(() => setText(cnt, `${Array.from(ta.value).length} / ${ADM_MAX.say}`));
      ta.addEventListener('input', () => setText(cnt, `${Array.from(ta.value).length} / ${ADM_MAX.say}`));
    },

    debug(body) {
      const stats = sec(body, 'Состояние');
      const dl = el('dl', 'adm-dl');
      const rowsD: Record<string, HTMLElement> = {};
      const add = (k: string, label: string) => { const dt = el('dt', '', label), dd = el('dd', 'num'); dl.append(dt, dd); rowsD[k] = dd; };
      add('tick', 'Тик'); add('hash', 'Хеш состояния'); add('units', 'Юниты А / К'); add('fps', 'Кадров в секунду'); add('tri', 'Треугольники / вызовы');
      add('online', 'Игроки'); add('speed', 'Скорость');
      if (mode() === 'shared') { add('keeper', 'Хранитель'); add('lease', 'Аренда'); add('cp', 'Чекпоинт'); add('adm', 'Команд админа'); }
      stats.append(dl);
      let lastHash = 0, hashTxt = '';
      upd(() => {
        const S = st(), now = performance.now();
        setText(rowsD.tick, String(S.tick));
        if (now - lastHash > 1000) { lastHash = now; hashTxt = hashState(S).toString(16).padStart(8, '0'); }
        setText(rowsD.hash, hashTxt);
        setText(rowsD.units, `${sim.count(0)} / ${sim.count(1)}`);
        setText(rowsD.fps, fps ? String(fps) : '…');
        const r = stage.renderer.info.render;
        setText(rowsD.tri, `${fmt(r.triangles)} / ${r.calls}`);
        const sh = h.shared(), m = mode();
        if (m === 'shared' && sh) {
          const d = sh.admin.debug();
          setText(rowsD.online, `онлайн ${d.online[0]} + ${d.online[1]} · в мире ${Object.keys(S.players).length}`);
          if (rowsD.keeper) {
            setText(rowsD.keeper, d.keeper ? 'это ты' : 'кто-то другой');
            setText(rowsD.lease, d.leaseAgeMs >= 0 ? `${(d.leaseAgeMs / 1000).toFixed(0)} с назад` : '—');
            setText(rowsD.cp, d.cpTick >= 0 ? `тик ${d.cpTick} · ${(d.cpAgeMs / 1000).toFixed(0)} с` : 'нет');
            setText(rowsD.adm, String(d.admCmds));
          }
        } else setText(rowsD.online, m === 'local' ? `одиночная · в мире ${Object.keys(S.players).length}` : '—');
        const s = h.session();
        setText(rowsD.speed, !s ? '—' : s.paused ? 'пауза' : `×${s.rate}`);
      });
      startFps();
      const vis = sec(body, 'Вид');
      const labelsEl = document.getElementById('labels');
      const miniEl = h.hud.miniCanvas.parentElement;
      vis.append(
        toggle('Облегчённая графика', () => stage.lowPower, v => { stage.lowPower = v; }, 'без теней'),
        toggle('Подписи на карте', () => !labelsEl?.hidden, v => { if (labelsEl) labelsEl.hidden = !v; }),
        toggle('Мини-карта', () => !miniEl?.hidden, v => { if (miniEl) miniEl.hidden = !v; }),
        toggle('18+', () => h.prefs.spicy, v => { h.setSpicy(v); renderTab(); }, 'пошлятина из беседы'),
        toggle('Музыка', () => h.prefs.music, v => h.setMusic(v)),
        toggle('Зоны захвата', () => zonesOn, v => setZones(v)),
      );
      const cam = sec(body, 'Камера');
      const sel = el('select', 'adm-in');
      sel.setAttribute('aria-label', 'Куда лететь');
      st().pts.forEach((_, i) => { const o = el('option', '', `${ptName(i)} · ${ptKind(i)}`); o.value = String(i); sel.append(o); });
      cam.append(grid(2, sel, btn('Полететь', 'go', () => { const p = st().pts[Number(sel.value)]; if (p) stage.flyTo(p.x, p.z, 45); })));

      const save = sec(body, 'Сохранение', 'JSON мира в формате локального сохранения.');
      const out = el('textarea', 'adm-in adm-ta adm-code'); out.readOnly = true; out.hidden = true; out.rows = 4;
      out.setAttribute('aria-label', 'Сохранение (JSON)');
      save.append(btn('Скопировать сохранение', '', () => {
        const json = JSON.stringify({ st: sim.snapshot(), savedAt: Date.now(), pid: h.prefs.pid, side: h.side() });
        const fallback = () => { out.value = json; out.hidden = false; out.focus(); out.select(); status('Не дали скопировать: выдели текст ниже и скопируй', 'err'); };
        try {
          const p = navigator.clipboard?.writeText(json);
          if (!p) fallback();
          else p.then(() => { out.hidden = true; status(`Скопировано: ${(json.length / 1024).toFixed(0)} КБ`, 'ok'); }, fallback);
        } catch { fallback(); }
      }), out);
      if (mode() !== 'shared') {
        const inp = el('textarea', 'adm-in adm-ta adm-code'); inp.rows = 4; inp.placeholder = 'Вставь сюда JSON сохранения';
        inp.setAttribute('aria-label', 'JSON сохранения для загрузки');
        save.append(inp, danger('Загрузить сохранение', 'Заменить текущий мир этим сохранением?', 'Да, загрузить', () => importSave(inp.value)));
      } else {
        const net = sec(body, 'Общая война');
        const cpB = btn('Чекпоинт сейчас', '', () => { const ok = h.shared()?.admin.forceCheckpoint(); status(ok ? 'Чекпоинт записан' : 'Чекпоинт пишет только хранитель (и не раньше 6 с игры)', ok ? 'ok' : 'err'); });
        const rsB = btn('Пересинхронизироваться', '', () => { h.shared()?.admin.forceResync(); status('Мир перечитан с чекпоинта', 'ok'); });
        net.append(grid(2, cpB, rsB));
        upd(() => { cpB.disabled = !h.shared()?.admin.debug().keeper; });
      }
    },
  };

  function importSave(text: string) {
    if (mode() === 'shared') { status('Загрузка — только в одиночной игре', 'err'); return; }
    let j: unknown;
    try { j = JSON.parse(text); } catch { status('Это не JSON', 'err'); return; }
    const o = j as { st?: unknown; side?: unknown };
    const raw = (o && typeof o === 'object' && o.st && typeof o.st === 'object' ? o.st : j) as State;
    const shapeOk = raw && typeof raw === 'object' && raw.v === 1 && Number.isInteger(raw.tick) && raw.tick >= 0 && Array.isArray(raw.units)
      && Array.isArray(raw.pts) && Array.isArray(raw.sides) && raw.sides.length === 2 && Array.isArray(raw.votes) && raw.votes.length === 2
      && !!raw.players && typeof raw.players === 'object';
    if (!shapeOk) { status('Не похоже на сохранение ВЫСОТКИ', 'err'); return; }
    try { // a throwaway Sim takes it first: it must load, migrate and run
      const t = new Sim(terrain);
      t.quiet = true;
      t.load(structuredClone(raw));
      for (let i = 0; i < 20; i++) t.step(undefined);
      if (!Number.isFinite(hashState(t.st)) || JSON.stringify(t.st).includes('null')) throw new Error('bad numbers');
    } catch {
      status('Сохранение битое: Sim его не принял', 'err');
      return;
    }
    const side: Side = o && (o.side === 0 || o.side === 1) ? o.side : h.side();
    new LocalBackend(h.prefs.pid, side).checkpoint(raw, Date.now());
    h.resumeLocal();
    status(`Загружено: война №${raw.era}, тик ${raw.tick}`, 'ok');
  }

  // ---- FPS (counted only while the debug page is open) ---------------------------------------------
  let fps = 0, fpsRun = false, fpsN = 0, fpsT = 0;
  function fpsLoop(t: number) {
    if (!open || tab !== 'debug') { fpsRun = false; fps = 0; return; }
    fpsN++;
    if (t - fpsT >= 1000) { fps = Math.round((fpsN * 1000) / (t - fpsT)); fpsN = 0; fpsT = t; }
    requestAnimationFrame(fpsLoop);
  }
  function startFps() { if (fpsRun) return; fpsRun = true; fpsN = 0; fpsT = performance.now(); requestAnimationFrame(fpsLoop); }

  // ---- capture zones ------------------------------------------------------------------------------
  let zonesOn = false;
  let zones: THREE.Group | null = null;
  const zoneMats = new Map<string, THREE.MeshBasicMaterial>();
  const zmat = (c: string) => { let m = zoneMats.get(c); if (!m) { m = ringMat(c, 0.7); zoneMats.set(c, m); } return m; };
  function setZones(on: boolean, quiet = false) {
    zonesOn = on;
    if (!on) { if (zones) { stage.scene.remove(zones); zones.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); zones = null; } return; }
    if (!zones) {
      zones = new THREE.Group();
      st().pts.forEach(p => {
        const m = new THREE.Mesh(ringGeo(terrain, p.x, p.z, p.kind === 0 ? HQ.zone : p.r, 0.35, 96), zmat(NEUTRAL));
        m.renderOrder = 20;
        zones!.add(m);
      });
      stage.scene.add(zones);
    }
    if (!quiet) paintZones();
  }
  function paintZones() {
    if (!zones) return;
    const pts = st().pts;
    zones.children.forEach((m, i) => { const p = pts[i]; if (p) (m as THREE.Mesh).material = zmat(p.owner >= 0 ? OWNER_COLOR[p.owner] : NEUTRAL); });
  }

  // ---- placement on the map -------------------------------------------------------------------------
  const ghostMat = { spawn: ringMat('#f2d94a', 0.95), kill: ringMat('#d8361f', 0.9) };
  let ghost: THREE.Mesh | null = null;
  let ghostAt: { x: number; z: number } | null = null;
  const barText = el('div', 'adm-bar-t');
  const barCtl = el('div', 'adm-bar-c');
  bar.append(barText, barCtl);

  function startPlace(p: Place) {
    if (!h.session()) { status('Сначала начни игру', 'err'); return; }
    cancelConfirm?.();
    place = p;
    sheet.hidden = true; bar.hidden = false;
    ghostAt = null;
    paintBar();
  }
  function stopPlace() {
    if (!place) return;
    place = null;
    bar.hidden = true; sheet.hidden = false;
    setGhost(null);
  }
  function setGhost(at: { x: number; z: number } | null) {
    if (ghost) { stage.scene.remove(ghost); ghost.geometry.dispose(); ghost = null; }
    if (!at || !place) return;
    const r = place.kind === 'kill' ? place.r : Math.max(1.2, Math.sqrt(place.n) * 0.9);
    ghost = new THREE.Mesh(ringGeo(terrain, at.x, at.z, r, place.kind === 'kill' ? 0.5 : 0.4, 72), ghostMat[place.kind]);
    ghost.renderOrder = 30;
    stage.scene.add(ghost);
  }
  function countIn(p: Extract<Place, { kind: 'kill' }>): number {
    if (!p.at) return 0;
    let n = 0;
    for (const u of st().units) if (u.hp > 0 && (p.s === -1 || u.s === p.s) && (u.x - p.at.x) ** 2 + (u.z - p.at.z) ** 2 <= p.r * p.r) n++;
    return n;
  }
  function paintBar() {
    barCtl.textContent = '';
    const p = place;
    if (!p) return;
    if (p.kind === 'spawn') {
      setText(barText, `Тапни по карте: ${UNITS[p.u].name[p.s]} ×${p.n} за ${SIDE_GEN[p.s]}. Можно несколько раз.`);
      barCtl.append(btn('Готово', 'go', () => stopPlace()));
      return;
    }
    setText(barText, p.at ? 'Круг стоит. Убрать всех внутри?' : 'Тапни по карте, где убрать юнитов');
    const r = el('input', 'adm-range');
    r.type = 'range'; r.min = '2'; r.max = '40'; r.step = '1'; r.value = String(p.r);
    r.setAttribute('aria-label', 'Радиус');
    const rl = el('span', 'adm-hand', `радиус ${p.r}`);
    r.addEventListener('input', () => { p.r = Number(r.value); setText(rl, `радиус ${p.r}`); setGhost(p.at ?? ghostAt); paintKill(); });
    const who = el('div', 'adm-seg');
    for (const [t, v] of [[SIDE_NOM[0], 0], [SIDE_NOM[1], 1], ['Обе', -1]] as [string, -1 | 0 | 1][]) {
      const b = el('button', '', t); b.type = 'button';
      b.setAttribute('aria-pressed', String(p.s === v));
      b.addEventListener('click', () => { p.s = v; who.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); paintKill(); });
      who.append(b);
    }
    const go = btn('Убрать в круге', 'redfill', () => {
      if (!p.at) return;
      send({ op: 'kill', s: p.s, x: p.at.x, z: p.at.z, r: p.r }, `Убрано в круге: ${countIn(p)}`);
      p.at = null; setGhost(null); paintKill(); setText(barText, 'Тапни по карте, где убрать юнитов');
    });
    const row = el('div', 'adm-bar-row'); row.append(r, rl);
    const goRow = el('div', 'adm-bar-go'); goRow.append(el('span', 'adm-stamp sm', 'Н'), go);
    barCtl.append(row, who, goRow, btn('Готово', '', () => stopPlace()));
    const paintKill = () => { go.disabled = !p.at; setText(go, p.at ? `Убрать в круге (${countIn(p)})` : 'Сначала тапни по карте'); };
    paintKill();
    killPaint = paintKill;
  }
  let killPaint: (() => void) | null = null;

  function onMapTap(cx: number, cy: number) {
    const p = place;
    if (!p) return;
    const w = stage.pick(cx, cy);
    if (!w) return;
    const at = { x: Math.round(w.x * 100) / 100, z: Math.round(w.z * 100) / 100 };
    if (p.kind === 'spawn') {
      setGhost(at);
      send({ op: 'spawn', s: p.s, u: p.u, n: p.n, x: at.x, z: at.z }, `${SIDE_DAT[p.s]}: ${UNITS[p.u].name[p.s]} ×${p.n}`);
      return;
    }
    p.at = at;
    setGhost(at);
    setText(barText, 'Круг стоит. Убрать всех внутри?');
    killPaint?.();
  }

  // taps on the map in placement mode belong to the panel: catch them before the game deploys a card
  const canvas = stage.canvas;
  let down: { id: number; x: number; y: number; t: number; moved: boolean } | null = null;
  addEventListener('pointerdown', e => {
    if (!place || e.target !== canvas || !e.isPrimary) return;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  }, true);
  let hoverRaf = 0;
  addEventListener('pointermove', e => {
    if (!place) return;
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) down.moved = true;
    if (e.pointerType === 'mouse' && !e.buttons && e.target === canvas && !(place.kind === 'kill' && place.at) && !hoverRaf) {
      const cx = e.clientX, cy = e.clientY;
      hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; const w = place ? stage.pick(cx, cy) : null; if (w) { ghostAt = { x: w.x, z: w.z }; setGhost(ghostAt); } });
    }
  }, true);
  addEventListener('pointerup', e => {
    if (!place || !down || e.pointerId !== down.id) return;
    const tap = !down.moved && performance.now() - down.t < 600 && e.button === 0;
    down = null;
    if (!tap) return;
    e.stopImmediatePropagation();
    // the camera input still holds this pointer: let it go without a tap
    canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, bubbles: true }));
    onMapTap(e.clientX, e.clientY);
  }, true);

  // ---- speed chip (visible while the panel is closed too) ------------------------------------------
  // Only for a pause or a speed set with «Скорость» above (opening the menu pauses a local war too, and that is
  // nobody's admin business), and never over the menu.
  let speedBy: Session | null = null;
  function paintChip() {
    const s = h.session();
    if (speedBy && (s !== speedBy || (!s.paused && s.rate === 1))) speedBy = null; // back to normal, or another game
    const menu = document.getElementById('menu');
    const menuOpen = !!menu && !menu.hidden;
    const t = !s || s !== speedBy || s.backend.kind !== 'local' || menuOpen ? '' : s.paused ? 'Пауза · админ' : `Скорость ×${s.rate} · админ`;
    chip.hidden = !t;
    setText(chip, t);
    if (zonesOn) paintZones();
  }
  setInterval(() => { if (!open) paintChip(); }, 500);

  // ---- what everyone sees ---------------------------------------------------------------------------
  let sayT = 0;
  function showSay(txt: string) {
    sayBox.textContent = '';
    sayBox.append(el('span', 'adm-say-who', 'Админ'), el('p', 'adm-say-t', txt));
    sayBox.hidden = false;
    sayBox.classList.remove('in'); void sayBox.offsetWidth; sayBox.classList.add('in');
    clearTimeout(sayT);
    sayT = window.setTimeout(() => { sayBox.hidden = true; }, 7000);
  }
  function describe(e: Extract<FxEv, { e: 'adm' }>): string {
    const s: Side | -1 = e.s === 0 || e.s === 1 ? e.s : -1;
    switch (e.op) {
      case 'money': return s !== -1 ? `${SIDE_DAT[s]} ${e.v >= 0 ? '+' : '−'}${fmt(Math.abs(e.v))} ₽ из общака` : '';
      case 'moneySet': return s !== -1 ? `Касса ${SIDE_GEN[s]}: ${fmt(e.n)} ₽` : '';
      case 'spawn': return s !== -1 && e.n > 0 ? `${SIDE_DAT[s]}: ${UNITS[e.v]?.name[s] ?? 'юниты'} ×${e.n}` : '';
      case 'boss': return '';
      case 'kill': return e.n > 0 ? `Убрано юнитов: ${e.n}${s !== -1 ? ` (${SIDE_NOM[s]})` : ''}` : '';
      case 'heal': return s !== -1 ? `${SIDE_NOM[s]} вылечены` : '';
      case 'freeze': return s !== -1 ? (e.v ? `${SIDE_NOM[s]} заморожены` : `${SIDE_NOM[s]} разморожены`) : '';
      case 'god': return s !== -1 ? (e.v ? `${SIDE_NOM[s]} бессмертны` : `Бессмертие ${SIDE_GEN[s]} снято`) : '';
      case 'floors': return s !== -1 && e.n !== e.v ? `Высотка ${SIDE_GEN[s]}: ${e.n} эт.` : '';
      case 'repair': return s !== -1 ? `Высотку ${SIDE_GEN[s]} починили` : '';
      case 'heroCd': return 'Откаты героев сброшены';
      case 'heroBack': return e.n > 0 ? 'Герои вернулись с пар' : '';
      case 'owner': { const p = st().pts[e.n]; return p ? `${ptName(e.n)} теперь ${ownerName(p.owner)}` : ''; }
      case 'card': return s !== -1 && CARDS[e.n] ? `${SIDE_DAT[s]}: «${cardTitle(e.n, CARDS[e.n].fx === Fx.Focus && e.v >= 0 ? ptName(e.v) : 'Шали')}»` : '';
      case 'endEvents': return 'Все события закончены';
      case 'score': return 'Счёт обнулён: 0:0';
      case 'reset': return 'Мир сброшен: новый сид';
      case 'diff': return `Сложность ИИ: ${DIFF[e.v] ?? ''}`;
      case 'ai': return s !== -1 ? `ИИ за ${SIDE_GEN[s]}: ${AI_MODE[e.v] ?? ''}` : '';
      default: return ''; // vote, event, win, newWar, found4, boss: the game says it itself
    }
  }

  if (wanted()) show(); // after everything above exists

  return {
    fx(e: FxEv) {
      if (e.e === 'adminSay') {
        const t = cleanSay(e.txt);
        if (!t) return;
        showSay(t);
        h.hud.feedMsg('админ', t, -1);
      } else if (e.e === 'adm') {
        const t = describe(e);
        if (t) h.hud.feedMsg('админ', t, -1);
      }
    },
    get isOpen() { return open; },
  };
}
