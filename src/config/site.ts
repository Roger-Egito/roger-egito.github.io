// Site text and links. Colours are in src/styles/tokens.css instead, so the CSS
// can use them directly.

export const site = {
  title: 'Roger Egito',
  email: 'rogeregito@outlook.com',
  url: 'https://roger-egito.github.io',
  description: 'Portfolio of game designer and developer Roger Egito.',
  keywords: 'portfolio, game, developer, designer, programmer, video, roger, egito',
  author: 'Egito Roger',
  skills: 'Game Designer | Developer',
  slogan: 'Creating games with heart and soul',

  /** Where the contact form posts to. */
  contactAction: 'https://formspree.io/f/xldnwyla',

  footerNote: 'Games developed by Roger Egito (fully or partially), not restricted by NDA.',

  /** `icon` is a Font Awesome brand icon name (fa-brands fa-<icon>). */
  social: [
    { icon: 'itch-io', url: 'https://egito.itch.io' },
    { icon: 'linkedin', url: 'https://www.linkedin.com/in/roger-egito/' },
    { icon: 'github', url: 'https://github.com/Roger-Egito' },
  ],

  /** `icon` is a Font Awesome solid icon name (fas fa-<icon>). */
  links: [
    {
      icon: 'file',
      url: 'https://drive.google.com/file/d/1hZ3cvIdgSqQ17rHSOdth92TKjoFSWDFk/view?usp=sharing',
    },
  ],
} as const;

/** Only icon shown above the contact form. */
export const contactSocial = site.social[1];
