import path from 'node:path';
import { listUsers } from '../src/auth.js';
import type { AuthUser } from '../src/context.js';
import { runAs } from '../src/context.js';
import { listDataFiles } from '../src/paths.js';
import { dayKeyFromMs } from '../src/shared/calories.js';
import { addEntry } from '../src/tools/calories/storage.js';
import { addEpisode } from '../src/tools/calories/digestion.js';

/**
 * One-time import of a pasted food journal into meal entries + digestion
 * episodes. Run this on the box where DATA_DIR is real (ZIMADASH_DATA_DIR, or
 * the ~/zimadash-data default) — not in a throwaway checkout — since it
 * writes straight to storage, the same functions the server itself calls.
 *
 * Each day in the journal becomes up to four meal entries (one per
 * Breakfast/Lunch/Dinner/Snacks line that isn't blank) plus one episode if
 * that day was marked "Yes". The journal has no clock times beyond when the
 * entry was written, so:
 *   - the day a block describes comes from running its timestamp through the
 *     app's own 4am rollover rule (dayKeyFromMs) — a block stamped 1:29am
 *     describes the day that just ended, one stamped 11:43pm describes the
 *     day still in progress, and both land correctly without special-casing.
 *   - meals get synthetic times within that day (breakfast 8am, lunch
 *     12:30pm, dinner 6:30pm, snacks 3pm) so the same-day "before the
 *     episode" ordering in the suspects analysis has something to work with.
 *   - a "Yes" day gets one severity-2 episode at 8:30pm, since the note only
 *     ever recorded yes/no, never how bad.
 *
 * Descriptions are normalized to the comma-separated ingredient-list format
 * the brain now produces (splitting on "," and "." so "yogurt, string
 * cheese. spicy ramen" becomes three items) but are not otherwise rewritten —
 * "Wendy's" stays "Wendy's" rather than being decomposed, same as a live
 * capture would leave an unknown restaurant order.
 *
 * The household is PINs, not named accounts (see AGENTS.md) — a user's id is
 * an opaque UUID with nothing in it that says whose journal this is. With more
 * than one user on the box, this refuses to guess: it lists the users (with
 * how much existing calorie history each already has, as the only real clue)
 * and asks for --user <id> rather than silently seeding the wrong person.
 *
 * Usage: npx tsx scripts/seed-digestion.ts --user <id> [--dry-run]
 */

const RAW = String.raw`
Mar 9, 2026 at 1:29 AM
Breakfast:
Lunch: Wendy's
Dinner: jimmy John's
Snacks: fruit rollups, chocolate milk, chobani, slice of bacon
Digestive issue? Yes
—-
Mar 10, 2026 at 1:07 AM
Breakfast:
Lunch: cambells chicken noodle soup
Dinner: whistlewok
Snacks: fruit rollups
Digestive issue? Yes
—-
Mar 11, 2026 at 1:02 AM
Breakfast: yogurt, string cheese. Spicy Ramen, Dr Pepper zero
Lunch:
Dinner: white chicken chili, corn chips, salsa.
Snacks: fruit rollups.
Digestive issue? Yes
---
Mar 12, 2026 at 12:29 AM
Breakfast:
Lunch: fried chicken.
Dinner: Arby's
Snacks: fruit snacks, Kirkland granola bars
Digestive issue? No
---
Mar 13, 2026 at 11:55 PM
Breakfast:
Lunch: JCW's
Dinner:
Snacks: fruit leather, pudding cup, granola bar
Digestive issue? No
---
Mar 14, 2026 at 12:38 AM
Breakfast: yogurt fruit granola parfait
Lunch: chicken and corn tortilla
Dinner: in n out
Snacks: cookies, Black Forest gummy bear, cheese stick and peanut butter
Digestive issue? No
---
Mar 15, 2026 at 12:02 AM
Breakfast: eggs and tortilla
Lunch:
Dinner: stroganoff and broccoli
Snacks: Black Forest gummy bear, peeps
Digestive issue? No
---
Mar 16, 2026 at 12:10 AM
Breakfast:
Lunch: stroganoff and broccoli
Dinner: tomato soup and grilled cheese
Snacks: granola, popcorn, Black Forest gummy bears,
Digestive issue? Yes
---
Mar 17, 2026 at 12:52 AM
Breakfast:
Lunch: sandwich
Dinner: gyro plate
Snacks: ice cream, camels soup
Digestive issue? Yes
---
Mar 19, 2026 at 12:09 AM
Breakfast:
Lunch: leftover stroganoff
Dinner: rice, meatballs, and broccoli
Snacks: gummy bears
Digestive issue? Yes
---
Mar 20, 2026 at 1:16 AM
Breakfast: Chick-fil-A
Lunch:
Dinner: lasagna and cambells soup
Snacks: gummy bears
Digestive issue? No
---
Mar 21, 2026 at 1:56 AM
Breakfast:
Lunch: meatballs and rice
Dinner: lasagna
Snacks: couple cookies
Digestive issue? No
---
Mar 22, 2026 at 12:28 AM
Breakfast:
Lunch: yogurt, meatballs and rice
Dinner: smoked beef, potatoes broccoli and monkey bread
Snacks:
Digestive issue? No
---
Mar 23, 2026 at 3:03 AM
Breakfast:
Lunch: chubby's
Dinner: grandma curry with garbanzo beans
Snacks:
Digestive issue? No
---
Mar 24, 2026 at 2:33 AM
Breakfast:
Lunch: in n out
Dinner: beef and potatoes
Snacks: cheese and yogurt.
Digestive issue? No
---
Mar 25, 2026 at 3:03 AM
Breakfast:
Lunch: costa vida
Dinner: Freddy's chili cheese fries
Snacks:
Digestive issue? No
---
Mar 26, 2026 at 12:40 AM
Breakfast:
Lunch: zuppa toscana
Dinner: knorr noodles and chicken
Snacks: cookies and Black Forest gummy bears
Digestive issue? No
---
Mar 27, 2026 at 1:41 AM
Breakfast:
Lunch: bagel, egg, cheese, rotisserie chicken
Dinner: Wendy's
Snacks: popcorn
Digestive issue? No
---
Mar 28, 2026 at 1:23 AM
Breakfast:
Lunch: breakfast sandwiches
Dinner: Mac and cheese, chef boyardi
Snacks: Dr Pepper zero
Digestive issue? No
---
Mar 29, 2026 at 1:13 AM
Breakfast:
Lunch: bagel and eggs
Dinner: salmon, broccolini, and potatoes
Snacks: nuts, potato chips, and granola bar
Digestive issue? No
---
Mar 30, 2026 at 1:26 AM
Breakfast:
Lunch: breakfast sandwiches, bagel cream cheese
Dinner: poppy seed chicken, cambells  soup
Snacks: jolly rancher jelly beans
Digestive issue? No
---
Mar 31, 2026 at 1:49 AM
Breakfast: breakfast sandwiches
Lunch:
Dinner: zuppa toscana
Snacks: beef jerky, popcorn, candy
Digestive issue? No
---
Apr 1, 2026 at 1:05 AM
Breakfast: Chick-fil-A
Lunch:
Dinner: ihop
Snacks: yogurt, jelly beans
Digestive issue? No
---
Apr 2, 2026 at 12:54 AM
Breakfast: chef byardi
Lunch: chile lime enchiladas
Dinner: ooey gooey Mexican chicken
Snacks: potato chip, string cheese, yogurt
Digestive issue? Yes
---
Apr 3, 2026 at 12:37 AM
Breakfast:
Lunch: ooey gooey chicken
Dinner: sushi belt place
Snacks: potato chips, string cheese
Digestive issue? Yes
---
Apr 4, 2026 at 2:13 AM
Breakfast:
Lunch: pancakes, eggs, bacon
Dinner: Wendy's
Snacks: ramen and yogurt
Digestive issue? No
---
Apr 5, 2026 at 12:10 AM
Breakfast:
Lunch: yogurt,
Dinner: cake, grandma pizza, chops and pace salsa
Snacks: chicken noodle soup, chef boyardi
Digestive issue? No
---
Apr 6, 2026 at 1:06 AM
Breakfast:
Lunch: fish tacos
Dinner: pizza
Snacks: pretzels
Digestive issue? No
---
Apr 7, 2026 at 1:21 AM
Breakfast: zuppa todcana, yogurt
Lunch:
Dinner: enchilada rice and beans
Snacks: potato chips, pretzels.
Digestive issue? Yes
---
Apr 9, 2026 at 1:31 AM
Breakfast:
Lunch: in n out.
Dinner: pasta bolognese, broccoli, cantaloupe.
Snacks: lunchable, yogurt.
Digestive issue? No
---
Apr 10, 2026 at 1:50 AM
Breakfast:
Lunch: fried chicken
Dinner: leftover pizza and adult lunchables
Snacks: waffles
Digestive issue? Yes
---
Apr 11, 2026 at 1:35 AM
Breakfast:
Lunch: adult lunchables.
Dinner: gnocchi chicken soup
Snacks:
Digestive issue? No
---
Apr 12, 2026 at 12:50 AM
Breakfast:
Lunch: beef soup
Dinner: pot roast, Brussel sprouts, mashed potatoes.
Snacks:  yogurt and crackers
Digestive issue? Yes
---
Apr 13, 2026 at 1:26 AM
Breakfast:
Lunch: jerky, waffles
Dinner: miso ramen
Snacks: bunch of candy
Digestive issue? No
---
Apr 14, 2026 at 2:49 AM
Breakfast:
Lunch: lunch meat, crackers, cheese, yogurt.
Dinner: Buffalo Wild Wings
Snacks: herky and yogurt
Digestive issue? No
---
Apr 16, 2026 at 1:00 AM
Breakfast:
Lunch: adult lumchables
Dinner: mo bettahs
Snacks: jelly beans
Digestive issue? Yes
---
Apr 17, 2026 at 2:09 AM
Breakfast:
Lunch: Wendy's
Dinner: brats, sauerkraut, rotkohl, potatoes
Snacks: miso soup, smoothie
Digestive issue? Yes
---
Apr 18, 2026 at 1:49 AM
Breakfast:
Lunch:  hash browns eggs and Sausage
Dinner: in n out
Snacks: taco soup and smoothies
Digestive issue? Yes
---
Apr 19, 2026 at 1:27 AM
Breakfast:
Lunch: beef gravy and potatoes.
Dinner: scallops, knorr noodles, and broccoli.
Snacks: jelly beans
Digestive issue? No
---
Apr 20, 2026 at 1:26 AM
Breakfast:
Lunch: five guys
Dinner: taco soup
Snacks: smoothie
Digestive issue? No
---
Apr 21, 2026 at 12:55 AM
Breakfast:
Lunch: hard boiled eggs, yogurt
Dinner: chicken Thai green curry
Snacks: jelly beans, granola bites, smoothie
Digestive issue? No
---
Apr 22, 2026 at 1:06 AM
Breakfast: cambells rice and chicken soup. Two mini frozen pizza.
Lunch:
Dinner: shrimp and corn
Snacks: beef stick and candy.
Digestive issue? No
---
Apr 23, 2026 at 1:18 AM
Breakfast:
Lunch: avocado toast and cheese and egg
Dinner: steak tacos
Snacks: candy
Digestive issue? No
---
Apr 24, 2026 at 12:53 AM
Breakfast:
Lunch: chips and homemade salsa and guacamole
Dinner: Steak, broccoli, potatoes
Snacks: juice and candy.
Digestive issue? Yes
---
Apr 25, 2026 at 1:16 AM
Breakfast:
Lunch: egg and avocado toast with cheese
Dinner: five guys
Snacks: Costco smoothie
Digestive issue? No
---
Apr 26, 2026 at 12:40 AM
Breakfast:
Lunch: yogurt. Chips and salsa. Fruit leather
Dinner: pork loin, mashed potato, salad, corn bread
Snacks:
Digestive issue? No
---
Apr 27, 2026 at 1:25 AM
Breakfast:
Lunch: mo bettah
Dinner: cheese burger
Snacks:
Digestive issue? No
---
Apr 29, 2026 at 12:24 AM
Breakfast:
Lunch: spaghetti
Dinner: burger
Snacks: yogurt, waffle, string cheese, potato chips
Digestive issue? No
---
Apr 30, 2026 at 1:11 AM
Breakfast:
Lunch: carnitas meat, beans, rice, tortillas
Dinner: Haku ramen guoza
Snacks: beef stick, fruit snacks, rice crispies.
Digestive issue? No
---
May 1, 2026 at 12:52 AM
Breakfast:
Lunch: chef boyarsi
Dinner: Zulu chicken bowl
Snacks: smoothie
Digestive issue? No
---
May 3, 2026 at 12:07 AM
Breakfast:
Lunch:
Dinner: steak, potatoes, broccoli, mushrooms.
Snacks: yogurt, string cheese, potato chips, protein shake
Digestive issue? No
---
May 4, 2026 at 1:54 AM
Breakfast:
Lunch: Wendy's
Dinner: Costco pizza
Snacks:
Digestive issue? Yes
---
May 5, 2026 at 1:34 AM
Breakfast:
Lunch: chicken noodle cambells, chef boyardi.
Dinner: 5 guys
Snacks:
Digestive issue? Yes
---
May 6, 2026 at 2:00 AM
Breakfast: oatmeal
Lunch: tuna fish
Dinner: burger
Snacks:
Digestive issue? No
---
May 7, 2026 at 12:49 AM
Breakfast:
Lunch: chef boyardi
Dinner: miso ramen
Snacks: fruit leather, dot's pretzels,
Digestive issue? No
---
May 8, 2026 at 1:43 AM
Breakfast:
Lunch: fresh salsa, tuna, chips, pretzels
Dinner: in n out with chocolate shake
Snacks:
Digestive issue? No
---
May 9, 2026 at 1:57 AM
Breakfast:
Lunch: Costco hotdog and pizza
Dinner: sushi
Snacks: Tuna fish and pretzels.
Digestive issue? No
---
May 10, 2026 at 1:20 AM
Breakfast:
Lunch:
Dinner: shrimp, tuna, hotdogs, pretzels
Snacks: marshmallows
Digestive issue? No
---
May 11, 2026 at 2:14 AM
Breakfast: eggs and toast
Lunch: potato chips
Dinner: apollo burger
Snacks: diet Dr Pepper
Digestive issue? Yes
---
May 12, 2026 at 1:09 AM
Breakfast: yogurt, sandwich
Lunch:
Dinner: chicken, mushroom, zucchini, onion, knorr noodles
Snacks:
Digestive issue? Yes
---
May 13, 2026 at 1:02 AM
Breakfast:
Lunch: sandwich
Dinner: teriyaki salmon, rice, broccoli
Snacks: yogurt. Oreos
Digestive issue? No
---
May 14, 2026 at 1:02 AM
Breakfast:
Lunch: Popeyes chicken and fries
Dinner: chicken fried rice
Snacks: Dr Pepper
Digestive issue? No
---
May 15, 2026 at 12:53 AM
Breakfast:
Lunch: chicken fried rice
Dinner: Thai curry and rice.
Snacks: ice cream
Digestive issue? No
---
May 16, 2026 at 1:14 AM
Breakfast:
Lunch:
Dinner: teriyaki grill
Snacks: Dr Pepper, haribo candy
Digestive issue? No
---
May 17, 2026 at 12:40 AM
Breakfast:
Lunch:
Dinner: taco burrito thing
Snacks: chicken noodle soup
Digestive issue? Yes
---
May 18, 2026 at 12:53 AM
Breakfast:
Lunch: tuna sandwich
Dinner: burger and fries
Snacks: soda.
Digestive issue? Yes
---
May 19, 2026 at 12:09 AM
Breakfast:
Lunch: breakfast cereal
Dinner: Buffalo Wild Wings
Snacks:
Digestive issue? No
---
May 20, 2026 at 12:33 AM
Breakfast:
Lunch:
Dinner: miso cabbage dumpling soup
Snacks:
Digestive issue? No
---
May 21, 2026 at 12:49 AM
Breakfast:
Lunch:
Dinner: chicken thigh tacos
Snacks: cereal cocoa pebbles
Digestive issue? Yes
---
May 22, 2026 at 12:40 AM
Breakfast:
Lunch: leftover wings
Dinner: cheese tortellini with sausage and marinara
Snacks: cereal Cocoa pebbles
Digestive issue? No
---
May 23, 2026 at 12:05 AM
Breakfast: five guys fries
Lunch: Tucanos
Dinner: Nutella sandwiches
Snacks:
Digestive issue? No
---
May 24, 2026 at 1:35 AM
Breakfast:
Lunch:
Dinner: taco soup
Snacks: popsicle
Digestive issue? No
---
May 25, 2026 at 11:43 PM
Breakfast:
Lunch: grilled steak and chips.
Dinner: chicken tacos with slaw
Snacks:
Digestive issue? Yes
---
May 26, 2026 at 12:32 AM
Breakfast:
Lunch: cereal cocoa pebbles.
Dinner: shrimp, zucchini, mushroom, onion shish kebabs.
Snacks: ice cream, gatereade, goldfish.
Digestive issue? Yes
---
May 27, 2026 at 11:58 PM
Breakfast:
Lunch: rice a roni and beef patty
Dinner: in n out,
Snacks: beef jerky and Dr Pepper peeps
Digestive issue? No
---
May 28, 2026 at 1:45 AM
Breakfast:
Lunch: frozen pizza toast and tuna
Dinner: salmon and rice and brussel sprouts
Snacks: pistachios and pretzels
Digestive issue? No
---
May 29, 2026 at 12:41 AM
Breakfast:
Lunch: tuna fish and pretzels and yogurt
Dinner: haku ramen and sushi
Snacks:
Digestive issue? No
---
May 30, 2026 at 12:38 AM
Breakfast:
Lunch: pasta with beef and mushroom
Dinner: grilled chicken, corn, and zucchini
Snacks:
Digestive issue? No
---
May 31, 2026 at 12:11 AM
Breakfast:
Lunch: yogurt and beef jerky
Dinner: chicken and cheese taco
Snacks:
Digestive issue? No
---
Jun 1, 2026 at 12:04 AM
Breakfast:
Lunch: Costco smoothie
Dinner: chicken tacos
Snacks: ice cream
Digestive issue? No
---
Jun 2, 2026 at 11:56 PM
Breakfast:
Lunch: yogurt
Dinner: pasta. Cereal,
Snacks:
Digestive issue? No
---
Jun 3, 2026 at 12:46 AM
Breakfast:
Lunch: hamburger patties and hash browns
Dinner: feast buffet Mongolian grill with shrimp and crab etc
Snacks: ice cream
Digestive issue? Yes
---
Jun 4, 2026 at 1:18 AM
Breakfast:
Lunch:
Dinner: grilled chicken, zucchini, corn
Snacks:
Digestive issue? No
---
Jun 6, 2026 at 11:55 PM
Breakfast:
Lunch: half a hotdog and a smoothie
Dinner: Wendy's
Snacks: random candy snack
Digestive issue? No
---
Jun 7, 2026 at 1:10 AM
Breakfast:
Lunch: hotdogs and melon
Dinner: Mac and cheese
Snacks: yogurt, outshine bars, pistachios string cheese
Digestive issue? No
---
Jun 8, 2026 at 2:36 AM
Breakfast:
Lunch: hotdog
Dinner: shrimp taco
Snacks: honey bunches of oats, milk, freeze dried strawberries
Digestive issue? Yes
---
Jun 9, 2026 at 11:24 PM
Breakfast: yogurt
Lunch: knorr chicken noodles
Dinner: salmon, asparagus, corn
Snacks: granola bar, fruit leather, Nutella go pack
Digestive issue? No
---
Jun 10, 2026 at 12:47 AM
Breakfast:
Lunch: Mac and cheese hotdogs
Dinner: whistle wok
Snacks: pistachios
Digestive issue? No
---
Jun 11, 2026 at 1:24 AM
Breakfast:
Lunch: chef boyardi
Dinner: steak asparagus and corn
Snacks:
Digestive issue? No
---
Jun 12, 2026 at 1:36 AM
Breakfast:
Lunch: breakfast cereal
Dinner: five guys
Snacks: pistachios and a slushy
Digestive issue? No
---
Jun 13, 2026 at 12:50 AM
Breakfast:
Lunch: eggs and toast and tuna
Dinner: Jimmy Jon's
Snacks:
Digestive issue? No
---
Jun 14, 2026 at 12:49 AM
Breakfast:
Lunch: cereal and eggs
Dinner: birria beef and rice and beans.
Snacks: noodles and fruit bars
Digestive issue? No
---
Jun 15, 2026 at 1:43 AM
Breakfast:
Lunch:
Dinner: rotisserie chicken, broccoli, and cherries.
Snacks:
Digestive issue? No
---
Jun 16, 2026 at 12:58 AM
Breakfast: better than sex cake
Lunch:
Dinner: salmon and rice
Snacks: granola bar and cocoa pebbles
Digestive issue? No
---
Jun 17, 2026 at 12:59 AM
Breakfast:
Lunch: steak and eggs
Dinner: Indian chicken curry
Snacks:
Digestive issue? No
---
Jun 18, 2026 at 12:13 AM
Breakfast:
Lunch: sprite, cereal, tuna and pretzels.
Dinner: Steam, asparagus, bakes curly fries
Snacks:
Digestive issue? No
---
Jun 19, 2026 at 1:59 AM
Breakfast:
Lunch: in n out
Dinner: steak tacos
Snacks: slushy, cocoa pebbles
Digestive issue? No
---
Jun 20, 2026 at 1:14 AM
Breakfast:
Lunch: steak
Dinner: burger, tiptip, watermelon, baked beans
Snacks: cereal
Digestive issue? No
---
Jun 21, 2026 at 1:39 AM
Breakfast:
Lunch: Mac n cheese and soy scallion noodles
Dinner: hotdog, watermelon, banana bread
Snacks: tuna fish and pretzels
Digestive issue? No
---
Jun 22, 2026 at 1:46 AM
Breakfast:
Lunch: Mac n cheese, tuna fish and pretzels
Dinner: chubbys mushroom Swiss and scones
Snacks:
Digestive issue? No
---
Jun 23, 2026 at 1:08 AM
Breakfast:
Lunch: yogurt and cereal
Dinner: Jimmy John's
Snacks: eggs
Digestive issue? No
---
Jun 24, 2026 at 11:43 PM
Breakfast:
Lunch: frozen Pizza and hot pocket
Dinner: pasta and cereal
Snacks: outshine bars
Digestive issue? No
---
Jun 26, 2026 at 12:29 AM
Breakfast:
Lunch: beef and bean burritos
Dinner: chicken tacos
Snacks:
Digestive issue? No
---
Jun 27, 2026 at 1:14 AM
Breakfast:
Lunch: waffle
Dinner: curry and chef boyardi
Snacks: eggs, bread, zucchini
Digestive issue? Yes
`;

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const SLOTS: { label: string; hour: number; minute: number }[] = [
  { label: 'Breakfast', hour: 8, minute: 0 },
  { label: 'Lunch', hour: 12, minute: 30 },
  { label: 'Dinner', hour: 18, minute: 30 },
  { label: 'Snacks', hour: 15, minute: 0 },
];

const EPISODE_HOUR = 20;
const EPISODE_MINUTE = 30;
const EPISODE_SEVERITY = 2;

interface Journal {
  at: number;
  meals: { label: string; description: string }[];
  issue: boolean;
}

function parseTimestamp(line: string): number {
  const match = line.match(/^(\w{3}) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2}) (AM|PM)$/);
  if (!match) throw new Error(`unreadable date line: "${line}"`);
  const [, mon, day, year, hh, mm, ap] = match;
  const month = MONTHS[mon];
  if (month === undefined) throw new Error(`unknown month: "${mon}"`);
  let hour = Number(hh) % 12;
  if (ap === 'PM') hour += 12;
  return new Date(Number(year), month, Number(day), hour, Number(mm)).getTime();
}

function normalizeIngredients(text: string): string {
  return text
    .split(/[,.]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ');
}

function parseNote(raw: string): Journal[] {
  const blocks = raw
    .trim()
    .split(/\n\s*[-—]{2,}\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const dateLine = lines.find((line) => /at \d{1,2}:\d{2} (AM|PM)$/.test(line));
    if (!dateLine) throw new Error(`no date line in block:\n${block}`);
    const at = parseTimestamp(dateLine);

    function field(label: string): string {
      const line = lines.find((candidate) =>
        candidate.toLowerCase().startsWith(`${label.toLowerCase()}:`),
      );
      return line ? line.slice(line.indexOf(':') + 1).trim() : '';
    }

    const issueLine = lines.find((line) => line.toLowerCase().startsWith('digestive issue'));
    const issue = issueLine ? /yes/i.test(issueLine) : false;

    const meals = SLOTS.map((slot) => ({ label: slot.label, description: field(slot.label) }))
      .filter((meal) => meal.description.length > 0)
      .map((meal) => ({ label: meal.label, description: normalizeIngredients(meal.description) }));

    return { at, meals, issue };
  });
}

function atOnDay(dayKey: string, hour: number, minute: number): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).getTime();
}

function mealFileCount(userId: string): number {
  return listDataFiles(path.join('users', userId, 'calories')).filter((name) =>
    name.endsWith('.json'),
  ).length;
}

function listCandidates(users: AuthUser[]): void {
  for (const user of users) {
    const months = mealFileCount(user.id);
    console.error(
      `  ${user.id}${user.owner ? '  (owner)' : ''}  — ${months} month${months === 1 ? '' : 's'} of existing meal data`,
    );
  }
}

function resolveTarget(users: AuthUser[]): AuthUser | null {
  const flagIndex = process.argv.indexOf('--user');
  const requestedId = flagIndex !== -1 ? process.argv[flagIndex + 1] : undefined;

  if (requestedId) {
    const match = users.find((user) => user.id === requestedId);
    if (!match) {
      console.error(`No user with id "${requestedId}". Known users:`);
      listCandidates(users);
    }
    return match ?? null;
  }

  if (users.length === 1) return users[0];

  console.error(
    'More than one user on this box, and a user id is an opaque UUID with no name attached ' +
      "(this dashboard is PINs, not accounts) — this journal is one person's, not the " +
      "household's, so re-run with --user <id>. Existing calorie history is the only real clue " +
      'to which id is which person:',
  );
  listCandidates(users);
  return null;
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const journals = parseNote(RAW);

  const users = listUsers();
  if (users.length === 0) {
    console.error('No users found — set up a PIN before seeding.');
    process.exitCode = 1;
    return;
  }

  const target = resolveTarget(users);
  if (!target) {
    process.exitCode = 1;
    return;
  }

  let mealCount = 0;
  let episodeCount = 0;

  runAs(target, () => {
    for (const journal of journals) {
      const day = dayKeyFromMs(journal.at);
      const slotByLabel = new Map(SLOTS.map((slot) => [slot.label, slot]));

      for (const meal of journal.meals) {
        const slot = slotByLabel.get(meal.label);
        if (!slot) continue;
        const at = atOnDay(day, slot.hour, slot.minute);
        mealCount += 1;
        if (dryRun) {
          console.log(
            `[meal]    ${day} ${slot.hour}:${String(slot.minute).padStart(2, '0')}  ${meal.description}`,
          );
        } else {
          addEntry({ at, description: meal.description, values: {} });
        }
      }

      if (journal.issue) {
        episodeCount += 1;
        if (dryRun) {
          console.log(
            `[episode] ${day} ${EPISODE_HOUR}:${EPISODE_MINUTE}  severity ${EPISODE_SEVERITY}`,
          );
        } else {
          addEpisode(EPISODE_SEVERITY, atOnDay(day, EPISODE_HOUR, EPISODE_MINUTE));
        }
      }
    }
  });

  console.log(
    `${dryRun ? '[dry run] would add' : 'Added'} ${mealCount} meals and ${episodeCount} episodes across ${journals.length} days for user ${target.id}.`,
  );
}

main();
