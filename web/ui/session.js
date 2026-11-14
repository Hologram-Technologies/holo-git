// What this browser remembers about its user: a name and email for commits, the theme, and whether a
// sign-in key exists. None of it is a permission; who may do what is decided elsewhere, never here.

import { loadKey } from '../store.js';
import { deviceKey } from '../identity.js';

const read = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

// The older screens read these two keys directly, so the names stay.
export const profile = () => ({ name: read('holo-git-name'), email: read('holo-git-email') });
export function setProfile({ name, email }) { write('holo-git-name', name.trim()); write('holo-git-email', email.trim()); }

export const hasKey = async () => Boolean(await loadKey());
export const createKey = async () => (await deviceKey()).id;
export const keyId = async () => ((await hasKey()) ? (await deviceKey()).id : null);
// "Signed in" means first run is complete: there is a name and a sign-in key.
export const signedIn = async () => Boolean(profile().name) && hasKey();

export const THEMES = ['auto', 'light', 'dark', 'dark_dimmed', 'light_high_contrast', 'dark_high_contrast'];
export const theme = () => (THEMES.includes(read('theme')) ? read('theme') : 'auto');
export function applyTheme(choice = theme()) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = choice === 'auto' ? (dark ? 'dark' : 'light') : choice;
}
export function setTheme(choice) { write('theme', choice); applyTheme(choice); }
export function watchTheme() { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme()); }
