// Light/dark theme. Dark is the default; the choice is remembered per browser.
// Pages also set data-theme from a tiny inline script in <head> so there is no flash of light.
const KEY = 'vda-theme';
export const currentTheme = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
}
export function mountThemeToggle(button) {
  const label = () => { const dark = currentTheme() === 'dark'; button.textContent = dark ? 'Light mode' : 'Dark mode'; button.setAttribute('aria-pressed', String(dark)); };
  button.addEventListener('click', () => { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); label(); });
  label();
}
