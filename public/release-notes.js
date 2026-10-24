// Release notes, newest first: shown in the What's New popup (the start
// screen's "What's new" link, and the update notification in
// Notifications). The newest entry without `draft` is also THE game
// version: the About title, the start screen footer, the contact form and
// package.json (scripts/sync-version.js, run by the pre-commit hook) all
// take it from here.
//
// To release:  npm run release-notes -- draft [version]
//              (adds a draft entry from the commits since the last version;
//               rewrite its lines for players, then)
//              npm run release-notes -- publish
// A `draft` entry is never shown, so an unfinished one can't go out. This
// file is rewritten by that script: keep to the same shape (strings only,
// no comments inside the list).
const RELEASE_NOTES=[
  {
    version:"0.18.1",
    date:"2026-10-24",
    draft:true,
    improved:[
      "The waiting room's Ready button matches the new look, and shows a clear ✓ Ready once you've pressed it.",
      "Tighter security on the game server.",
    ],
  },
  {
    version:"0.18.0",
    date:"2026-10-17",
    new:[
      "Replays: watch any game from Play History again on the game table, move by move.",
      "Move review: every one of your discards and calls is graded from Best to Blunder, with the stronger option and why.",
      "Game Summary: a rating for the whole game, your key moments, and what each grade means.",
      "What's New: see what changed in each update, from the start screen or Notifications.",
    ],
    improved:[
      "New start menu, and a refreshed look for windows and the game table.",
      "AI opponents think faster.",
    ],
  },
];
