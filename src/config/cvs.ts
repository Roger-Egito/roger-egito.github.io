/**
 * My CVs: a general one, and one for each role page (src/config/roles.ts).
 *
 * The contact card's CV button serves the one for the page's role: the Game Designer CV
 * on /designer/, and in the game dialogs opened there. Everywhere else, and for a role
 * whose CV isn't listed yet, it serves the general one.
 *
 * To add a version, put the PDF in public/ and uncomment its line with the right file
 * name. The build checks that every file listed here is in public/
 * (ContactCard.astro), so a typo stops the build rather than shipping a broken link.
 */
import type { RoleId } from './roles';

export type CvVersion = 'general' | RoleId;

export const cvs: { general: string } & Partial<Record<RoleId, string>> = {
  // Served from this domain rather than Google Drive: a Drive link looks provisional,
  // can hit a permission wall, and takes the reader off the site. Files in public/ are
  // copied through untouched, so a URL stays put when its PDF is replaced.
  general: '/Roger_Egito_CV.pdf',
  // developer: '/Roger_Egito_CV_Game_Developer.pdf',
  // designer: '/Roger_Egito_CV_Game_Designer.pdf',
  // writer: '/Roger_Egito_CV_Writer_Localization.pdf',
};

/** The CV for a page's role, and which version it turned out to be. */
export function cvFor(role?: RoleId): { version: CvVersion; url: string } {
  const own = role && cvs[role];
  return own ? { version: role, url: own } : { version: 'general', url: cvs.general };
}
