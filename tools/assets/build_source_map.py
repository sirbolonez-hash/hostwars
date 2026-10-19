"""One-time: map the uploaded image files (by index in the inventory) to canonical asset ids."""
import json, sys, os
inv = json.load(open(sys.argv[1]))
out = sys.argv[2]
I = {}
def seq(start, ids):
    for k, name in enumerate(ids):
        I[start + k] = name
I[0] = 'keyart_title'
seq(1, ['emblem_wl', 'emblem_col', 'emblem_crn', 'lineup_wl', 'lineup_col', 'lineup_crn'])
seq(7, ['unit_wl_neutrophil', 'unit_wl_monocyte', 'unit_wl_bcell', 'unit_wl_platelets', 'unit_wl_dendritic',
        'unit_wl_eosinophil', 'unit_wl_nk', 'unit_wl_cd4', 'unit_wl_cd8', 'unit_wl_treg', 'unit_wl_iga',
        'unit_wl_macrophage', 'unit_wl_plasma', 'unit_wl_glut', 'unit_wl_igm', 'unit_wl_giantcell'])
seq(23, ['hero_wl_bigmac', 'hero_wl_killer', 'hero_wl_dendra', 'hero_wl_plasma', 'hero_wl_general4'])
seq(28, ['unit_col_spore', 'unit_col_coccus', 'unit_col_bacillus', 'unit_col_bomber', 'unit_col_capsule',
         'unit_col_spirochete', 'unit_col_flagellate', 'unit_col_clostridium', 'unit_col_pilus', 'unit_col_feeder',
         'unit_col_strep', 'unit_col_toxin', 'unit_col_mycobacterium'])
seq(41, ['hero_col_aureus', 'hero_col_aureus_mrsa', 'hero_col_pseudo', 'hero_col_clostra', 'hero_col_meningo'])
seq(46, ['unit_crn_nano', 'unit_crn_virion', 'unit_crn_sleeper', 'unit_crn_spiker', 'unit_crn_enveloped',
         'unit_crn_flu', 'unit_crn_integrator', 'unit_crn_phage', 'unit_crn_trojan', 'unit_crn_colossus'])
seq(56, ['hero_crn_integrator', 'hero_crn_sleeper', 'hero_crn_crown', 'hero_crn_flu'])
seq(60, ['unit_neu_rbc', 'unit_neu_lacto', 'unit_neu_renegade', 'unit_neu_microglia', 'unit_neu_kupffer'])
wlA1 = ['lymphnode', 'capillary', 'mitochondria', 'marrow', 'spleen', 'aminopump']
wlA2 = ['cytokine', 'thymus', 'germinal', 'arterial', 'memory', 'mastcell', 'macropost', 'ferritin', 'fibrinwall', 'complement']
seq(65, ['bld_wl_%s' % n for n in wlA1])  # set A: chosen 2026-10-19
seq(71, ['bld_wl_%s_dmg' % n for n in wlA1])
seq(77, ['bld_wl_%s' % n for n in wlA2])
seq(87, ['bld_wl_%s_dmg' % n for n in wlA2])
seq(97, ['bld_wl_%s_alt' % n for n in wlA1 + wlA2])  # set B: kept as the alternate
seq(113, ['bld_col_biofilm_core', 'bld_col_fermentation', 'bld_col_fission', 'bld_col_siderophore', 'bld_col_flagellum',
          'bld_col_plasmid', 'bld_col_toxinfoundry', 'bld_col_sporebank', 'bld_col_toxinspire', 'bld_col_capsulewall'])
seq(123, ['bld_crn_mothercapsid', 'bld_crn_mothercapsid_deployed', 'bld_crn_forge', 'bld_crn_spikespire', 'bld_crn_neuralnest', 'bld_crn_projector'])
seq(129, ['bld_col_biofilm_core_dmg', 'bld_col_fermentation_dmg', 'bld_col_fission_dmg', 'bld_col_siderophore_dmg', 'bld_col_flagellum_dmg',
          'bld_col_toxinspire_dmg', 'bld_col_toxinfoundry_dmg', 'bld_col_sporebank_dmg', 'bld_col_capsulewall_dmg', 'bld_col_plasmid_dmg'])
seq(139, ['bld_crn_mothercapsid_dmg', 'bld_crn_mothercapsid_deployed_dmg', 'bld_crn_forge_dmg', 'bld_crn_spikespire_dmg', 'bld_crn_neuralnest_dmg', 'bld_crn_projector_dmg'])
seq(145, ['bld_neu_epithelial', 'bld_neu_epithelial_infected', 'bld_neu_epithelial_burst', 'bld_neu_hepatocyte', 'bld_neu_kidneycell', 'bld_neu_cardiomyocyte', 'bld_neu_neuron'])
seq(152, ['bld_neu_epithelial_dmg', 'bld_neu_epithelial_infected_dmg', 'bld_neu_epithelial_burst_dmg', 'bld_neu_hepatocyte_dmg', 'bld_neu_kidneycell_dmg', 'bld_neu_cardiomyocyte_dmg'])
I[158] = 'res_glucose_large'; I[159] = 'bld_neu_neuron_dmg'
seq(160, ['res_glucose_small', 'res_protein', 'res_iron'])
I[300] = 'map_m01_skin'
seq(163, ['map_m%02d_%s' % (n, s) for n, s in zip(range(2, 21), ['subcutis', 'lymphnode', 'vein', 'spleen', 'nose', 'trachea', 'lungs',
          'smallintestine', 'colon', 'liver', 'urinary', 'heartvalve', 'marrow', 'thymus', 'meninges', 'ganglion', 'systemic', 'centralline', 'heart'])])
seq(182, ['tile_tissue', 'tile_blood', 'tile_mucus', 'tile_biofilm', 'tile_pus', 'tile_villi', 'tile_acid', 'tile_liver', 'tile_plastic',
          'tile_neural', 'tile_bone', 'tile_keratin', 'tile_alveolar', 'tile_lymph', 'tile_fog'])
seq(197, ['fx_strep_whip', 'fx_toxin_cloud', 'fx_spike_dart', 'fx_net_burst', 'fx_phagocytosis', 'fx_scan_ring', 'fx_opsonize_tag',
          'fx_agglutination', 'fx_clot_seal', 'fx_granuloma_ring', 'fx_interferon_wave', 'fx_il2_aura', 'fx_fission'])
I[210] = 'fx_pinkburst_and_toxin_glob'  # two rows; split by the pipeline
seq(211, ['fx_histamine_pulse', 'fx_nk_strike', 'fx_quorum', 'fx_perforin', 'fx_eos_grenade', 'fx_antibody_volley'])
named = {217: 'fx_building_collapse', 218: 'cine_06_crown_lands', 219: 'fx_death_virus', 220: 'cine_09_storm', 221: 'portrait_dendra',
         222: 'fx_extravasation', 223: 'cine_02_dive', 224: 'portrait_doctor', 225: 'cine_07_hospital', 226: 'cine_03_paratroopers',
         227: 'fx_death_bacteria', 228: 'fx_hijack', 229: 'fx_lysis_burst', 230: 'fx_steroid', 231: 'fx_fever_haze', 232: 'fx_iv_fluids',
         233: 'fx_heartbeat', 234: 'fx_iron_draw', 235: 'fx_superantigen', 236: 'expr_killer', 237: 'expr_crown', 238: 'expr_aureus',
         239: 'expr_general4', 240: 'cine_12_sequel', 241: 'ui_sidebar_wl', 242: 'expr_bigmac', 243: 'ui_cursors', 244: 'ui_doctor_orders',
         245: 'ui_resource_icons', 246: 'portrait_meningo', 247: 'fx_conjugation', 248: 'portrait_killer', 249: 'ui_rank_badges',
         250: 'fx_integration', 251: 'bld_col_superantigen', 252: 'cine_08_vegetation', 253: 'portrait_aureus', 254: 'fx_atp_orbs',
         255: 'fx_urine_wave', 256: 'fx_death_immune', 257: 'bld_col_superantigen_dmg', 258: 'ui_sidebar_col', 259: 'portrait_bigmac',
         260: 'portrait_integrator', 261: 'cine_05_launch', 262: 'cine_04_command', 263: 'ui_monitor_frame', 264: 'fx_glucose_harvest',
         265: 'fx_iv_line', 266: 'fx_cough', 267: 'portrait_flu', 268: 'portrait_clostra', 269: 'portrait_aureus_mrsa',
         270: 'ui_campaign_map', 271: 'fx_antibiotic_strike', 272: 'fx_endotoxin_blast', 273: 'fx_vasopressor', 274: 'fx_complement_strike',
         275: 'fx_surgical', 276: 'fx_biofilm_spread', 277: 'fx_mass_infection', 278: 'fx_antiviral', 279: 'ui_briefing_bg',
         280: 'ui_inflammation_bar', 281: 'fx_phage_drop', 282: 'portrait_plasma', 283: 'portrait_nurse', 284: 'fx_spore_form',
         285: 'ui_sidebar_crn', 286: 'expr_crown_alt', 287: 'portrait_general4', 288: 'fx_ribosome_income', 289: 'portrait_sleeper',
         290: 'portrait_pseudo', 291: 'fx_build_grow', 292: 'brand_yak', 293: 'portrait_lacto', 294: 'cine_10_discharge',
         295: 'cine_01_fence', 296: 'portrait_crown', 297: 'fx_drift', 298: 'cine_11_memory', 299: 'expr_dendra',
         301: 'portrait_thymus'}
I.update(named)
missing = [r['i'] for r in inv if r['i'] not in I]
assert not missing, missing
ids = list(I.values()); dup = {x for x in ids if ids.count(x) > 1}
assert not dup, dup
m = {}
for r in inv:
    rel = os.path.join(r['folder'], os.path.basename(os.path.dirname(r['path'])), r['name'])
    m[I[r['i']]] = {'source': rel, 'w': r['w'], 'h': r['h']}
json.dump(dict(sorted(m.items())), open(out, 'w'), ensure_ascii=False, indent=1)
print(len(m), 'ids mapped')
