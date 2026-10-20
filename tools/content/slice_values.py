"""Opening values for the first slice (White Line vs Colony), in human units.

This table is the source; content/*.json is generated from it:
    python3 -I tools/content/slice_values.py
Seconds become ticks (x20), tiles become sub-tiles (x256), tiles per second become
sub-tiles per tick (x12.8). These are trial values from the architecture tab, section 5.
"""
import json
import math
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
T = lambda tiles: round(tiles * 256)            # tiles -> sub-tiles
S = lambda sec: round(sec * 20)                 # seconds -> ticks
V = lambda tps: round(tps * 256 / 20)           # tiles/s -> sub-tiles/tick
RADIUS = {'small': T(0.45), 'medium': T(0.6), 'large': T(0.85)}  # close to the drawn body size


def weapon(id, kind, damage, cooldown_s, range_t, windup_s=0.2, min_t=0, splash_t=0, arc=0, bonus=None, targets=1, engulf=0,
           speed_tps=0, lost='fizzle', slow=0, slow_s=0, antibody=False):
    # windup: from the start of an attack to its launch. speed: projectile speed (0 = hits at launch).
    # antibody: antibodies (they lose 60% against anything standing on biofilm).
    # lost: what a projectile does when its target dies first ('ground': lands at the last point; 'fizzle': gone).
    # slow: thousandths taken off the target's speed for slow_s seconds.
    return dict(id=id, kind=kind, damage=damage, cooldown=S(cooldown_s), windup=S(windup_s), range=T(range_t), minRange=T(min_t),
                splash=T(splash_t), arc=arc, bonus=bonus or {}, maxTargets=targets, engulfMaxHp=engulf,
                speed=V(speed_tps), onTargetLost=lost, slow=slow, slowTicks=S(slow_s), antibody=antibody,
                arcCos=round(math.cos(math.radians(arc / 2)) * 1000) if arc else 1000)


def unit(id, faction, role, cost, train_s, supply, hp, speed_tps, nav, sight_t, at, weapon=None, armor=0, tags=('biological',),
         carry=0, life_s=0, requires=(), morphs=None, family='', aura=''):
    # family: the antigen family a sample of it opens (enemies of the White Line); '' for the White Line
    # aura: 'helper' = a CD4 helper (IL-2 for acquired cells, IFN-γ for macrophages, within 6 tiles)
    return dict(id=id, faction=faction, role=role, cost=list(cost), trainTicks=S(train_s), supply=supply, hp=hp, armor=armor,
                speed=V(speed_tps), radius=RADIUS[nav], navClass=nav, sight=T(sight_t), weapon=weapon, tags=list(tags), carry=carry,
                lifespan=S(life_s), producedAt=at, requires=list(requires), morphsTo=morphs, family=family, aura=aura)


def building(id, faction, role, cost, build_s, hp, fp, sight_t=8, armor=1, supply=0, dropoff=False, produces=(), requires=(),
             critical=False, on=None, weapon=None, biofilm=False, slots=0, placement=None, art=None, art_scale=1000, family=''):
    # placement: 'near' = within 8 tiles of an own building; 'builder' = where a platelet squad stands;
    # 'resource' = on a free deposit; 'biofilm' = on own biofilm (gate 6); 'none' = never ordered
    if placement is None:
        placement = 'resource' if on else ('biofilm' if biofilm else 'near')
    return dict(id=id, faction=faction, role=role, cost=list(cost), buildTicks=S(build_s), hp=hp, armor=armor, footprint=list(fp),
                supplyProvided=supply, dropoff=dropoff, produces=list(produces), requires=list(requires), sight=T(sight_t),
                critical=critical, onResource=on, weapon=weapon, needsBiofilm=biofilm, workSlots=slots, placement=placement,
                art=art or id, artScale=art_scale, family=family)


def resource(id, kind, stock, fp, slots, harvest_s):
    # slots: carriers that can work it at once; 0 = it is worked through an extractor built on top
    return dict(id=id, kind=kind, stock=stock, footprint=list(fp), slots=slots, harvestTicks=S(harvest_s))


weapons = [
    # White Line
    weapon('w_monocyte_nip', 'melee', 4, 1.0, 1),
    weapon('w_neutrophil_claw', 'melee', 8, 0.8, 1),
    weapon('w_eos_granule', 'projectile', 12, 1.5, 4, windup_s=0.3, bonus={'armored': 2000, 'building': 2000}, speed_tps=10),
    weapon('w_macro_engulf', 'engulf', 16, 1.5, 1, windup_s=0.3, engulf=150),
    weapon('w_plasma_volley', 'projectile', 30, 3.0, 10, windup_s=0.5, min_t=3, bonus={'building': 3000}, speed_tps=12, lost='ground', antibody=True),
    weapon('w_histamine', 'projectile', 3, 1.0, 5, splash_t=2, slow=400, slow_s=1.5),
    weapon('w_nk_strike', 'melee', 20, 1.2, 1, windup_s=0.25, bonus={'infected': 5000}),
    weapon('w_cd4_signal', 'projectile', 5, 1.0, 2, speed_tps=10),
    weapon('w_cd8_perforin', 'melee', 12, 1.0, 1, bonus={'infected': 4000}),
    # Colony
    weapon('w_coccus_bite', 'melee', 5, 0.8, 1),
    weapon('w_flagellate_bite', 'melee', 8, 0.8, 1),
    weapon('w_spiro_drill', 'melee', 12, 1.5, 1, windup_s=0.3, bonus={'armored': 2000, 'building': 2000}),
    weapon('w_strep_whip', 'arc', 14, 1.2, 1.5, windup_s=0.3, arc=120, targets=3),
    weapon('w_toxin_spit', 'projectile', 28, 3.0, 9, windup_s=0.5, min_t=3, splash_t=0.75, bonus={'building': 3000}, speed_tps=8, lost='ground'),
    weapon('w_toxin_spray', 'projectile', 6, 1.0, 4, splash_t=0.5),
    weapon('w_bacillus_spit', 'projectile', 8, 1.0, 2, speed_tps=9),
    weapon('w_capsule_bite', 'melee', 10, 1.2, 1),
]

units = [
    unit('unit_wl_glut', 'wl', 'worker', (60, 0), 15, 1, 60, 3, 'small', 6, 'bld_wl_lymphnode', tags=('biological', 'worker'), carry=10),
    unit('unit_wl_platelets', 'wl', 'builder', (75, 0), 15, 1, 75, 4, 'small', 6, 'bld_wl_marrow'),
    unit('unit_wl_monocyte', 'wl', 'scout', (70, 0), 15, 1, 60, 6, 'small', 9, 'bld_wl_marrow', weapon='w_monocyte_nip', morphs='unit_wl_macrophage'),
    unit('unit_wl_neutrophil', 'wl', 'infantry', (50, 0), 12, 1, 80, 4, 'small', 7, 'bld_wl_marrow', weapon='w_neutrophil_claw', life_s=180),
    unit('unit_wl_dendritic', 'wl', 'intel', (75, 25), 20, 1, 50, 4.5, 'medium', 9, 'bld_wl_marrow'),
    unit('unit_wl_eosinophil', 'wl', 'antiarmor', (100, 40), 24, 2, 90, 2.8, 'medium', 8, 'bld_wl_spleen', weapon='w_eos_granule'),
    unit('unit_wl_macrophage', 'wl', 'heavy', (90, 40), 6, 3, 220, 2.2, 'large', 7, 'unit_wl_monocyte', weapon='w_macro_engulf', armor=2,
         tags=('biological', 'armored'), requires=('bld_wl_spleen',)),
    unit('unit_wl_plasma', 'wl', 'siege', (180, 90), 35, 4, 140, 2, 'large', 8, 'bld_wl_germinal', weapon='w_plasma_volley', requires=('antigen:any',),
         tags=('biological', 'acquired')),
    unit('unit_wl_nk', 'wl', 'commando', (160, 40), 26, 2, 130, 4.5, 'medium', 9, 'bld_wl_marrow', weapon='w_nk_strike', requires=('bld_wl_spleen',)),
    # tier 2, from the thymus academy once an antigen sample has been processed
    unit('unit_wl_cd4', 'wl', 'support', (140, 60), 25, 2, 160, 3, 'medium', 8, 'bld_wl_thymus', weapon='w_cd4_signal', tags=('biological', 'acquired'), aura='helper'),
    unit('unit_wl_cd8', 'wl', 'infantry', (120, 60), 22, 2, 140, 3.4, 'medium', 8, 'bld_wl_thymus', weapon='w_cd8_perforin', tags=('biological', 'acquired')),
    unit('unit_wl_treg', 'wl', 'support', (100, 40), 20, 1, 100, 3, 'medium', 8, 'bld_wl_thymus', tags=('biological', 'acquired')),
    unit('unit_col_feeder', 'col', 'worker', (50, 0), 12, 1, 50, 3.2, 'small', 6, 'bld_col_biofilm_core', tags=('biological', 'worker'), carry=10, family='staph'),
    unit('unit_col_coccus', 'col', 'infantry', (40, 0), 10, 1, 55, 3.5, 'small', 7, 'bld_col_fission', weapon='w_coccus_bite', family='staph'),
    unit('unit_col_bacillus', 'col', 'infantry', (70, 0), 14, 1, 100, 3, 'small', 7, 'bld_col_fission', weapon='w_bacillus_spit', family='bacillus'),
    unit('unit_col_flagellate', 'col', 'scout', (100, 0), 18, 2, 80, 5.5, 'medium', 9, 'bld_col_flagellum', weapon='w_flagellate_bite', family='enteric'),
    unit('unit_col_spirochete', 'col', 'antiarmor', (95, 35), 22, 2, 85, 3, 'medium', 7, 'bld_col_flagellum', weapon='w_spiro_drill', family='spiro'),
    unit('unit_col_capsule', 'col', 'heavy', (120, 20), 22, 2, 150, 3, 'medium', 7, 'bld_col_flagellum', weapon='w_capsule_bite',
         tags=('biological', 'capsule'), family='pneumo'),
    unit('unit_col_strep', 'col', 'heavy', (150, 30), 26, 3, 180, 2.6, 'large', 7, 'bld_col_flagellum', weapon='w_strep_whip', armor=1, family='strep'),
    unit('unit_col_toxin', 'col', 'siege', (170, 80), 32, 4, 120, 2, 'large', 8, 'bld_col_toxinfoundry', weapon='w_toxin_spit', family='clostridium'),
]

buildings = [
    building('bld_wl_lymphnode', 'wl', 'hq', (0, 0), 0, 1500, (4, 4), sight_t=10, armor=2, supply=20, dropoff=True,
             produces=('unit_wl_glut',), critical=True, placement='none'),
    # the expansion: a smaller lymph node (its art at 75%), only where platelets stand
    building('bld_wl_outpost', 'wl', 'expansion', (400, 0), 60, 900, (3, 3), sight_t=9, armor=1, supply=10, dropoff=True,
             produces=('unit_wl_glut',), placement='builder', art='bld_wl_lymphnode', art_scale=750),
    building('bld_wl_capillary', 'wl', 'supply', (100, 0), 20, 400, (2, 2), supply=12, requires=('bld_wl_lymphnode',)),
    building('bld_wl_mitochondria', 'wl', 'dropoff', (100, 0), 20, 600, (3, 2), dropoff=True, requires=('bld_wl_lymphnode',)),
    building('bld_wl_marrow', 'wl', 'production', (150, 0), 30, 900, (3, 3), critical=True, requires=('bld_wl_capillary',),
             produces=('unit_wl_neutrophil', 'unit_wl_monocyte', 'unit_wl_dendritic', 'unit_wl_platelets', 'unit_wl_nk')),
    building('bld_wl_spleen', 'wl', 'production', (180, 0), 35, 1000, (3, 3), critical=True, requires=('bld_wl_marrow',),
             produces=('unit_wl_eosinophil',)),
    building('bld_wl_aminopump', 'wl', 'extractor', (75, 0), 20, 450, (2, 2), on='protein', slots=3),
    building('bld_wl_mastcell', 'wl', 'defense', (140, 0), 30, 500, (2, 2), requires=('bld_wl_marrow',), weapon='w_histamine'),
    building('bld_wl_germinal', 'wl', 'tech', (250, 100), 60, 900, (3, 3), critical=True, requires=('bld_wl_spleen', 'antigen:any'),
             produces=('unit_wl_plasma',)),
    building('bld_wl_thymus', 'wl', 'tech', (200, 100), 45, 900, (3, 3), critical=True, requires=('bld_wl_spleen', 'antigen:any'),
             produces=('unit_wl_cd4', 'unit_wl_cd8', 'unit_wl_treg')),
    # a new biofilm core may go anywhere (it spreads biofilm of its own); the rest only on own biofilm
    building('bld_col_biofilm_core', 'col', 'hq', (400, 0), 60, 1400, (4, 4), sight_t=10, supply=20, dropoff=True,
             produces=('unit_col_feeder',), critical=True, placement='anywhere', family='staph'),
    building('bld_col_fermentation', 'col', 'supply', (120, 0), 25, 550, (3, 2), supply=10, dropoff=True, biofilm=True,
             requires=('bld_col_biofilm_core',), family='staph'),
    building('bld_col_fission', 'col', 'production', (150, 0), 30, 850, (3, 3), critical=True, biofilm=True,
             requires=('bld_col_biofilm_core',), produces=('unit_col_coccus', 'unit_col_bacillus'), family='staph'),
    building('bld_col_siderophore', 'col', 'extractor', (75, 0), 20, 450, (2, 2), on='iron', slots=3, family='staph'),
    building('bld_col_flagellum', 'col', 'production', (180, 0), 35, 950, (3, 3), critical=True, biofilm=True,
             requires=('bld_col_fission',), produces=('unit_col_flagellate', 'unit_col_spirochete', 'unit_col_capsule', 'unit_col_strep'), family='staph'),
    building('bld_col_toxinspire', 'col', 'defense', (130, 0), 30, 480, (2, 2), biofilm=True, requires=('bld_col_fission',), weapon='w_toxin_spray', family='staph'),
    building('bld_col_toxinfoundry', 'col', 'tech', (250, 100), 60, 900, (3, 3), critical=True, biofilm=True,
             requires=('bld_col_flagellum',), produces=('unit_col_toxin',), family='staph'),
]

# glucose crystals have one work slot each; protein and iron are worked through an extractor (3 slots)
resources = [
    resource('res_glucose_small', 'glucose', 600, (1, 1), 1, 5),
    resource('res_glucose_large', 'glucose', 1800, (2, 2), 1, 5),
    resource('res_protein', 'protein', 1800, (2, 2), 0, 5),
    resource('res_iron', 'iron', 1800, (2, 2), 0, 5),
]

factions = [
    dict(id='wl', hq='bld_wl_lymphnode', construction='order', start=[dict(unit='unit_wl_glut', count=8), dict(unit='unit_wl_monocyte', count=1)],
         basic=350, advanced=0, supplyCap=120, basicName='ATP', advancedName='חומצות אמינו'),
    dict(id='col', hq='bld_col_biofilm_core', construction='morph', start=[dict(unit='unit_col_feeder', count=8), dict(unit='unit_col_flagellate', count=1)],
         basic=350, advanced=0, supplyCap=120, basicName='ATP', advancedName='ברזל'),
]


def write(rel, data):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')


write('content/weapons/slice.json', weapons)
write('content/units/slice.json', units)
write('content/buildings/slice.json', buildings)
write('content/resources/slice.json', resources)
write('content/factions.json', factions)
print(len(weapons), 'weapons,', len(units), 'units,', len(buildings), 'buildings,', len(resources), 'resources,', len(factions), 'factions')
