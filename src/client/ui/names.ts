// Hebrew display names. Content ids stay English; the interface speaks Hebrew.

export const NAMES: Record<string, string> = {
  unit_wl_glut: 'נשא GLUT',
  unit_wl_platelets: 'טסיות',
  unit_wl_monocyte: 'מונוציט',
  unit_wl_neutrophil: 'נויטרופיל',
  unit_wl_dendritic: 'תא דנדריטי',
  unit_wl_eosinophil: 'אאוזינופיל',
  unit_wl_macrophage: "מקרופאג'",
  unit_wl_plasma: 'תא פלזמה',
  unit_wl_nk: 'תא NK',
  unit_wl_cd4: 'תא T מסייע (CD4)',
  unit_wl_cd8: 'תא T קוטל (CD8)',
  unit_wl_treg: 'תא T מווסת',
  hero_wl_bigmac: 'ביג-מק',
  hero_wl_dendra: 'ד"ר דנדרה',
  bld_neu_epithelial: 'תא של המאכסן',
  unit_col_bacillus: 'בצילוס',
  unit_col_capsule: 'פנאומוקוק עטוף',
  unit_col_feeder: 'מזין',
  unit_col_coccus: 'קוקוס',
  unit_col_flagellate: 'דגלון',
  unit_col_spirochete: 'ספירוכטה',
  unit_col_strep: 'שרשרת',
  unit_col_toxin: 'מייצר רעלן',
  bld_wl_lymphnode: 'צומת לימפה',
  bld_wl_capillary: 'צומת נימים',
  bld_wl_outpost: 'שלוחת לימפה',
  bld_wl_mitochondria: 'מפעל מיטוכונדריה',
  bld_wl_marrow: 'שלוחת מח עצם',
  bld_wl_spleen: 'מחסן הטחול',
  bld_wl_aminopump: 'משאבת אמינו',
  bld_wl_mastcell: 'מגדל תא פיטום',
  bld_wl_germinal: 'מרכז נבט',
  bld_wl_thymus: 'אקדמיית התימוס',
  bld_col_biofilm_core: 'ליבת ביופילם',
  bld_col_fermentation: 'בור תסיסה',
  bld_col_fission: 'צבר חלוקה',
  bld_col_siderophore: 'מגדל סידרופור',
  bld_col_flagellum: 'קן הדגלונים',
  bld_col_toxinspire: 'מגדל רעלן',
  bld_col_toxinfoundry: 'מטבחת רעלנים',
  res_glucose_small: 'גביש גלוקוז קטן',
  res_glucose_large: 'גביש גלוקוז גדול',
  res_protein: 'מרבץ חלבון',
  res_iron: 'מרבץ ברזל',
};

/** what a load of each resource is called */
export const KIND_NAME: Record<string, string> = { glucose: 'גלוקוז', protein: 'חלבון', iron: 'ברזל' };

/** antigen families, as the interface names them */
export const FAMILY_NAME: Record<string, string> = {
  staph: 'סטפילוקוק',
  bacillus: 'בצילוס',
  enteric: 'חיידקי מעיים',
  spiro: 'ספירוכטות',
  pneumo: 'פנאומוקוק',
  strep: 'סטרפטוקוק',
  clostridium: 'קלוסטרידיום',
};

export const nameOf = (id: string): string => NAMES[id] ?? id;
