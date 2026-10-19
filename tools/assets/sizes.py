"""Display sizes at zoom 1.0 (screen pixels). Textures are stored at TEX_SCALE x.

Changing a number here and re-running process.py is the whole workflow; nothing in the
game code hard-codes sprite sizes.
"""
TILE_PX = 32
TEX_SCALE = 2
BUILDING_ART_SCALE = 1.35  # art is wider than its footprint (roofs, flags, pipes)

S, M, L, H, HERO = 46, 62, 88, 120, 96

UNIT_SIZE = {
    # White Line
    'unit_wl_neutrophil': S, 'unit_wl_monocyte': S, 'unit_wl_bcell': S, 'unit_wl_platelets': S,
    'unit_wl_dendritic': M, 'unit_wl_eosinophil': M, 'unit_wl_nk': M, 'unit_wl_cd4': M, 'unit_wl_cd8': M,
    'unit_wl_treg': M, 'unit_wl_iga': M, 'unit_wl_glut': M,
    'unit_wl_macrophage': L, 'unit_wl_plasma': L, 'unit_wl_igm': L, 'unit_wl_giantcell': H,
    'hero_wl_bigmac': HERO, 'hero_wl_killer': HERO, 'hero_wl_dendra': HERO, 'hero_wl_plasma': HERO, 'hero_wl_general4': 104,
    # Colony
    'unit_col_spore': 36, 'unit_col_coccus': S,
    'unit_col_bacillus': M, 'unit_col_bomber': M, 'unit_col_capsule': M, 'unit_col_spirochete': M, 'unit_col_flagellate': M,
    'unit_col_clostridium': M, 'unit_col_pilus': M, 'unit_col_feeder': M,
    'unit_col_strep': L, 'unit_col_toxin': L, 'unit_col_mycobacterium': H,
    'hero_col_aureus': HERO, 'hero_col_aureus_mrsa': HERO, 'hero_col_pseudo': HERO, 'hero_col_clostra': HERO, 'hero_col_meningo': HERO,
    # Crown
    'unit_crn_nano': S, 'unit_crn_virion': S,
    'unit_crn_sleeper': M, 'unit_crn_spiker': M, 'unit_crn_enveloped': M, 'unit_crn_flu': M, 'unit_crn_integrator': M, 'unit_crn_phage': M,
    'unit_crn_trojan': L, 'unit_crn_colossus': H,
    'hero_crn_crown': HERO, 'hero_crn_flu': HERO, 'hero_crn_integrator': HERO, 'hero_crn_sleeper': HERO,
    # Neutral
    'unit_neu_rbc': 48, 'unit_neu_lacto': M, 'unit_neu_renegade': M, 'unit_neu_microglia': M, 'unit_neu_kupffer': L,
}

# footprint in tiles (w, h)
BUILDING_FOOTPRINT = {
    'bld_wl_lymphnode': (4, 4), 'bld_wl_capillary': (2, 2), 'bld_wl_mitochondria': (3, 2), 'bld_wl_marrow': (3, 3),
    'bld_wl_spleen': (3, 3), 'bld_wl_aminopump': (2, 2), 'bld_wl_cytokine': (2, 2), 'bld_wl_thymus': (3, 3),
    'bld_wl_germinal': (3, 3), 'bld_wl_arterial': (3, 3), 'bld_wl_memory': (3, 3), 'bld_wl_mastcell': (2, 2),
    'bld_wl_macropost': (2, 2), 'bld_wl_ferritin': (2, 2), 'bld_wl_fibrinwall': (2, 1), 'bld_wl_complement': (3, 3),
    'bld_col_biofilm_core': (4, 4), 'bld_col_fermentation': (3, 2), 'bld_col_fission': (3, 3), 'bld_col_siderophore': (2, 2),
    'bld_col_flagellum': (3, 3), 'bld_col_plasmid': (3, 3), 'bld_col_toxinfoundry': (3, 3), 'bld_col_sporebank': (3, 3),
    'bld_col_toxinspire': (2, 2), 'bld_col_capsulewall': (2, 1), 'bld_col_superantigen': (3, 3),
    'bld_crn_mothercapsid': (4, 4), 'bld_crn_mothercapsid_deployed': (4, 4), 'bld_crn_forge': (3, 3),
    'bld_crn_spikespire': (2, 2), 'bld_crn_neuralnest': (3, 3), 'bld_crn_projector': (3, 3),
    'bld_neu_epithelial': (2, 2), 'bld_neu_epithelial_infected': (2, 2), 'bld_neu_epithelial_burst': (2, 2),
    'bld_neu_hepatocyte': (2, 2), 'bld_neu_kidneycell': (2, 2), 'bld_neu_cardiomyocyte': (2, 2), 'bld_neu_neuron': (2, 2),
    'res_glucose_large': (2, 2), 'res_glucose_small': (1, 1), 'res_protein': (2, 2), 'res_iron': (2, 2),
}

# 'add' = glow (additive-friendly alpha), 'key' = solid cartoon with outlines
FX_BLEND = {
    'fx_strep_whip': 'key', 'fx_toxin_cloud': 'key', 'fx_spike_dart': 'add', 'fx_net_burst': 'add', 'fx_phagocytosis': 'key',
    'fx_scan_ring': 'add', 'fx_opsonize_tag': 'key', 'fx_agglutination': 'key', 'fx_clot_seal': 'key', 'fx_granuloma_ring': 'key',
    'fx_interferon_wave': 'key', 'fx_il2_aura': 'add', 'fx_fission': 'key', 'fx_pinkburst_and_toxin_glob': 'key',
    'fx_histamine_pulse': 'add', 'fx_nk_strike': 'add', 'fx_quorum': 'add', 'fx_perforin': 'add', 'fx_eos_grenade': 'key',
    'fx_antibody_volley': 'key', 'fx_building_collapse': 'key', 'fx_death_virus': 'key', 'fx_extravasation': 'key',
    'fx_death_bacteria': 'key', 'fx_hijack': 'key', 'fx_lysis_burst': 'key', 'fx_steroid': 'key', 'fx_fever_haze': 'add',
    'fx_iv_fluids': 'key', 'fx_heartbeat': 'add', 'fx_iron_draw': 'key', 'fx_superantigen': 'add', 'fx_conjugation': 'key',
    'fx_integration': 'key', 'fx_atp_orbs': 'key', 'fx_urine_wave': 'key', 'fx_death_immune': 'key', 'fx_glucose_harvest': 'key',
    'fx_iv_line': 'key', 'fx_cough': 'key', 'fx_antibiotic_strike': 'key', 'fx_endotoxin_blast': 'key', 'fx_vasopressor': 'add',
    'fx_complement_strike': 'add', 'fx_surgical': 'add', 'fx_biofilm_spread': 'key', 'fx_mass_infection': 'add',
    'fx_antiviral': 'add', 'fx_phage_drop': 'key', 'fx_spore_form': 'key', 'fx_ribosome_income': 'key', 'fx_build_grow': 'key',
    'fx_drift': 'key',
}

# frames per effect strip (prompts asked for 8; these two were drawn with 7)
FX_FRAMES = {'fx_net_burst': 7, 'fx_interferon_wave': 7}
