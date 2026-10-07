# Design

How this site is laid out, and why. Read this before changing the homepage, so a new
section or tweak follows the same rules instead of starting a new set.

## Who it's for

People deciding whether to hire me: recruiters, leads and clients. They scan fast, often on
a phone, and decide in the first screen whether to keep going. Everything below serves
that reader.

## The look: Steam's

The site looks like the Steam store, on purpose. The people I want to reach browse Steam
every day, so its layout reads to them as "games, and where to find out more" before they
read a word. The colours, the bars, the capsules and the hover box are all Steam's,
measured off store.steampowered.com (see the comments in `src/config/theme.ts` for
which element each value came from). What's mine is the content and a few controls: the
footage, the d-pad, the cursors.

## Principles

1. **Work above the fold.** A visitor sees games without scrolling, on every screen size.
   The featured capsules stand on the hero's footage, under my name.
2. **Identity first.** The first thing on the page is my name, my title and real footage
   of my work.
3. **Size says what matters.** The featured games are tall capsules, bigger than the
   catalog's. Bigger means "look here first", so it's reserved for my strongest work.
4. **Calm at rest, detail on demand.** A card at rest is its artwork and what I did on
   it. Everything else opens when you point at it or tab to it, the way Steam's hover box
   does.
5. **Nothing only on hover.** Without hover, a tap opens the game's dialog, which carries
   everything the hover box does and more. The filter menus cover what the box's chips do.
6. **Colour carries meaning.** Steam's palette for everything, plus the five discipline
   colours on the responsibility tags. No other hues.
7. **Motion respects the visitor.** Anything that moves has a reduced-motion path: the
   hero reel doesn't run, and panels and filtering swap instantly.

## Page anatomy

Top to bottom, on the homepage:

1. **Navbar.** Steam's global header: sticky, name and links.
2. **Hero.** Footage behind everything, fading into the page by the bottom. On it: name,
   title, the reel's dots, the d-pad and the social links, then the featured capsules.
3. **Portfolio.** Section title, the menu bar (filters and search), the full catalog grid.
4. **Beyond Games.** Work that isn't a shipped game. Off the page for now.
5. **Footer.**

Game pages share the navbar and the footer.

## Components

### Navbar (`SiteNav.astro`)

- Sticky at the top, 64px, Steam's header colour, no border.
- Name on the left, back to the top. Links on the right, uppercase, blue when pointed at:
  Portfolio, About, CV, Contact.
- Below 860px the links fold behind a menu button.

### Hero (`Header.astro`, `hero-reel.ts`)

- As tall as what it holds: the name block, then the featured row passed in as its slot.
- The footage covers all of it and fades into the page's colour behind the lower half
  of the capsules. Clicking bare footage opens the game that's playing.
- Text is the name and the title only.
- Dots under the title, shaped like Steam's carousel thumbs, one per game in the reel's
  running order. Clicking one jumps to that game.
- D-pad: Left and Right step the reel, Down goes to the portfolio, Up goes to the search.

### Card (`GameCard.astro`, `card-popup.ts`)

One component, two sizes, used by both the featured row and the grid.

- **At rest:** the artwork and a dark strip under it with my roles. The whole thing is the
  link. Grid artwork is 16:9. Featured artwork is 2:3, cropped from the same 16:9 image
  around the game's `focus`.
- **Hover box:** Steam's pale blue-grey box with the name, year and stack, genre tags,
  blurb, the green store button, and the responsibility tags in their discipline colours.
  On a grid card it opens beside the card, on whichever side has room, with Steam's arrow
  pointing back.
- **Featured card turned over:** on hover the card's own frame flips to the clip at its
  true 16:9 over a black band, with the info under it on a dark gradient, the way Steam's
  tall capsules do. It stays inside the frame. A click anywhere on it that isn't a button
  opens the game.
- The stack icons and the tags are buttons that filter the grid.
- Engaged state (hover, or keyboard focus inside): the strip darkens, the artwork comes up
  to full and the preview clip plays if the game has one.

### Featured row (`FeaturedRow.astro`)

- Chosen by `featured: true` in a game's front matter. Three at most.
- No title over it. Capsules 290px wide, centred, from 768px. Below that, a horizontal
  strip with snap points, with the next capsule peeking in from the edge.
- It repeats games the grid also lists. The row is a spotlight, the grid is the catalog.

### Menu bar and grid (`FilterBar.astro`, `PortfolioGrid.astro`)

- Steam's store menu bar: filter menus on the left, the search on the right with the
  blue button. Active filters in a row underneath, then the count.
- Menus open on click (touch screens can't hover), close on Escape or a click outside.
- Same menu means "or", different menus mean "and".
- The grid runs four columns from 1200px, then three, two and one.
- Filtering animates: dropped cards fade out, the rest slide to their new places.

## Interaction rules

- **Click, not hover, opens things.** Hover only reveals detail that is also reachable
  another way.
- **Keyboard gets what the mouse gets.** `:focus-visible` inside a card opens its box, the
  same as hover.
- **State lives in the address.** Filters and search are in the URL (`?f=unity,python&q=war`),
  so a filtered view can be shared, reloaded, and undone with Back.

## Tokens

Colours are defined once in `src/config/theme.ts`, type and spacing in
`src/styles/tokens.css`. Components use the variables. Don't copy values into a component.
The one font is Lato, standing in for Steam's Motiva Sans, which is licensed and can't be
served from here.

## What I took from Steam, and what I didn't

Taken: the palette, the header, the menu bar and its search, section titles, tall
capsules on the banner, carousel dots, the hover box and its tags, the blue and green
buttons.

Left out:

- **A carousel for the whole catalog.** With eleven games, a carousel would hide most of
  them behind clicks. A grid shows them all.
- **Store furniture.** Prices, discount badges, sign-in, wishlists. My roles are the
  equivalent of a price, and the cards show them.
- **Steam's name and logo.** It looks like Steam, it doesn't say it's Steam.

## Checking a layout change

Run these in headless Chrome against a production build (`npm run build`, then
`npx astro preview`), since the dev server can serve stale styles:

- The first featured capsule's top is under 700px at 1440x900 and 1920x1080, and the
  first capsule is on screen at 390x844.
- The navbar is visible on load, on the homepage and on a game page.
- A card's hover box opens on hover and on Tab, doesn't move any other card, stays open
  while the pointer moves into it, and never gives the page a horizontal scroll.
- Filtering, search ranking, highlights, deep links and Back behave as before.
- No horizontal scroll at any width.
