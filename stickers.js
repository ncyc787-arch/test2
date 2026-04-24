// ═══════════════════════════════════════════
// STICKERS — каталог стикеров для iMessage
// ═══════════════════════════════════════════

const EXT_PATH = 'scripts/extensions/third-party/test2/stickers';

export const STICKER_PACKS = {
    ANIME: {
        label: '🌸 Anime',
        stickers: [
            { file: 'ANIME/animated_character_punching_multiple_times.jpg', tags: ['angry', 'punch', 'rage'] },
            { file: 'ANIME/anime_character_kissing_cheek.jpg', tags: ['love', 'kiss', 'affection'] },
            { file: 'ANIME/anime_character_waving_hand.webp', tags: ['greeting', 'hi', 'wave', 'hello'] },
            { file: 'ANIME/anime_character_with_hearts.webp', tags: ['love', 'hearts', 'happy', 'crush'] },
            { file: 'ANIME/anime_character_yelling_fists.jpg', tags: ['angry', 'yelling', 'frustrated'] },
            { file: 'ANIME/anime_girl_laying_grass.jpg', tags: ['relaxed', 'chill', 'dreamy', 'bored'] },
            { file: 'ANIME/anime_person_crying.jpg', tags: ['sad', 'crying', 'upset'] },
            { file: 'ANIME/blinking_girl_writing.gif', tags: ['writing', 'busy', 'working', 'typing'] },
            { file: 'ANIME/blushing_character_hiding_face.webp', tags: ['shy', 'blushing', 'embarrassed'] },
            { file: 'ANIME/bored_person_tapping_fingers.jpg', tags: ['bored', 'waiting', 'impatient'] },
            { file: 'ANIME/cute_chibi_character_shy.webp', tags: ['shy', 'cute', 'nervous'] },
            { file: 'ANIME/girl_holding_flower.jpg', tags: ['cute', 'sweet', 'flower', 'gift'] },
            { file: 'ANIME/girl_peeking_behind_tree.jpg', tags: ['shy', 'peeking', 'curious', 'hiding'] },
            { file: 'ANIME/happy_girl_holding_clover.webp', tags: ['happy', 'lucky', 'cheerful'] },
            { file: 'ANIME/hiding_face_under_hair.webp', tags: ['shy', 'embarrassed', 'hiding'] },
            { file: 'ANIME/holding_phone_with_five.webp', tags: ['phone', 'texting', 'hi', 'five'] },
            { file: 'ANIME/hugging_cute_characters.jpg', tags: ['hug', 'love', 'friendship', 'cute'] },
            { file: 'ANIME/pouting_character_angry.jpg', tags: ['angry', 'pouting', 'annoyed', 'offended'] },
            { file: 'ANIME/sad_anime_character.webp', tags: ['sad', 'depressed', 'lonely'] },
            { file: 'ANIME/sad_character_hugging_knees.webp', tags: ['sad', 'lonely', 'depressed', 'upset'] },
            { file: 'ANIME/shy_character_sweating.webp', tags: ['nervous', 'sweating', 'anxious', 'shy'] },
            { file: 'ANIME/shy_girl_hiding_face.jpg', tags: ['shy', 'hiding', 'embarrassed', 'cute'] },
            { file: 'ANIME/shy_girl_holding_heart.webp', tags: ['love', 'shy', 'heart', 'crush'] },
            { file: 'ANIME/sitting_sad_character.jpg', tags: ['sad', 'sitting', 'lonely', 'thinking'] },
            { file: 'ANIME/two_characters_hugging.webp', tags: ['hug', 'love', 'together', 'comfort'] },
        ],
    },
    BUNNY: {
        label: '🐰 Bunny',
        stickers: [
            { file: 'BUNNY/bird_bouncing_on_guinea_pig.gif', tags: ['funny', 'playful', 'random', 'cute'] },
            { file: 'BUNNY/cat_hugging_question_mark.gif', tags: ['confused', 'question', 'hug', 'what'] },
            { file: 'BUNNY/crying_bunny_digging.gif', tags: ['sad', 'crying', 'upset', 'dramatic'] },
            { file: 'BUNNY/dog_shopping_cart.gif', tags: ['shopping', 'funny', 'excited', 'happy'] },
            { file: 'BUNNY/hamster_dancing_happily.gif', tags: ['happy', 'dancing', 'excited', 'celebration'] },
            { file: 'BUNNY/hamster_drinking_tea.gif', tags: ['chill', 'relaxed', 'tea', 'cozy', 'waiting'] },
            { file: 'BUNNY/rabbit_typing_on_laptop.gif', tags: ['typing', 'working', 'busy', 'writing'] },
            { file: 'BUNNY/two_bunnies_high_fiving.gif', tags: ['friendship', 'high five', 'happy', 'teamwork'] },
        ],
    },
    BUNNY_KITTY: {
        label: '🐰🐱 Duo',
        stickers: [
            { file: 'BUNNY_KITTY/bunny_and_cat_standing.webp', tags: ['together', 'friendship', 'cute'] },
            { file: 'BUNNY_KITTY/bunny_and_kitten_waving_paws.jpg', tags: ['greeting', 'hi', 'wave', 'cute'] },
            { file: 'BUNNY_KITTY/bunny_hugging_dog.gif', tags: ['hug', 'love', 'comfort', 'friendship'] },
            { file: 'BUNNY_KITTY/cat_and_rabbit_celebrating.jpg', tags: ['celebration', 'happy', 'party', 'yay'] },
            { file: 'BUNNY_KITTY/cat_hugging_bunny.webp', tags: ['hug', 'love', 'comfort', 'cute'] },
            { file: 'BUNNY_KITTY/cat_on_rabbit.jpg', tags: ['funny', 'cute', 'playful', 'silly'] },
            { file: 'BUNNY_KITTY/cat_sitting_on_rabbit.webp', tags: ['funny', 'dominance', 'silly', 'cute'] },
            { file: 'BUNNY_KITTY/rabbit_and_cat_crying.webp', tags: ['sad', 'crying', 'emotional', 'together'] },
            { file: 'BUNNY_KITTY/two_cats_praying.webp', tags: ['please', 'begging', 'praying', 'hope'] },
        ],
    },
    KITTY: {
        label: '🐱 Kitty',
        stickers: [
            { file: 'KITTY/angry_cat_using_laptop.jpg', tags: ['angry', 'working', 'frustrated', 'typing'] },
            { file: 'KITTY/blurry_cat_face.jpg', tags: ['confused', 'derp', 'funny', 'random'] },
            { file: 'KITTY/cat_and_bear_sleeping.jpg', tags: ['sleepy', 'tired', 'cozy', 'goodnight'] },
            { file: 'KITTY/cat_dancing_spinning_circles.gif', tags: ['happy', 'dancing', 'excited', 'crazy'] },
            { file: 'KITTY/cat_drinking_peach_milk.jpg', tags: ['chill', 'relaxed', 'cute', 'cozy'] },
            { file: 'KITTY/cat_holding_shopping_bags.webp', tags: ['shopping', 'happy', 'excited', 'rich'] },
            { file: 'KITTY/cat_hugging_arm.gif', tags: ['love', 'clingy', 'hug', 'affection', 'miss you'] },
            { file: 'KITTY/cat_in_blanket_cocoon.jpg', tags: ['cozy', 'hiding', 'tired', 'comfortable'] },
            { file: 'KITTY/cat_in_fluffy_boots.gif', tags: ['cute', 'funny', 'fashion', 'adorable'] },
            { file: 'KITTY/cat_in_hoodie_smiling.webp', tags: ['happy', 'cozy', 'cute', 'chill'] },
            { file: 'KITTY/cat_looking_outside_window.gif', tags: ['sad', 'lonely', 'thinking', 'waiting', 'miss you'] },
            { file: 'KITTY/cat_making_funny_face.jpg', tags: ['funny', 'derp', 'silly', 'random'] },
            { file: 'KITTY/cat_sleeping_with_fish_blanket.jpg', tags: ['sleepy', 'goodnight', 'tired', 'cute'] },
            { file: 'KITTY/cat_tails_forming_heart.jpg', tags: ['love', 'heart', 'romantic', 'together'] },
            { file: 'KITTY/cat_wearing_blue_hat.jpg', tags: ['cute', 'fashion', 'happy', 'silly'] },
            { file: 'KITTY/cat_wearing_sunglasses_dancing.gif', tags: ['cool', 'dancing', 'party', 'swag'] },
            { file: 'KITTY/cat_widening_eyes.gif', tags: ['shocked', 'surprised', 'wow', 'omg'] },
            { file: 'KITTY/cat_with_fake_hands.gif', tags: ['funny', 'weird', 'random', 'silly'] },
            { file: 'KITTY/crying_dog_being_petted.jpg', tags: ['sad', 'crying', 'comfort', 'emotional'] },
            { file: 'KITTY/cute_animals_with_heart.jpg', tags: ['love', 'heart', 'cute', 'sweet'] },
            { file: 'KITTY/cute_cartoon_cat_face.jpg', tags: ['cute', 'happy', 'sweet', 'innocent'] },
            { file: 'KITTY/cute_cat_lying_down.jpg', tags: ['relaxed', 'chill', 'lazy', 'tired'] },
            { file: 'KITTY/cute_cat_peeking_over.webp', tags: ['curious', 'peeking', 'shy', 'cute'] },
            { file: 'KITTY/cute_cat_with_big_eyes.jpg', tags: ['begging', 'please', 'cute', 'innocent'] },
            { file: 'KITTY/cute_cat_with_hearts.jpg', tags: ['love', 'hearts', 'happy', 'affection'] },
            { file: 'KITTY/cute_cat_with_sparkles.jpg', tags: ['happy', 'sparkle', 'excited', 'cute'] },
            { file: 'KITTY/cute_kitten_licking_paw.jpg', tags: ['cute', 'grooming', 'relaxed', 'chill'] },
            { file: 'KITTY/cute_kitten_looking_up.jpg', tags: ['curious', 'cute', 'innocent', 'begging'] },
            { file: 'KITTY/cute_kitten_on_bed.gif', tags: ['cute', 'playful', 'cozy', 'happy'] },
            { file: 'KITTY/cute_kitten_on_floor.jpg', tags: ['cute', 'lazy', 'relaxed', 'tiny'] },
            { file: 'KITTY/dog_and_cat_dancing.gif', tags: ['dancing', 'happy', 'party', 'celebration'] },
            { file: 'KITTY/dog_sitting_laptop.jpg', tags: ['working', 'busy', 'typing', 'professional'] },
            { file: 'KITTY/fluffy_cat_yawning.jpg', tags: ['tired', 'sleepy', 'yawn', 'bored'] },
            { file: 'KITTY/grumpy_fluffy_cat.jpg', tags: ['grumpy', 'angry', 'annoyed', 'moody'] },
            { file: 'KITTY/kitten_clapping_paws.gif', tags: ['happy', 'clapping', 'excited', 'bravo'] },
            { file: 'KITTY/kitten_CRYBABY_looking_forward.jpg', tags: ['sad', 'crying', 'baby', 'emotional'] },
            { file: 'KITTY/kitten_with_paws_up.jpg', tags: ['surprise', 'hands up', 'cute', 'surrender'] },
            { file: 'KITTY/offended_cat_holding_gun_sign.jpg', tags: ['offended', 'angry', 'threat', 'funny'] },
            { file: 'KITTY/sleepy_kitten_paws_twitching.gif', tags: ['sleepy', 'dreaming', 'cute', 'goodnight'] },
        ],
    },
    MEME: {
        label: '😂 Meme',
        stickers: [
            { file: 'MEME/cat_slaps_another_cat_on_the_bottom.gif', tags: ['funny', 'slap', 'playful', 'flirty'] },
            { file: 'MEME/confused_emoji_with_camera.jpg', tags: ['confused', 'what', 'camera', 'question'] },
            { file: 'MEME/confused_face_emoji.jpg', tags: ['confused', 'what', 'huh', 'thinking'] },
            { file: 'MEME/dog_giving_thumb_up.jpg', tags: ['ok', 'thumbs up', 'approve', 'good'] },
            { file: 'MEME/dog_in_tattered_clothes.jpg', tags: ['tired', 'exhausted', 'poor', 'sad'] },
            { file: 'MEME/dog_leaning_on_ball.jpg', tags: ['bored', 'waiting', 'chill', 'sad'] },
            { file: 'MEME/dog_sitting_with_bowl.jpg', tags: ['hungry', 'waiting', 'begging', 'please'] },
            { file: 'MEME/duck_pointing_inward_fingers.jpg', tags: ['shy', 'nervous', 'uwu', 'asking'] },
            { file: 'MEME/open_hands_offering_help_text_your_titties_look_heave_let_me_give_you_a_hand.jpg', tags: ['help', 'offering', 'flirty', 'funny'] },
            { file: 'MEME/rabbit_adjusting_tie.jpg', tags: ['professional', 'cool', 'confident', 'ready'] },
            { file: 'MEME/sad_pleading_face_star.jpg', tags: ['please', 'begging', 'sad', 'puppy eyes'] },
            { file: 'MEME/sly_emoji_rubbing_hands.jpg', tags: ['sly', 'scheming', 'evil', 'hehe'] },
            { file: 'MEME/smiley_face_waving_hand_text_we\'re_fucked.gif', tags: ['funny', 'panic', 'doom', 'wave'] },
            { file: 'MEME/smiling_cartoon_cat_face.jpg', tags: ['happy', 'smiling', 'pleased', 'cute'] },
            { file: 'MEME/sweating_anxious_face.jpg', tags: ['nervous', 'anxious', 'sweating', 'worried'] },
            { file: 'MEME/tired_person_using_computer.jpg', tags: ['tired', 'working', 'exhausted', 'late'] },
            { file: 'MEME/tired_pink_character_in_suit.jpg', tags: ['tired', 'exhausted', 'work', 'done'] },
            { file: 'MEME/tony_stark_with_text_overlay_man_boobs.jpg', tags: ['funny', 'meme', 'random', 'joke'] },
        ],
    },
    PINGUIN: {
        label: '🐧 Pinguin',
        stickers: [
            { file: 'PINGUIN/cute_penguin_standing.webp', tags: ['cute', 'standing', 'hello', 'innocent'] },
            { file: 'PINGUIN/penguin_dabbing_cutely.webp', tags: ['dab', 'cool', 'funny', 'swag'] },
            { file: 'PINGUIN/penguin_holding_ok_sign.webp', tags: ['ok', 'approve', 'good', 'agree'] },
            { file: 'PINGUIN/penguin_saying_ok.jpg', tags: ['ok', 'agree', 'sure', 'fine'] },
            { file: 'PINGUIN/penguin_throwing_snowball.webp', tags: ['playful', 'fun', 'snowball', 'attack'] },
            { file: 'PINGUIN/penguin_waving_hand.webp', tags: ['greeting', 'hi', 'wave', 'bye'] },
            { file: 'PINGUIN/penguin_with_bubbles.jpg', tags: ['cute', 'happy', 'bubbles', 'playful'] },
            { file: 'PINGUIN/penguins_hugging_affectionately.webp', tags: ['hug', 'love', 'together', 'affection'] },
            { file: 'PINGUIN/tired.webp', tags: ['tired', 'sleepy', 'exhausted', 'done'] },
        ],
    },
    SANRIO: {
        label: '🎀 Sanrio',
        stickers: [
            { file: 'SANRIO/angry_bunny_with_pink_bow.webp', tags: ['angry', 'mad', 'pouting', 'offended'] },
            { file: 'SANRIO/crying_cartoon_rabbit.webp', tags: ['sad', 'crying', 'upset', 'emotional'] },
            { file: 'SANRIO/cute_sheep_with_bow_shy_beg.webp', tags: ['shy', 'begging', 'please', 'cute'] },
        ],
    },
};

// ── Плоский массив с id ──
let _allStickers = null;
export function getAllStickers() {
    if (_allStickers) return _allStickers;
    _allStickers = [];
    let idx = 0;
    for (const [pack, data] of Object.entries(STICKER_PACKS)) {
        for (const s of data.stickers) {
            _allStickers.push({ id: `s${idx}`, pack, ...s });
            idx++;
        }
    }
    return _allStickers;
}

// ── URL стикера ──
export function stickerUrl(file) {
    return `/` + EXT_PATH + '/' + file;
}

// ── Найти стикер по id ──
export function findStickerById(id) {
    return getAllStickers().find(s => s.id === id) || null;
}

// ── Компактный каталог для промпта ИИ ──
// Формат: "s0: anime punching (angry/rage) | s1: anime kiss cheek (love/kiss) | ..."
export function stickerCatalogForPrompt() {
    const all = getAllStickers();
    return all.map(s => {
        // Краткое описание из имени файла
        const name = s.file.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        const tags = s.tags.slice(0, 3).join('/');
        return `${s.id}: ${name} (${tags})`;
    }).join('\n');
}

// ── Порядок паков для табов ──
export function getPackOrder() {
    return Object.keys(STICKER_PACKS);
}
