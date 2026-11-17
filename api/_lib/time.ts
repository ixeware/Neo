/** Server time. tools/devserver.mjs (test mode only) shifts `off` to fake a long sleep; production keeps 0. */
export const time = {
  off: 0,
  now(): number { return Date.now() + time.off; },
};

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
