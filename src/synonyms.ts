// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Synonym / Alternative Suggestion Engine
// Given a word, suggests comparable alternatives grouped by category
// ═══════════════════════════════════════════════════════════════════

// ── Semantic clusters: words grouped by meaning/context ──
// Each cluster is a set of interchangeable alternatives

const CLUSTERS: Record<string, string[]> = {
  // ── Time / Duration ──
  long:       ["long", "short", "tiresome", "exhausting", "endless", "quick", "slow", "rough", "busy", "crazy"],
  short:      ["short", "long", "brief", "quick", "fast"],
  early:      ["early", "late", "on time", "delayed", "punctual"],

  // ── Feelings / States ──
  tired:      ["tired", "exhausted", "drained", "wiped out", "sleepy", "energized", "refreshed"],
  happy:      ["happy", "excited", "thrilled", "grateful", "content", "ecstatic", "overjoyed"],
  sad:        ["sad", "down", "bummed", "heartbroken", "upset", "disappointed"],
  nervous:    ["nervous", "anxious", "excited", "worried", "tense", "calm"],
  hungry:     ["hungry", "starving", "famished", "craving something", "peckish"],
  good:       ["good", "great", "amazing", "wonderful", "fantastic", "excellent", "decent"],
  bad:        ["bad", "terrible", "awful", "rough", "tough", "difficult"],
  nice:       ["nice", "lovely", "pleasant", "delightful", "charming", "gorgeous"],
  beautiful:  ["beautiful", "stunning", "gorgeous", "pretty", "lovely", "elegant"],
  weird:      ["weird", "strange", "unusual", "odd", "bizarre", "interesting"],
  boring:     ["boring", "dull", "tedious", "monotonous", "uninteresting"],

  // ── Drinks ──
  beer:       ["beer", "wine", "cocktail", "whiskey", "martini", "margarita", "negroni", "mojito", "sangria", "champagne", "prosecco", "sake"],
  wine:       ["wine", "beer", "champagne", "prosecco", "cocktail", "rosé", "port", "sherry"],
  coffee:     ["coffee", "espresso", "latte", "cappuccino", "americano", "tea", "matcha"],
  water:      ["water", "sparkling water", "juice", "lemonade", "soda", "tonic"],
  juice:      ["juice", "smoothie", "lemonade", "milkshake", "soda", "water"],

  // ── Food ──
  pizza:      ["pizza", "pasta", "burger", "sushi", "tacos", "ramen", "steak", "salad"],
  pasta:      ["pasta", "risotto", "gnocchi", "lasagna", "pizza", "ravioli"],
  steak:      ["steak", "lamb", "chicken", "fish", "lobster", "ribs", "pork chop"],
  sushi:      ["sushi", "sashimi", "ramen", "tempura", "udon", "poke bowl"],
  breakfast:  ["breakfast", "brunch", "lunch", "dinner", "supper", "snack"],
  dinner:     ["dinner", "supper", "lunch", "brunch", "meal"],
  food:       ["food", "meal", "dish", "cuisine", "snack"],
  dessert:    ["dessert", "cake", "ice cream", "tiramisu", "chocolate", "pie", "gelato", "cheesecake"],

  // ── Places ──
  restaurant: ["restaurant", "café", "bistro", "diner", "bar", "lounge", "pub", "trattoria"],
  bar:        ["bar", "pub", "lounge", "club", "speakeasy", "tavern", "rooftop bar"],
  hotel:      ["hotel", "resort", "hostel", "airbnb", "inn", "villa"],
  park:       ["park", "garden", "plaza", "beach", "waterfront", "rooftop"],
  home:       ["home", "apartment", "place", "house", "flat"],
  office:     ["office", "workspace", "studio", "coworking space"],
  city:       ["city", "town", "village", "neighborhood", "district"],

  // ── People ──
  friend:     ["friend", "buddy", "pal", "colleague", "partner", "date", "companion"],
  family:     ["family", "parents", "kids", "siblings", "relatives"],

  // ── Actions ──
  eat:        ["eat", "grab", "try", "taste", "order", "have", "share"],
  drink:      ["drink", "sip", "try", "order", "grab", "have"],
  go:         ["go", "head", "drive", "walk", "travel", "fly", "run"],
  meet:       ["meet", "see", "visit", "catch up with", "join"],
  love:       ["love", "adore", "enjoy", "like", "appreciate", "prefer"],
  need:       ["need", "want", "crave", "deserve", "could use", "would love"],
  know:       ["know", "understand", "remember", "think", "believe", "feel"],

  // ── Weather / Setting ──
  hot:        ["hot", "warm", "scorching", "humid", "tropical", "boiling"],
  cold:       ["cold", "freezing", "chilly", "cool", "frosty", "icy"],
  rainy:      ["rainy", "stormy", "cloudy", "foggy", "misty", "drizzly"],
  sunny:      ["sunny", "bright", "clear", "beautiful", "perfect"],

  // ── Size / Amount ──
  big:        ["big", "huge", "enormous", "massive", "large", "giant"],
  small:      ["small", "tiny", "little", "mini", "compact"],
  many:       ["many", "several", "a few", "lots of", "a ton of", "a bunch of"],

  // ── Day ──
  day:        ["day", "morning", "afternoon", "evening", "night", "weekend", "week"],
  tonight:    ["tonight", "today", "tomorrow", "this weekend", "later", "now"],
  yesterday:  ["yesterday", "last night", "this morning", "earlier", "recently"],
};

// Skip these common words — they're structural, not swappable
const SKIP_WORDS = new Set([
  "i", "me", "my", "you", "your", "we", "our", "they", "them", "their",
  "he", "she", "it", "its", "his", "her",
  "a", "an", "the", "this", "that", "these", "those",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "don't", "doesn't", "didn't",
  "has", "have", "had", "hasn't", "haven't",
  "will", "would", "could", "should", "can", "may", "might",
  "not", "no", "yes", "so", "if", "but", "and", "or", "to",
  "of", "in", "on", "at", "for", "with", "by", "from", "up",
  "about", "into", "through", "after", "before", "between",
  "out", "off", "over", "under", "again", "further", "then",
  "than", "too", "very", "just", "also", "here", "there",
  "it's", "i'm", "i've", "we're", "they're", "you're",
  "that's", "what's", "there's", "here's", "let's",
  "been", "some", "all", "any", "each", "every",
]);

/** Check if a word is interesting enough to be a slot candidate */
export function isSwappableWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  if (w.length < 2) return false;
  if (SKIP_WORDS.has(w)) return false;
  return true;
}

/** Get synonym suggestions for a word */
export function getSuggestions(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");

  // Direct cluster match
  if (CLUSTERS[w]) {
    return CLUSTERS[w].filter(s => s.toLowerCase() !== w);
  }

  // Search all clusters for the word
  for (const [_key, cluster] of Object.entries(CLUSTERS)) {
    if (cluster.some(s => s.toLowerCase() === w)) {
      return cluster.filter(s => s.toLowerCase() !== w);
    }
  }

  // No match — return empty (user can still add custom options)
  return [];
}

/** Tokenize a phrase into words, preserving original casing and punctuation info */
export interface PhraseToken {
  word: string;        // the raw word (with casing)
  clean: string;       // lowercase letters only
  index: number;       // position in token array
  isSwappable: boolean;
  trailing: string;    // trailing punctuation (period, comma, etc.)
}

export function tokenizePhrase(phrase: string): PhraseToken[] {
  // Split on whitespace, preserving punctuation attached to words
  const parts = phrase.split(/\s+/).filter(Boolean);
  return parts.map((raw, index) => {
    const trailing = raw.match(/[.,!?;:]+$/)?.[0] ?? "";
    const word = trailing ? raw.slice(0, -trailing.length) : raw;
    const clean = word.toLowerCase().replace(/[^a-z']/g, "");
    return {
      word,
      clean,
      index,
      isSwappable: isSwappableWord(word),
      trailing,
    };
  });
}
