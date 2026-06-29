// Petit shim de persistance basé sur localStorage.
// Même esprit que le window.storage des artifacts Claude, mais 100 % standard
// navigateur : aucune dépendance, fonctionne en local et sur GitHub Pages.

const PREFIX = "ardoise:";

export const storage = {
  get(key) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? null : { value: v };
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};
