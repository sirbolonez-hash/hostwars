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
  unit_col_feeder: 'מזין',
  unit_col_coccus: 'קוקוס',
  unit_col_flagellate: 'דגלון',
  unit_col_spirochete: 'ספירוכטה',
  unit_col_strep: 'שרשרת',
  unit_col_toxin: 'מייצר רעלן',
  bld_wl_lymphnode: 'צומת לימפה',
  bld_col_biofilm_core: 'ליבת ביופילם',
};

export const nameOf = (id: string): string => NAMES[id] ?? id;
