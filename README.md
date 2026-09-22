# Timestamp

A movie guessing game. Pick a moment in a mystery film from the IMDb Top 250,
get a single frozen frame from that moment, and name the film.

## Play

It's a static site with no build step. Serve the folder and open it:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` straight from disk won't work, because ES modules and the
YouTube player both need an `http(s)` origin.)

## How it works

- **Rounds:** each game has 5 films, drawn at random from the playable catalog.
- **Picking a frame:** use the slider or "Surprise me" to pick a timestamp. The
  opening titles and end credits are left out, so the frame can't show the title.
- **Scoring:** a correct answer is worth 100 points, minus 20 for each extra
  frame and 15 for each wrong guess (never less than 10). You get 3 guesses. Typos
  are forgiven, and a leading "The" is optional.
- **No spoilers:** the video plays muted behind a curtain until it reaches the
  chosen frame and pauses there. The iframe is scaled up inside a clipping frame,
  which hides YouTube's title bar and bottom overlays, and a transparent shield
  blocks hover and clicks, so YouTube's UI never appears. Change `--zoom` in
  `style.css` to adjust the crop.
- **Broken uploads:** each film lists several YouTube IDs. The player skips any
  that are removed, not embeddable, or much shorter than the film (a clip or
  trailer), and remembers the one that worked in `localStorage`.

## Catalog

`js/movies.js` has two lists:

- `PLAYABLE`: the films the game can show. For now these are the Top 250 films
  that are public domain in the US (The Kid, Sherlock Jr., The Gold Rush,
  The General, Metropolis), since full uploads of those can be embedded
  legitimately.
- `TITLE_POOL`: Top 250 titles used for guess autocomplete, so the answer isn't
  obvious from a short list.

To add a film, add an entry to `PLAYABLE` with its IMDb id, runtime, genres and
one or more YouTube IDs. Good sources are official studio channels that post free
full-length films. Each entry already has `genres` and `year`, ready for
genre and decade filters.

## Roadmap

- Two or more players taking turns, with a scoreboard (game state already keeps
  a `players` array)
- Genre and decade filters
- More films from official free uploads
