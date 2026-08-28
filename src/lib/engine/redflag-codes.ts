/**
 * Red-flag symptom vocabulary (PRD §2.3).
 *
 * COMPILED INTO THE BUNDLE. These codes and their labels are part of the
 * application, not the rulepack — §5.4 and AC-6.1.6 require emergency detection
 * to survive a corrupt, stale or missing rulepack, and a vocabulary loaded at
 * runtime would be one more thing that can go missing at the worst moment.
 *
 * One code per distinguishable finding, because the rules are conjunctions over
 * findings. Collapsing "fever" and "rash" into a single "fever with rash" code
 * would make RF007 unable to distinguish the near-miss from the real thing.
 *
 * LABELS ARE FOR A PICKER, not for a clinician. They describe what a person
 * notices, in words they would use — "the side of the face is drooping", not
 * "unilateral facial paresis". §2.2 prohibition 3 also applies: a label states a
 * finding, never a diagnosis.
 */

export const RED_FLAG_SYMPTOMS = {
  SYM_CHEST_PAIN: 'Chest pain, pressure or tightness',
  SYM_BREATHING_DIFFICULTY:
    'Difficulty breathing, or breathlessness while resting',
  SYM_FACE_DROOP: 'One side of the face is drooping',
  SYM_ARM_WEAKNESS: 'Weakness in one arm, or one arm drifts down',
  SYM_SPEECH_DIFFICULTY: 'Slurred speech, or trouble finding words',
  SYM_SEVERE_BLEEDING: 'Heavy bleeding that will not stop',
  SYM_UNRESPONSIVE: 'Fainting, or not responding when spoken to',
  SYM_SEIZURE: 'A seizure or fit',
  SYM_STIFF_NECK: 'A stiff neck that hurts to bend forward',
  SYM_RASH: 'A new rash',
  SYM_FEVER: 'Fever, or feeling very hot',
  SYM_ABDO_PAIN: 'Severe stomach pain',
  SYM_ABDO_RIGID: 'The stomach is hard or board-like to touch',
  SYM_FACE_SWELLING: 'Swelling of the face, lips, tongue or throat',
  SYM_HIVES: 'Widespread hives or welts on the skin',
  SYM_SUICIDAL_IDEATION: 'Thoughts of ending your life, or of harming yourself',
  SYM_SUSPECTED_OVERDOSE: 'Swallowed too much medicine, or something poisonous',
  SYM_VAGINAL_BLEEDING: 'Bleeding from the vagina during pregnancy',
  SYM_SEVERE_HEADACHE_VISUAL:
    'A severe headache with blurred vision or seeing spots',
  SYM_REDUCED_FETAL_MOVEMENT: 'The baby is moving less than usual',
  SYM_SUNKEN_EYES: 'The eyes look sunken',
  SYM_NO_TEARS: 'Crying without tears',
  SYM_LETHARGY: 'Unusually drowsy, floppy or hard to wake',
  SYM_NO_URINE_8H: 'No urine passed for 8 hours or more',
  SYM_NEW_CONFUSION: 'New confusion, or not knowing where they are',
} as const;

export type RedFlagSymptomCode = keyof typeof RED_FLAG_SYMPTOMS;

export const RED_FLAG_SYMPTOM_CODES = Object.keys(
  RED_FLAG_SYMPTOMS,
) as RedFlagSymptomCode[];

export function labelForSymptom(code: RedFlagSymptomCode): string {
  return RED_FLAG_SYMPTOMS[code];
}

export function isRedFlagSymptomCode(
  value: string,
): value is RedFlagSymptomCode {
  return Object.hasOwn(RED_FLAG_SYMPTOMS, value);
}
