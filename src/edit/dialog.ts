/**
 * In-app replacement for window.confirm / window.prompt / window.alert.
 *
 * Native dialogs get blocked by some browser security extensions after a few
 * calls on one page (they are flagged as "browser locker" behaviour), which
 * made every delete button in the editor throw. DialogHost.svelte renders the
 * request stored in `activeDialog`; the helpers below resolve once the user
 * answers. Requests queue up so back-to-back calls are shown one at a time.
 */
import { get, writable } from 'svelte/store';

export interface DialogOptions {
  /** Heading shown above the message. Has a sensible default per kind. */
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** Style the OK button as destructive. */
  danger?: boolean;
  /** Prompt only: let the user submit an empty value (e.g. to clear a label). */
  allowEmpty?: boolean;
}

interface Base extends DialogOptions {
  message: string;
}

export type DialogRequest =
  | (Base & { kind: 'confirm'; settle: (ok: boolean) => void })
  | (Base & { kind: 'prompt'; initial: string; settle: (value: string | null) => void })
  | (Base & { kind: 'alert'; settle: () => void });

/** The dialog currently on screen, or null. Only DialogHost should render it. */
export const activeDialog = writable<DialogRequest | null>(null);

const queue: DialogRequest[] = [];

function show(req: DialogRequest): void {
  queue.push(req);
  if (get(activeDialog) === null) advance();
}

function advance(): void {
  activeDialog.set(queue.shift() ?? null);
}

/** Guards a resolver so a request settles at most once, then shows the next request. */
function once<T>(resolve: (value: T) => void): (value: T) => void {
  let done = false;
  return (value) => {
    if (done) return;
    done = true;
    resolve(value);
    advance();
  };
}

/** Resolves true when the user presses OK, false on Cancel or Escape. */
export function confirmDialog(message: string, opts: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => show({ kind: 'confirm', message, ...opts, settle: once(resolve) }));
}

/** Resolves the trimmed text on OK (non-empty unless `allowEmpty`), or null on Cancel or Escape. */
export function promptDialog(message: string, initial = '', opts: DialogOptions = {}): Promise<string | null> {
  return new Promise((resolve) => show({ kind: 'prompt', message, initial, ...opts, settle: once(resolve) }));
}

/** Resolves once the user dismisses the message. */
export function alertDialog(message: string, opts: DialogOptions = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = once<void>(() => resolve());
    show({ kind: 'alert', message, ...opts, settle: () => finish() });
  });
}
