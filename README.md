# Cube Beats

A rhythm game for any Bluetooth smart cube, no gyro needed. Notes scroll down six lanes, one per face; turn that face when its note reaches the line. Filled notes are clockwise turns (`R`), outlined notes counter-clockwise (`R'`).

The demo song "Neon Turns" is generated live with the Web Audio API. Its chart is built from sequences that return the cube to where it started: the sexy move (`R U R' U'`) and the sledgehammer (`R' F R F'`) six times each, plus `U U'` and `D D'` trills.

An official [acubemy](https://acubemy.com) plugin. Install it on acubemy under **Games & Plugins** with the URL `https://github.com/acubemy/cube-beats`.

## Files

| File | Purpose |
| --- | --- |
| `acubemy-plugin.json` | Plugin manifest (needs only the `moves` permission) |
| `index.html`, `style.css` | Menu, HUD and results screens |
| `chart.js` | Song tempo, chord progression, sections and the note chart |
| `audio.js` | Synthesized music and hit sounds |
| `main.js` | Game loop: scrolling lanes, timing windows, score and combo |

## Adding a song

Edit `chart.js`: set `SONG.bpm` and `SONG.bars`, adjust `SECTIONS` and write the chart with `sequence(moves, startBar, beatsPerMove)`.

## Local development

`npx serve --cors .`, then load `http://localhost:3000` in acubemy's developer mode. Opened directly in the browser, the keys `U R F D L B` (Shift = counter-clockwise) replace the cube.

## License

MIT
