// Single source for names that appear in the UI. Before this existed the venue
// name was spelled two different ways across three pages ("Whispering Rain
// Cafe" on the tip form, "Whispering Café" on the alert overlay and dashboard).
//
// BRAND_NAME below picks the tip form's spelling because that is the one payers
// actually see. Change it here and every surface follows.
export const BRAND_NAME = "Whispering Rain Cafe";

// The streamer, as referred to in payer-facing copy. Kept separate from the
// venue name — lib/i18n.ts also spells this inline in full sentences, where it
// has to inflect with the surrounding Thai, so those stay hand-written.
export const STREAMER_NAME = "Naire";
