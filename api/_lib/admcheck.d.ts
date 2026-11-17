// Types for the generated api/_lib/admcheck.js (tools/gen-admcheck.mjs bundles src/sim/admin.ts).
export declare const ADM_OPS: readonly string[];
export declare const ADM_MAX: { money: number; bank: number; spawn: number; radius: number; say: number };
/** A full admin command off the wire ({ t, id, p, k: 'adm', op, ...fields }): the sim's own check. */
export declare function validAdmCmd(c: unknown): boolean;
export declare function normAdm(c: unknown): Record<string, unknown> | null;
export declare function cleanSay(t: unknown): string;
