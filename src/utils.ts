/**
 * await for a given milseconds
 * @param msec miliseconds to sleep
 */
export const sleep = (msec: number) =>
  new Promise(resolve => setTimeout(resolve, msec))
