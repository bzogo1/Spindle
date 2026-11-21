/* Site theme — shared by the (site), (auth), and (changelog) layouts.
 *
 * The site follows the operating system's color-scheme preference; there is
 * no in-page override, so nothing is persisted. SITE_THEME_SCRIPT is inlined
 * into <head> by the layouts so the `.dark` class lands on <html> before
 * first paint — no flash of the wrong theme — and it keeps the class in sync
 * when the OS preference changes while the page is open.
 */

export const SITE_THEME_QUERY = "(prefers-color-scheme: dark)"

export const SITE_THEME_SCRIPT = `(function () {
  try {
    var media = window.matchMedia('${SITE_THEME_QUERY}');
    document.documentElement.classList.toggle('dark', media.matches);
    if (media.addEventListener) {
      media.addEventListener('change', function (event) {
        document.documentElement.classList.toggle('dark', event.matches);
      });
    }
  } catch (e) {
    // matchMedia can be unavailable; fall back to the light appearance.
  }
})();`
