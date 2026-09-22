// Movie catalog.
//
// Films come from two places: the hand-written list below, and js/found.js,
// which scripts/find-uploads.mjs generates by searching YouTube. When a film
// is in both, its video IDs are combined, hand-picked ones first.
//
// PLAYABLE holds films from the IMDb Top 250 with full-length uploads on YouTube.
// Each film lists one or more candidate video IDs: the player tries them in
// order and skips any that are removed, blocked from embedding, or clearly
// shorter than the film (i.e. a clip or trailer). Uploads get taken down, so
// open check.html now and then to see which IDs still work and replace the
// dead ones.
//
// To add a film, add an entry with its IMDb id, runtime in minutes and one or
// more YouTube IDs. `genres` and `year` are there for genre/decade filters.
//
// Fields:
//   imdb      IMDb id (tt...)
//   title     Display title
//   year      Release year
//   runtime   Runtime in minutes (used to pick timestamps before the video loads)
//   genres    IMDb-style genres
//   aliases   Other accepted answers (original titles, common short forms)
//   youtube   Candidate YouTube video IDs, best first
//   skipStart Minutes at the start to exclude (opening titles give the answer away)
//   skipEnd   Minutes at the end to exclude (end credits / "The End" cards)
//   zoom      Optional. How much to scale the video so YouTube's bars are
//             cropped away. Defaults to 1.34, which suits 4:3 films; use about
//             1.25 for widescreen films letterboxed in a 16:9 upload.

import { FOUND } from "./found.js";

const HANDPICKED = [
  {
    imdb: "tt0012349",
    title: "The Kid",
    year: 1921,
    runtime: 68,
    genres: ["Comedy", "Drama", "Family"],
    aliases: [],
    youtube: ["oonqMBuxf-M", "V8IGVkZKHRE", "30j0jnk549I", "yiE1mqq5bWk", "GDpbCypTNfQ"],
    skipStart: 3,
    skipEnd: 2,
  },
  {
    imdb: "tt0015324",
    title: "Sherlock Jr.",
    year: 1924,
    runtime: 45,
    genres: ["Action", "Comedy", "Romance"],
    aliases: ["Sherlock Junior"],
    youtube: ["fZuqWxITq38", "dL3s72_Cots", "lXrBPbgBOiQ", "Ke1egfqpGNM", "YVfbpJfbN70"],
    skipStart: 2,
    skipEnd: 1,
  },
  {
    imdb: "tt0015864",
    title: "The Gold Rush",
    year: 1925,
    runtime: 95,
    genres: ["Adventure", "Comedy", "Drama"],
    aliases: [],
    youtube: ["f0b65QfYBFE", "fwy_e2WA4XE", "N9BinBmgOs0", "PoltfIRV-x0", "XZFyGP6KNjc"],
    skipStart: 3,
    skipEnd: 2,
  },
  {
    imdb: "tt0017925",
    title: "The General",
    year: 1926,
    runtime: 67,
    genres: ["Action", "Adventure", "Comedy"],
    aliases: [],
    youtube: ["gT7W2xWjpEU", "D_UdtS-8QS0", "DzspLWK9FEc", "vGM_PZTU4_0", "5FZkCPAPwzQ"],
    skipStart: 3,
    skipEnd: 2,
  },
  {
    imdb: "tt0017136",
    title: "Metropolis",
    year: 1927,
    runtime: 153,
    genres: ["Drama", "Sci-Fi"],
    aliases: [],
    youtube: ["enwB5zZfaV4", "rv3WtVKKdhU", "x0FjSj4oHyA", "cDHmIaEXvmA", "hu2Ag4fsZd4"],
    skipStart: 4,
    skipEnd: 3,
  },
  {
    imdb: "tt4154756",
    title: "Avengers: Infinity War",
    year: 2018,
    runtime: 149,
    genres: ["Action", "Adventure", "Sci-Fi"],
    aliases: ["Infinity War", "Avengers Infinity War", "Avengers 3"],
    youtube: ["E7gbDEwMtL4"],
    skipStart: 3,
    skipEnd: 12,
    zoom: 1.25,
  },
];

function merge(handpicked, found) {
  const films = handpicked.map((m) => ({ ...m, youtube: [...m.youtube] }));
  const byId = new Map(films.map((m) => [m.imdb, m]));
  for (const f of found) {
    const existing = byId.get(f.imdb);
    if (!existing) films.push(f);
    else existing.youtube = [...new Set([...existing.youtube, ...f.youtube])];
  }
  return films.filter((m) => m.youtube.length);
}

export const PLAYABLE = merge(HANDPICKED, FOUND);

// Titles from the IMDb Top 250 used for guess autocomplete, so the answer
// can't be found just by scrolling a short list of playable films.
export const TITLE_POOL = [
  ["The Shawshank Redemption", 1994], ["The Godfather", 1972], ["The Dark Knight", 2008],
  ["The Godfather Part II", 1974], ["12 Angry Men", 1957], ["Schindler's List", 1993],
  ["The Lord of the Rings: The Return of the King", 2003], ["Pulp Fiction", 1994],
  ["The Lord of the Rings: The Fellowship of the Ring", 2001], ["The Good, the Bad and the Ugly", 1966],
  ["Forrest Gump", 1994], ["Fight Club", 1999], ["The Lord of the Rings: The Two Towers", 2002],
  ["Inception", 2010], ["Star Wars: Episode V - The Empire Strikes Back", 1980], ["The Matrix", 1999],
  ["Goodfellas", 1990], ["One Flew Over the Cuckoo's Nest", 1975], ["Se7en", 1995],
  ["Interstellar", 2014], ["It's a Wonderful Life", 1946], ["Seven Samurai", 1954],
  ["The Silence of the Lambs", 1991], ["Saving Private Ryan", 1998], ["City of God", 2002],
  ["Life Is Beautiful", 1997], ["The Green Mile", 1999], ["Star Wars", 1977],
  ["Terminator 2: Judgment Day", 1991], ["Back to the Future", 1985], ["Spirited Away", 2001],
  ["The Pianist", 2002], ["Psycho", 1960], ["Parasite", 2019], ["Gladiator", 2000],
  ["The Lion King", 1994], ["Léon: The Professional", 1994], ["The Departed", 2006],
  ["American History X", 1998], ["Whiplash", 2014], ["The Prestige", 2006],
  ["Grave of the Fireflies", 1988], ["Harakiri", 1962], ["The Usual Suspects", 1995],
  ["Casablanca", 1942], ["The Intouchables", 2011], ["Cinema Paradiso", 1988],
  ["Modern Times", 1936], ["Once Upon a Time in the West", 1968], ["Rear Window", 1954],
  ["Alien", 1979], ["City Lights", 1931], ["Apocalypse Now", 1979], ["Memento", 2000],
  ["Django Unchained", 2012], ["Raiders of the Lost Ark", 1981], ["WALL·E", 2008],
  ["The Lives of Others", 2006], ["Sunset Boulevard", 1950], ["Paths of Glory", 1957],
  ["The Shining", 1980], ["The Great Dictator", 1940], ["Avengers: Infinity War", 2018],
  ["Witness for the Prosecution", 1957], ["Aliens", 1986], ["American Beauty", 1999],
  ["Dr. Strangelove", 1964], ["The Dark Knight Rises", 2012], ["Oldboy", 2003],
  ["Amadeus", 1984], ["Toy Story", 1995], ["Coco", 2017], ["Braveheart", 1995],
  ["Das Boot", 1981], ["Joker", 2019], ["Princess Mononoke", 1997], ["Good Will Hunting", 1997],
  ["Your Name.", 2016], ["Once Upon a Time in America", 1984], ["3 Idiots", 2009],
  ["High and Low", 1963], ["Singin' in the Rain", 1952], ["Requiem for a Dream", 2000],
  ["Toy Story 3", 2010], ["Capernaum", 2018], ["Star Wars: Episode VI - Return of the Jedi", 1983],
  ["Eternal Sunshine of the Spotless Mind", 2004], ["2001: A Space Odyssey", 1968],
  ["Reservoir Dogs", 1992], ["Citizen Kane", 1941], ["M", 1931], ["Lawrence of Arabia", 1962],
  ["North by Northwest", 1959], ["Vertigo", 1958], ["Amélie", 2001], ["A Clockwork Orange", 1971],
  ["Double Indemnity", 1944], ["Full Metal Jacket", 1987], ["Scarface", 1983], ["Hamilton", 2020],
  ["Incendies", 2010], ["To Kill a Mockingbird", 1962], ["Heat", 1995], ["The Sting", 1973],
  ["Up", 2009], ["A Separation", 2011], ["Metropolis", 1927], ["Taxi Driver", 1976],
  ["L.A. Confidential", 1997], ["Die Hard", 1988], ["Snatch", 2000], ["Indiana Jones and the Last Crusade", 1989],
  ["Bicycle Thieves", 1948], ["1917", 2019], ["Downfall", 2004], ["Dangal", 2016],
  ["Batman Begins", 2005], ["For a Few Dollars More", 1965], ["Some Like It Hot", 1959],
  ["The Kid", 1921], ["Green Book", 2018], ["The Apartment", 1960], ["All About Eve", 1950],
  ["The Wolf of Wall Street", 2013], ["Judgment at Nuremberg", 1961], ["Ran", 1985],
  ["Casino", 1995], ["There Will Be Blood", 2007], ["Pan's Labyrinth", 2006], ["Unforgiven", 1992],
  ["The Sixth Sense", 1999], ["Shutter Island", 2010], ["A Beautiful Mind", 2001],
  ["The Treasure of the Sierra Madre", 1948], ["Yojimbo", 1961], ["Jurassic Park", 1993],
  ["Monty Python and the Holy Grail", 1975], ["The Great Escape", 1963], ["No Country for Old Men", 2007],
  ["Kill Bill: Vol. 1", 2003], ["Rashomon", 1950], ["The Thing", 1982], ["Finding Nemo", 2003],
  ["The Elephant Man", 1980], ["Chinatown", 1974], ["Raging Bull", 1980], ["V for Vendetta", 2005],
  ["Gone with the Wind", 1939], ["Lock, Stock and Two Smoking Barrels", 1998], ["Inside Out", 2015],
  ["Dial M for Murder", 1954], ["The Secret in Their Eyes", 2009], ["Howl's Moving Castle", 2004],
  ["Three Billboards Outside Ebbing, Missouri", 2017], ["The Bridge on the River Kwai", 1957],
  ["Trainspotting", 1996], ["Prisoners", 2013], ["Warrior", 2011], ["Fargo", 1996],
  ["Gran Torino", 2008], ["My Neighbor Totoro", 1988], ["Catch Me If You Can", 2002],
  ["Million Dollar Baby", 2004], ["Children of Heaven", 1997], ["Blade Runner", 1982],
  ["The Gold Rush", 1925], ["Before Sunrise", 1995], ["12 Years a Slave", 2013],
  ["Klaus", 2019], ["Harry Potter and the Deathly Hallows: Part 2", 2011], ["Ben-Hur", 1959],
  ["The Grand Budapest Hotel", 2014], ["Gone Girl", 2014], ["On the Waterfront", 1954],
  ["The General", 1926], ["In the Name of the Father", 1993], ["Wild Strawberries", 1957],
  ["Barry Lyndon", 1975], ["The Deer Hunter", 1978], ["Hacksaw Ridge", 2016],
  ["Sherlock Jr.", 1924], ["The Third Man", 1949], ["The Wages of Fear", 1953],
  ["Memories of Murder", 2003], ["Wild Tales", 2014], ["Mr. Smith Goes to Washington", 1939],
  ["The Seventh Seal", 1957], ["Mad Max: Fury Road", 2015], ["How to Train Your Dragon", 2010],
  ["Room", 2015], ["Monsters, Inc.", 2001], ["Jaws", 1975], ["Dead Poets Society", 1989],
  ["Ford v Ferrari", 2019], ["Rocky", 1976], ["The Big Lebowski", 1998], ["Tokyo Story", 1953],
  ["Spotlight", 2015], ["The Terminator", 1984], ["Hotel Rwanda", 2004], ["Platoon", 1986],
  ["Ratatouille", 2007], ["The Passion of Joan of Arc", 1928], ["Stand by Me", 1986],
  ["Before Sunset", 2004], ["Rush", 2013], ["The Exorcist", 1973], ["The Wizard of Oz", 1939],
  ["Network", 1976], ["Into the Wild", 2007], ["Groundhog Day", 1993], ["The Truman Show", 1998],
  ["Hachi: A Dog's Tale", 2009], ["The Incredibles", 2004], ["Pirates of the Caribbean: The Curse of the Black Pearl", 2003],
  ["The Sound of Music", 1965], ["Jai Bhim", 2021], ["The Best Years of Our Lives", 1946],
  ["La haine", 1995], ["Nausicaä of the Valley of the Wind", 1984], ["Persona", 1966],
  ["Spider-Man: Into the Spider-Verse", 2018], ["Spider-Man: Across the Spider-Verse", 2023],
  ["Dune: Part Two", 2024], ["Oppenheimer", 2023], ["Top Gun: Maverick", 2022],
  ["Everything Everywhere All at Once", 2022], ["Andhadhun", 2018], ["Aladdin", 1992],
  ["The Iron Giant", 1999], ["Beauty and the Beast", 1991], ["Sunrise", 1927],
];
