// Who may run admin commands, and how they reach the world. The admin panel (src/ui/admin.ts)
// asks main.ts for the channel of the game being played and never talks to a backend itself:
//   'local'    a single-browser war: the command goes straight into the session (session.submit);
//              the panel password is the only gate, and only this browser is affected.
//   'artifact' the shared war of the claude.ai artifact: only viewers with the artifact's editor
//              role (claude.use('user').canEdit()) may issue them; the command goes through
//              session.submit to src/net/shared.ts, which writes it to the db collection 'adm'
//              (rule { path: 'adm', read: 'view', write: 'admin' }) and emits it on the room topic
//              'adm' (never opened, so editors only). The platform enforces both; a refused write
//              takes the command back (Session.drop) and reports through onRefused.
//   'vercel'   the self-hosted online war: the server checks the password (login) and every
//              command; supplied by the Vercel backend, not built here. A sketch that keeps the
//              session consistent: send(cmd) → const b = admBody(cmd); if (!b) return;
//              const c = session.submit(b, lead) (stamped, applied here at tick c.t like everyone
//              else; the session's backend then carries c with the login token); when the server
//              refuses c: session.drop(c.id) and onRefused?.(reason). Receivers accept k 'adm' only
//              from the server's admin path, after validAdmCmd (src/sim/admin.ts).
// The command handed to send() is an AdmBody ({ k: 'adm', op, ...fields }, no t / id / p);
// src/sim/admin.ts documents every op, its fields and their bounds.
import type { Session } from './session';
import type { Shared } from './shared';
import { normAdm, type AdmBody } from '../sim/admin';

export interface AdminChannel {
  kind: 'local' | 'artifact' | 'vercel';
  /**
   * May this viewer issue admin commands here right now? null = allowed, else a Russian reason.
   * The panel asks before every command and about every 2.5 s while open: keep it cheap (cache).
   */
  check(): Promise<string | null>;
  /**
   * Server login (kind 'vercel'): the typed password. null = logged in, else a Russian reason.
   * The panel's login form calls it together with the local hash check (either one opens the
   * panel), and its «Войти на сервер» row calls it while check() says no.
   */
  login?(password: string): Promise<string | null>;
  /** «Выйти» in the panel: forget the server login (token), if any. */
  logout?(): void;
  /** Deliver one admin command body (AdmBody: { k: 'adm', op, ... } without t / id / p). */
  send(cmd: unknown): void;
  /** Set by the panel: the authority refused a command after send() (a Russian reason). */
  onRefused?: (reason: string) => void;
}

/**
 * The command as the session should take it: { k: 'adm', op, ...fields } with only the fields
 * of the AdmBody shape, or null when normAdm would refuse it (nothing invalid leaves the panel).
 */
export function admBody(cmd: unknown): AdmBody | null {
  if (!cmd || typeof cmd !== 'object' || normAdm({ ...(cmd as object), k: 'adm' }) === null) return null;
  const o = cmd as Record<string, unknown>, b: Record<string, unknown> = { k: 'adm', op: o.op };
  for (const f of ['s', 'v', 'n', 'u', 'x', 'z', 'r'] as const) if (typeof o[f] === 'number') b[f] = o[f];
  for (const f of ['key', 'txt'] as const) if (typeof o[f] === 'string') b[f] = o[f];
  return b as AdmBody;
}

const NO_GAME = 'Сначала начни игру: меню → сторона';
/**
 * Ticks ahead an admin command is stamped in the artifact's shared war (3 s): adm/{uid} is written
 * before the room emit, so the others get it before its tick — no rollback, and «Объявление»
 * shows for everyone (effects replayed in a rollback stay silent).
 */
export const ADM_LEAD_SHARED = 30;

/** A war in this browser only: every command goes into the local session. */
export function localChannel(session: () => Session | null): AdminChannel {
  return {
    kind: 'local',
    async check() {
      const s = session();
      if (!s) return NO_GAME;
      return s.backend.kind === 'local' ? null : 'Это не одиночная игра';
    },
    send(cmd) {
      const s = session(), b = admBody(cmd);
      if (s && b && s.backend.kind === 'local') s.submit(b);
    },
  };
}

/** The artifact's shared war: editors only, delivered over the 'adm' db collection and room topic. */
export function artifactChannel(shared: () => Shared | null, session: () => Session | null): AdminChannel {
  const ch: AdminChannel = {
    kind: 'artifact',
    async check() {
      const sh = shared(), s = session();
      if (!sh) return 'Общая война недоступна';
      if (!s || s.backend.kind !== 'shared') return 'Сначала войди в общую войну';
      wire(sh);
      return (await sh.admin.canEdit()) ? null : 'Нужна роль редактора артефакта: команды не пройдут';
    },
    send(cmd) {
      const sh = shared(), s = session(), b = admBody(cmd);
      if (!sh || !s || !b || s.backend.kind !== 'shared') return;
      wire(sh);
      s.submit(b, Math.max(s.lead, ADM_LEAD_SHARED)); // SharedWar.send routes k 'adm' to adm/{uid}, then the room topic 'adm'
    },
  };
  const wire = (sh: Shared) => {
    sh.admin.onRefused = why => ch.onRefused?.(
      why === 'no_identity' ? 'Платформа не знает, кто ты: команда не ушла' : `Платформа не приняла команду (${why}): нужна роль редактора артефакта`,
    );
  };
  return ch;
}
