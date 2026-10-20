# The campaign's first act: missions 1–3 (main tab, section 8), written as content.
#
# Each mission: who starts where, the host cells, the exit gates, objectives, and triggers
# (conditions → actions). Times are written in seconds and converted to ticks (20 a second).
# Every placement is checked against the mission map's walls before anything is written.
#
# usage: python3 tools/maps/make_missions.py

import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
S = 20  # ticks per second
MIN = 60 * S
ENEMY = 2
ME = 1


def load_map(mid):
    with open(os.path.join(ROOT, 'content', 'maps', mid + '.json')) as f:
        return json.load(f)


FOOT = {
    'bld_wl_lymphnode': (4, 4), 'bld_wl_capillary': (2, 2), 'bld_wl_marrow': (3, 3), 'bld_wl_spleen': (3, 3),
    'bld_col_biofilm_core': (4, 4), 'bld_col_fission': (3, 3), 'bld_col_fermentation': (3, 2), 'bld_col_flagellum': (3, 3),
    'bld_wl_mastcell': (2, 2),
}


def check(mid, m, mission):
    rows = m['rows']
    taken = set()
    for r in m['resources']:
        n = 2 if r['type'] != 'res_glucose_small' else 1
        for y in range(r['tile'][1], r['tile'][1] + n):
            for x in range(r['tile'][0], r['tile'][0] + n):
                taken.add((x, y))

    def free(x, y, what):
        assert 0 <= x < m['w'] and 0 <= y < m['h'], f'{mid}: {what} outside the map at {x},{y}'
        assert rows[y][x] == '.', f'{mid}: {what} on {rows[y][x]!r} at {x},{y}'
        assert (x, y) not in taken, f'{mid}: {what} overlaps something at {x},{y}'

    for p in mission['place']:
        fw, fh = FOOT.get(p['type'], (1, 1))
        if p['type'] in FOOT:
            for y in range(p['at'][1], p['at'][1] + fh):
                for x in range(p['at'][0], p['at'][0] + fw):
                    free(x, y, p['type'])
                    taken.add((x, y))
            # a production building's exit below its middle must be open
            ex, ey = p['at'][0] + fw // 2, p['at'][1] + fh
            assert rows[ey][ex] == '.', f"{mid}: {p['type']} exit blocked at {ex},{ey}"
        else:
            assert rows[p['at'][1]][p['at'][0]] != '#', f"{mid}: {p['type']} on a wall at {p['at']}"
    # host cells: each to the nearest open tile with a tile of room around it (they stand in the way)
    def roomy(x, y):
        if not (1 <= x < m['w'] - 1 and 1 <= y < m['h'] - 1):
            return False
        return all(rows[yy][xx] == '.' and (xx, yy) not in taken for yy in range(y - 1, y + 2) for xx in range(x - 1, x + 2))
    placed = []
    for x, y in mission['host']['cells']:
        spot = None
        for r in range(0, 5):
            ring = [(x + dx, y + dy) for dy in range(-r, r + 1) for dx in range(-r, r + 1) if max(abs(dx), abs(dy)) == r]
            ok = [p for p in ring if roomy(*p)]
            if ok:
                spot = ok[0]
                break
        assert spot, f'{mid}: no room for a host cell near {x},{y}'
        placed.append(list(spot))
        for yy in range(spot[1] - 1, spot[1] + 2):
            for xx in range(spot[0] - 1, spot[0] + 2):
                taken.add((xx, yy))
    mission['host']['cells'] = placed
    for g in mission['gates']:
        x, y = g['at']
        assert rows[y][x] == '.', f'{mid}: gate on a wall at {x},{y}'
    for t in mission['triggers']:
        for a in t['do']:
            if a['a'] == 'spawn' and a['at'] != 'gates':
                x, y = a['at']
                assert rows[y][x] != '#', f"{mid}: trigger {t['id']} spawns on a wall at {x},{y}"


def say(speaker, text):
    return {'a': 'say', 'speaker': speaker, 'text': text}


def obj(i, state):
    return {'a': 'objective', 'id': i, 'state': state}


# ---------------------------------------------------------------- mission 1 · the scratch

def m01():
    crater = [38, 18, 26, 16]  # inside the wound's rim
    wound = [44, 25, 14, 10]   # the floor where it has to be sealed
    cells = [(3, 16), (5, 36), (18, 33), (22, 19), (24, 13), (27, 36), (33, 12), (64, 12), (72, 16), (78, 33),
             (82, 15), (84, 26), (86, 35), (88, 13), (69, 36), (16, 14), (11, 35), (36, 38), (63, 38), (76, 27)]
    return {
        'id': 'm01', 'number': 1, 'title': 'השריטה', 'map': 'm01', 'cine': 'cine_01_fence', 'camera': [50, 34],
        'player': {'faction': 'wl', 'basic': 0, 'advanced': 0},
        'enemy': {'faction': 'col', 'basic': 0, 'advanced': 0},
        'host': {'cells': cells, 'tissueMin': 600},
        'place': [
            {'owner': ME, 'type': 'unit_wl_neutrophil', 'at': [14, 37], 'n': 6},
            {'owner': ME, 'type': 'unit_wl_neutrophil', 'at': [82, 37], 'n': 6},
            # three clusters of staph that have settled in the wound, and a few already out
            {'owner': ENEMY, 'type': 'bld_col_fission', 'at': [37, 22], 'tag': 'cluster', 'hp': 2500},
            {'owner': ENEMY, 'type': 'bld_col_fission', 'at': [61, 19], 'tag': 'cluster', 'hp': 2500},
            {'owner': ENEMY, 'type': 'bld_col_fission', 'at': [59, 28], 'tag': 'cluster', 'hp': 2500},
            {'owner': ENEMY, 'type': 'unit_col_coccus', 'at': [41, 26], 'n': 3},
            {'owner': ENEMY, 'type': 'unit_col_coccus', 'at': [60, 24], 'n': 3},
            {'owner': ENEMY, 'type': 'unit_col_coccus', 'at': [57, 32], 'n': 3},
        ],
        'gates': [
            {'at': [14, 38], 'infl': 0}, {'at': [50, 38], 'infl': 0}, {'at': [82, 38], 'infl': 0},
            {'at': [32, 39], 'infl': 31000}, {'at': [70, 39], 'infl': 31000},
        ],
        'objectives': [
            {'id': 'reach', 'text': 'הגיעו לפצע עם חוליית נויטרופילים'},
            {'id': 'clusters', 'text': 'השמידו את 3 אשכולות החיידקים', 'hidden': True},
            {'id': 'seal', 'text': 'הביאו טסיות ואטמו את הפצע', 'hidden': True},
        ],
        'triggers': [
            {'id': 'hello', 'when': [{'t': 'time', 'at': 2 * S}], 'do': [
                say('general4', 'החתך פתוח והחיידקים כבר בפנים. סמנו את הנויטרופילים בגרירה, ולחיצה ימנית כדי להזיז אותם אל הפצע.')]},
            # the wound pours bacteria out until it is sealed
            # the bacteria spread out of the wound into the tissue around it, and feed on it
            {'id': 'wound', 'when': [{'t': 'time', 'at': 30 * S}], 'every': 30 * S, 'do': [
                {'a': 'spawn', 'owner': ENEMY, 'type': 'unit_col_coccus', 'n': 2, 'at': [43, 27], 'go': [22, 22]},
                {'a': 'spawn', 'owner': ENEMY, 'type': 'unit_col_coccus', 'n': 2, 'at': [64, 30], 'go': [80, 24]}]},
            # the clusters still standing send more, and they grow over time
            {'id': 'clusters_send', 'when': [{'t': 'time', 'at': 50 * S}, {'t': 'tagged', 'tag': 'cluster'}], 'every': 45 * S, 'do': [
                {'a': 'spawn', 'owner': ENEMY, 'type': 'unit_col_coccus', 'n': 2, 'at': [63, 24], 'go': [78, 34]}]},
            {'id': 'clusters_send2', 'when': [{'t': 'time', 'at': 3 * MIN}, {'t': 'tagged', 'tag': 'cluster'}], 'every': 60 * S, 'do': [
                {'a': 'spawn', 'owner': ENEMY, 'type': 'unit_col_coccus', 'n': 3, 'at': [40, 28], 'go': [20, 33]}]},
            # reinforcements through the exit gates (sooner while inflammation is active)
            {'id': 'reinforce', 'when': [{'t': 'time', 'at': 40 * S}], 'every': 40 * S, 'fast': True, 'do': [
                {'a': 'spawn', 'owner': ME, 'type': 'unit_wl_neutrophil', 'n': 4, 'at': 'gates'}]},
            {'id': 'reached', 'when': [{'t': 'units_in', 'owner': ME, 'rect': crater, 'n': 4, 'role': 'infantry'}], 'do': [
                obj('reach', 'done'), obj('clusters', 'active'),
                say('general4', 'שם הם — שלושה אשכולות של סטפילוקוקוס. השמידו את שלושתם.'),
                say('nurse', 'טיפ ממשמרת לילה: נויטרופיל יכול להתפוצץ לרשת (NET) שעוצרת אויבים ל-6 שניות. סמנו נויטרופילים ולחצו N. זה נגמר בהם — ובמוגלה.')]},
            {'id': 'warm', 'when': [{'t': 'infl', 'above': 31000}], 'do': [
                say('nurse', 'חום 38.3. הדלקת פעילה: נפתחים עוד שערים ותגבורת מגיעה מהר יותר. זה טוב — אל תגזימו.')]},
            {'id': 'hot', 'when': [{'t': 'infl', 'above': 61000}], 'do': [
                say('nurse', 'דלקת סוערת! הרקמה נפגעת והלחץ יורד. תנו לה להירגע — פחות נויטרופילים מתים, פחות דלקת.')]},
            {'id': 'clusters_down', 'when': [{'t': 'none_tagged', 'tag': 'cluster'}], 'do': [
                obj('clusters', 'done'), obj('seal', 'active'),
                {'a': 'spawn', 'owner': ME, 'type': 'unit_wl_platelets', 'n': 3, 'at': [50, 37]},
                say('general4', 'האשכולות נפלו. טסיות בדרך משער היציאה — הביאו אותן לרצפת הפצע ותנו להן לעבוד עשר שניות.')]},
            {'id': 'sealed', 'when': [{'t': 'objective', 'id': 'seal', 'is': 'active'},
                                      {'t': 'units_in', 'owner': ME, 'rect': wound, 'n': 2, 'role': 'builder'}], 'hold': 10 * S, 'do': [
                obj('seal', 'done'), {'a': 'stop', 'trigger': 'wound'},
                say('general4', 'הפצע אטום. עבודה טובה, מפקד.'), {'a': 'win'}]},
            {'id': 'wiped', 'when': [{'t': 'no_army', 'owner': ME}], 'hold': 45 * S, 'do': [{'a': 'lose', 'reason': 'army'}]},
        ],
        'briefing': [
            {'speaker': 'nurse', 'text': 'מטופל בן 41, נשרט באצבע מגדר חלודה. אודם קל סביב החתך. נראה שגרתי.'},
            {'speaker': 'general4', 'text': 'שום דבר לא שגרתי בפרצה בעור. החיידקים כבר בפנים, והם מתחילים להתיישב. אתם מגיעים מכלי הדם, דרך שערי היציאה.'},
            {'speaker': 'general4', 'text': 'בלי בסיס הפעם — רק נויטרופילים, וזמן. השמידו את האשכולות ואטמו את הפצע. ושימו עין על מד הדלקת: ניצחון שהורג את הרקמה הוא הפסד.'},
        ],
        'truth': {'title': 'נויטרופילים מגיעים ראשונים',
                  'text': 'אחרי פציעה, נויטרופילים יוצאים מכלי הדם הקרובים תוך דקות עד שעות ומגיעים ראשונים לפצע. הם בולעים חיידקים, ולפעמים משליכים החוצה רשת של DNA (NET) שלוכדת אותם. טסיות ופיברין סוגרים את הפרצה, והמוגלה היא בעיקר נויטרופילים שסיימו את עבודתם.'},
    }


# ---------------------------------------------------------------- mission 2 · inflammation

def m02():
    lymph = [76, 0, 28, 10]
    cells = [(54, 6), (62, 7), (43, 18), (72, 15), (57, 33), (84, 14), (81, 44), (50, 48), (62, 52), (34, 34),
             (30, 26), (58, 24), (47, 38), (60, 44), (78, 41), (33, 52), (27, 8), (46, 9)]
    return {
        'id': 'm02', 'number': 2, 'title': 'דלקת', 'map': 'm02', 'cine': 'cine_02_dive', 'camera': [80, 27],
        'player': {'faction': 'wl', 'basic': 450, 'advanced': 50},
        'enemy': {'faction': 'col', 'basic': 300, 'advanced': 0, 'ai': 'easy'},
        'host': {'cells': cells, 'tissueMin': 500},
        'place': [
            {'owner': ME, 'type': 'bld_wl_lymphnode', 'at': [80, 25]},
            {'owner': ME, 'type': 'unit_wl_glut', 'at': [84, 30], 'n': 8},
            {'owner': ME, 'type': 'unit_wl_neutrophil', 'at': [77, 23], 'n': 4},
            {'owner': ME, 'type': 'unit_wl_monocyte', 'at': [81, 22], 'n': 2},
            {'owner': ME, 'type': 'hero_wl_bigmac', 'at': [76, 27], 'tag': 'hero'},
            {'owner': ENEMY, 'type': 'bld_col_biofilm_core', 'at': [16, 30], 'tag': 'core'},
            {'owner': ENEMY, 'type': 'bld_col_biofilm_core', 'at': [24, 38], 'tag': 'core'},
            {'owner': ENEMY, 'type': 'bld_col_fission', 'at': [17, 35]},
            {'owner': ENEMY, 'type': 'unit_col_feeder', 'at': [14, 35], 'n': 6},
            {'owner': ENEMY, 'type': 'unit_col_coccus', 'at': [26, 33], 'n': 4},
            {'owner': ENEMY, 'type': 'unit_col_strep', 'at': [28, 36], 'n': 2},
        ],
        'gates': [
            {'at': [91, 12], 'infl': 0}, {'at': [91, 31], 'infl': 0}, {'at': [91, 47], 'infl': 0},
            {'at': [91, 22], 'infl': 31000}, {'at': [91, 43], 'infl': 31000},
        ],
        'objectives': [
            {'id': 'base', 'text': 'הקימו בסיס ראשון: צומת נימים ושלוחת מח עצם'},
            {'id': 'front', 'text': 'עצרו את החזית האדומה לפני כלי הלימפה'},
            {'id': 'cores', 'text': 'השמידו את 2 ליבות הביופילם'},
        ],
        'triggers': [
            {'id': 'hello', 'when': [{'t': 'time', 'at': 2 * S}], 'do': [
                say('general4', 'זו כבר צלוליטיס. הקימו בסיס: לחצו על צומת הלימפה, הזמינו צומת נימים ואחריו שלוחת מח עצם.'),
                say('bigmac', 'ביג-מק כאן. אני בולע מה שזז. בחרו בי — "ארוחה גדולה" בולעת חיידק עד 400 נקודות חיים, ו"ניקיון" מנקה מוגלה ומרפא את מי שלידי.')]},
            {'id': 'based', 'when': [{'t': 'count', 'owner': ME, 'type': 'bld_wl_capillary', 'n': 1}, {'t': 'count', 'owner': ME, 'type': 'bld_wl_marrow', 'n': 1}], 'do': [
                obj('base', 'done'),
                say('general4', 'יש בסיס. מונוציטים שמתמירים למקרופאג\'ים — אחרי שיש מחסן טחול — הם הקו הכבד שלנו. ומגדל תא פיטום עוצר גלים, אבל כל פולס היסטמין מעלה את הדלקת.')]},
            # the red front: the Colony pushes east towards the lymph vessel
            {'id': 'front_wave', 'when': [{'t': 'time', 'at': 3 * MIN}, {'t': 'tagged', 'tag': 'core'}], 'every': 80 * S, 'do': [
                {'a': 'spawn', 'owner': ENEMY, 'type': 'unit_col_coccus', 'n': 4, 'at': [30, 30], 'go': [86, 6]},
                {'a': 'spawn', 'owner': ENEMY, 'type': 'unit_col_bacillus', 'n': 2, 'at': [30, 34], 'go': [86, 6]}]},
            {'id': 'front_warn', 'when': [{'t': 'time', 'at': 3 * MIN}], 'do': [
                say('nurse', 'האודם מתפשט מזרחה. אם הזיהום יגיע לכלי הלימפה בצפון-מזרח — הוא בדרך לכל הגוף.')]},
            {'id': 'reinforce', 'when': [{'t': 'time', 'at': 60 * S}], 'every': 60 * S, 'fast': True, 'do': [
                {'a': 'spawn', 'owner': ME, 'type': 'unit_wl_neutrophil', 'n': 2, 'at': 'gates'}]},
            {'id': 'warm', 'when': [{'t': 'infl', 'above': 31000}], 'do': [
                say('nurse', 'חום 38.4, היד אדומה ונפוחה. זו הדלקת שעובדת — נפתחים שערי יציאה נוספים.')]},
            {'id': 'hot', 'when': [{'t': 'infl', 'above': 61000}], 'do': [
                say('nurse', 'הלחץ יורד ל-80 ומשהו. הדלקת סוערת — הרקמה נפגעת. תנו לה לרדת לפני שממשיכים.')]},
            {'id': 'breach', 'when': [{'t': 'units_in', 'owner': ENEMY, 'rect': lymph, 'n': 3}], 'hold': 4 * S, 'do': [
                obj('front', 'failed'), {'a': 'lose', 'reason': 'lymph'}]},
            {'id': 'cores_down', 'when': [{'t': 'none_tagged', 'tag': 'core'}], 'do': [
                obj('cores', 'done'), obj('front', 'done'), {'a': 'stop', 'trigger': 'front_wave'}]},
            {'id': 'won', 'when': [{'t': 'objective', 'id': 'base', 'is': 'done'}, {'t': 'objective', 'id': 'cores', 'is': 'done'}], 'do': [
                say('general4', 'שתי הליבות נפלו והחזית נעצרה. הגוף ינצח את זה.'), {'a': 'win'}]},
            {'id': 'node_lost', 'when': [{'t': 'count', 'owner': ME, 'type': 'bld_wl_lymphnode', 'n': 0}, {'t': 'no_army', 'owner': ME}], 'do': [
                {'a': 'lose', 'reason': 'army'}]},
        ],
        'briefing': [
            {'speaker': 'nurse', 'text': 'יומיים אחרי. כף היד אדומה, חמה ונפוחה, והאודם מתקדם לכיוון שורש כף היד. חום 38.'},
            {'speaker': 'general4', 'text': 'סטרפטוקוקוס בנו ביופילם ברקמה התת-עורית, והחזית שלהם זוחלת מזרחה, אל כלי הלימפה. הפעם בונים בסיס: כלכלה, ייצור, הגנה.'},
            {'speaker': 'general4', 'text': 'ביג-מק מצטרף אליכם. ואל תשכחו את מד הדלקת — דלקת פעילה עוזרת, דלקת סוערת הורסת את מה שאנחנו מגינים עליו.'},
        ],
        'truth': {'title': 'האודם הוא הדלקת עצמה',
                  'text': 'בצלוליטיס, האודם, החום, הנפיחות והכאב הם סימני הדלקת — כלי הדם מתרחבים ונעשים חדירים כדי שתאי חיסון יוכלו לצאת לרקמה. הגוף נלחם. כשהדלקת יוצאת משליטה היא עצמה מזיקה, ולכן רופאים מסמנים את גבול האודם ועוקבים אם הוא מתקדם.'},
    }


# ---------------------------------------------------------------- mission 3 · the node

def m03():
    lanes = [[2, 7], [2, 33], [32, 1], [84, 1]]
    hq = [51, 31]
    cells = [(28, 26), (33, 30), (40, 20), (70, 20), (78, 27), (66, 41), (40, 42), (30, 40), (82, 40), (60, 12),
             (48, 12), (24, 22), (86, 22), (54, 44), (46, 45), (70, 45)]
    waves = []
    # lanes in turn; the waves grow over the 20 minutes
    for k, (start, end, units) in enumerate([
        (1 * MIN, 6 * MIN, [('unit_col_coccus', 4)]),
        (6 * MIN, 12 * MIN, [('unit_col_coccus', 4), ('unit_col_bacillus', 2)]),
        (12 * MIN, 17 * MIN, [('unit_col_coccus', 5), ('unit_col_bacillus', 2), ('unit_col_flagellate', 2)]),
        (17 * MIN, 21 * MIN, [('unit_col_coccus', 6), ('unit_col_bacillus', 3), ('unit_col_capsule', 2)]),
    ]):
        for li, lane in enumerate(lanes):
            waves.append({'id': f'wave{k}_{li}', 'when': [{'t': 'time', 'at': start + li * 30 * S}],
                          'every': 120 * S, 'do': [{'a': 'spawn', 'owner': ENEMY, 'type': t, 'n': n, 'at': lane, 'go': hq} for t, n in units]})
        waves.append({'id': f'wave{k}_end', 'when': [{'t': 'time', 'at': end}], 'do': [{'a': 'stop', 'trigger': f'wave{k}_{li}'} for li in range(len(lanes))]})
    return {
        'id': 'm03', 'number': 3, 'title': 'הצומת', 'map': 'm03', 'cine': 'cine_03_paratroopers', 'camera': [52, 31],
        'player': {'faction': 'wl', 'basic': 500, 'advanced': 100},
        'enemy': {'faction': 'col', 'basic': 0, 'advanced': 0},
        'host': {'cells': cells, 'tissueMin': 500},
        'place': [
            {'owner': ME, 'type': 'bld_wl_lymphnode', 'at': [50, 30], 'tag': 'node'},
            {'owner': ME, 'type': 'bld_wl_capillary', 'at': [47, 25]},
            {'owner': ME, 'type': 'bld_wl_marrow', 'at': [56, 24]},
            {'owner': ME, 'type': 'unit_wl_glut', 'at': [48, 35], 'n': 8},
            {'owner': ME, 'type': 'unit_wl_neutrophil', 'at': [41, 28], 'n': 4},
            {'owner': ME, 'type': 'unit_wl_macrophage', 'at': [60, 34], 'n': 2},
            {'owner': ME, 'type': 'unit_wl_dendritic', 'at': [54, 36], 'n': 1},
            {'owner': ME, 'type': 'hero_wl_dendra', 'at': [53, 36], 'tag': 'hero'},
        ],
        'gates': [],
        'objectives': [
            {'id': 'hold', 'text': 'החזיקו את הצומת 20 דקות'},
            {'id': 'antigen', 'text': 'הביאו דגימת אנטיגן ראשונה לצומת הלימפה'},
            {'id': 'cells', 'text': 'ייצרו תא CD4 ראשון ותא B (פלזמה) ראשון'},
        ],
        'triggers': [
            {'id': 'hello', 'when': [{'t': 'time', 'at': 2 * S}], 'do': [
                say('dendra', 'ד"ר דנדרה, מודיעין. החיידקים מגיעים בכלי הלימפה — ארבעה נתיבים, מהצפון ומהמערב. הזרם בהם מהיר, אז הם יגיעו מהר.'),
                say('dendra', 'אני דוגמת בשנייה אחת, לא בחמש. הביאו אותי לאויב, לחיצה ימנית עליו — ואני מביאה את הדגימה לצומת. "סריקה" מראה לכם הכול סביבי לכמה שניות.')]},
            *waves,
            {'id': 'sampled', 'when': [{'t': 'antigen', 'owner': ME}], 'do': [
                obj('antigen', 'done'),
                say('general4', 'יש לנו משפחה. עכשיו: מחסן טחול, ואז אקדמיית התימוס באזור T ומרכז נבט בזקיק (אזור B) — רק שם הם נבנים.')]},
            {'id': 'trained', 'when': [{'t': 'made', 'owner': ME, 'type': 'unit_wl_cd4', 'n': 1}, {'t': 'made', 'owner': ME, 'type': 'unit_wl_plasma', 'n': 1}], 'do': [
                obj('cells', 'done'), say('dendra', 'CD4 ותא B פעילים. ככה נראית תגובה חיסונית נרכשת.')]},
            {'id': 'held', 'when': [{'t': 'time', 'at': 20 * MIN}], 'do': [obj('hold', 'done')]},
            {'id': 'warm', 'when': [{'t': 'infl', 'above': 31000}], 'do': [
                say('nurse', 'בלוטה נפוחה ורגישה בבית השחי, חום 38.1. היא עובדת.')]},
            {'id': 'hot', 'when': [{'t': 'infl', 'above': 61000}], 'do': [
                say('nurse', 'הדלקת סוערת — הבלוטה כואבת והלחץ יורד. תנו לה רגע.')]},
            {'id': 'won', 'when': [{'t': 'objective', 'id': 'hold', 'is': 'done'}, {'t': 'objective', 'id': 'antigen', 'is': 'done'}, {'t': 'objective', 'id': 'cells', 'is': 'done'}], 'do': [
                say('general4', 'הצומת עמד. ועכשיו הגוף זוכר אותם.'), {'a': 'win'}]},
            {'id': 'late', 'when': [{'t': 'time', 'at': 26 * MIN}], 'do': [{'a': 'lose', 'reason': 'time'}]},
            {'id': 'node_lost', 'when': [{'t': 'none_tagged', 'tag': 'node'}], 'do': [{'a': 'lose', 'reason': 'node'}]},
        ],
        'briefing': [
            {'speaker': 'nurse', 'text': 'בלוטה נפוחה ורגישה בבית השחי. הזיהום עלה במעלה הזרוע.'},
            {'speaker': 'general4', 'text': 'חיידקים נכנסו לכלי הלימפה, וכולם מובילים לכאן — לצומת. אם הוא נופל, אין מה שיעצור אותם.'},
            {'speaker': 'general4', 'text': 'ד"ר דנדרה תביא לנו דגימה. ממנה נלמד להכין תאים שמכירים את האויב: CD4 שמכוון את המלחמה, ותא B שמייצר נוגדנים. החזיקו 20 דקות.'},
        ],
        'truth': {'title': 'בלוטה נפוחה היא בלוטה שעובדת',
                  'text': 'תאים דנדריטיים לוקחים חלקי חיידק (אנטיגן) מהרקמה ונודדים בכלי הלימפה אל הבלוטה. שם הם מציגים אותו לתאי T, ותאי T מסייעים (CD4) מפעילים תאי B שמתחילים לייצר נוגדנים. ההתרבות הזו היא מה שגורם לבלוטה להתנפח.'},
    }


if __name__ == '__main__':
    for maker in (m01, m02, m03):
        mission = maker()
        m = load_map(mission['map'])
        check(mission['id'], m, mission)
        path = os.path.join(ROOT, 'content', 'missions', mission['id'] + '.json')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            json.dump(mission, f, ensure_ascii=False, indent=1)
            f.write('\n')
        print(mission['id'], len(mission['triggers']), 'triggers,', len(mission['host']['cells']), 'host cells')
