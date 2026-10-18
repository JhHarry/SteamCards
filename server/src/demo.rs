//! 演示模式：不联网也能看进度条与界面效果。
use crate::steam::Card;

pub struct DemoCard {
    pub card: Card,
    pub kind: &'static str, // "ok" | "no_listing" | "not_marketable"
    pub price: f64,
    pub volume: i64,
    pub cached: bool,
}

const GAMES: &[(&str, u32)] = &[
    ("Counter-Strike 2", 730),
    ("Dota 2", 570),
    ("Team Fortress 2", 440),
    ("PUBG: BATTLEGROUNDS", 578080),
    ("Apex Legends", 1172470),
    ("Rust", 252490),
    ("Warframe", 230410),
    ("Path of Exile", 238960),
    ("Terraria", 105600),
    ("Stardew Valley", 413150),
    ("Hollow Knight", 367520),
    ("Slay the Spire", 646570),
    ("Dead by Daylight", 381210),
    ("Rocket League", 252950),
    ("Tom Clancy's Rainbow Six Siege", 359550),
    ("Grand Theft Auto V", 271590),
    ("The Witcher 3: Wild Hunt", 292030),
    ("No Man's Sky", 275850),
    ("Among Us", 945360),
    ("Hades", 1145360),
    ("Celeste", 504230),
    ("Undertale", 391540),
    ("Euro Truck Simulator 2", 227300),
    ("Cities: Skylines", 255710),
    ("Factorio", 427520),
    ("RimWorld", 294100),
    ("Subnautica", 264710),
    ("Valheim", 892970),
    ("VRChat", 438100),
    ("Phasmophobia", 739630),
    ("Deep Rock Galactic", 548430),
    ("Sea of Thieves", 1172620),
    ("It Takes Two", 1426210),
    ("Cyberpunk 2077", 1091500),
    ("Elden Ring", 1245620),
    ("Baldur's Gate 3", 1086940),
    ("Palworld", 1623730),
];

const CARD_NAMES: &[&str] = &[
    "Voltaic", "Wildlife", "Guardian", "Ranger", "Nomad", "Ember", "Frost", "Beast", "Pilot",
    "Cipher", "Drifter", "Harbor",
];

struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0
    }
    fn f64(&mut self, lo: f64, hi: f64) -> f64 {
        let unit = (self.next() >> 11) as f64 / (1u64 << 53) as f64;
        lo + unit * (hi - lo)
    }
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        if hi <= lo {
            return lo;
        }
        lo + (self.next() % ((hi - lo + 1) as u64)) as i64
    }
}

const DEMO_COUNT: usize = 240;

pub fn generate(limit: i64) -> Vec<DemoCard> {
    let mut rnd = Lcg(0x5EED_2026_1018);
    let mut cards = Vec::with_capacity(DEMO_COUNT);
    for i in 0..DEMO_COUNT {
        let (game_name, appid) = GAMES[i % GAMES.len()];
        let base = CARD_NAMES[i % CARD_NAMES.len()];
        let card_no = i / CARD_NAMES.len() + 1;
        let foil = i % 41 == 0;
        let marketable = i % 17 != 3;
        let tradable = i % 23 != 5;
        let count = (i % 3) as i64 + 1;
        let hash = if foil {
            format!("{}-{}{}-Foil", appid, base, card_no)
        } else {
            format!("{}-{}{}", appid, base, card_no)
        };
        let kind = if !marketable {
            "not_marketable"
        } else if i % 13 == 7 {
            "no_listing"
        } else {
            "ok"
        };
        cards.push(DemoCard {
            card: Card {
                hash: hash.clone(),
                name: format!("{}{}（{}）", base, card_no, game_name),
                game: game_name.to_string(),
                appid: appid.to_string(),
                foil,
                count,
                marketable,
                tradable,
            },
            kind,
            price: (rnd.f64(0.30, 28.0) * 100.0).round() / 100.0,
            volume: rnd.range(0, 8000),
            cached: i % 5 == 0,
        });
    }
    if limit > 0 && (limit as usize) < cards.len() {
        cards.truncate(limit as usize);
    }
    cards
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_generation() {
        let cards = generate(0);
        assert_eq!(cards.len(), 240);
        assert!(cards.iter().any(|c| c.kind == "not_marketable"));
        assert!(cards.iter().any(|c| c.kind == "no_listing"));
        assert!(cards.iter().all(|c| !c.card.hash.is_empty()));
        let limited = generate(10);
        assert_eq!(limited.len(), 10);
    }
}
