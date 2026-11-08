/**
 * UX review, Spanish copy heard in the sample case (UI-DESIGN §10, §12.7). The geometry name is user-given (or the
 * sample's "Scan body de ejemplo", masculine), so a participle glued to {name} cannot agree with it; an impersonal
 * form ("Se aplicó {name} a …") works for any name. "BUG:" fails until the copy is fixed.
 */
import { describe, expect, it } from 'vitest';
import es from '../../ui/i18n/es';
import { fmt } from '../../ui/i18n/format';

describe('Spanish announcements with a geometry name', () => {
  const name = es.lib.sampleName; // "Scan body de ejemplo" (masculine)
  const lines = {
    applied: fmt('es', es.say.applied, { name, target: es.lib.targetAll }),
    saved: fmt('es', es.say.saved, { name }),
    favOn: fmt('es', es.say.favOn, { name }),
    favOff: fmt('es', es.say.favOff, { name }),
    removed: fmt('es', es.say.removed, { name }),
  };
  for (const [key, text] of Object.entries(lines)) {
    it(`BUG: say.${key} does not force a feminine participle on the name ("${text}")`, () => {
      expect(text).not.toMatch(/^Scan body de ejemplo (aplicada|guardada|agregada|quitada|eliminada)\b/);
    });
  }
});
