import {
  type Allergy,
  AllergySchema,
  type Condition,
  ConditionSchema,
  type Medication,
  MedicationSchema,
  type Person,
  PersonSchema,
  type UserFacility,
  UserFacilitySchema,
} from '../../schemas';
import { type EntityRepository, createEntityRepository } from './base';

/**
 * Current-state entity repositories (PRD §6.4).
 *
 * The encrypted-field list is exactly the §14 decision-1 set: content columns
 * are encrypted, indexed and structural columns are not. Adding a field here
 * that §6.4 indexes would break the query that depends on it.
 */

export const personsRepository: EntityRepository<Person> =
  createEntityRepository<Person>({
    tableName: 'persons',
    schema: PersonSchema,
    // date_of_birth and weight_kg are encrypted as content, not because they are
    // indexed — neither is. Both are directly identifying health attributes.
    encryptedFields: ['display_name', 'date_of_birth', 'weight_kg'],
  });

export const allergiesRepository: EntityRepository<Allergy> =
  createEntityRepository<Allergy>({
    tableName: 'allergies',
    schema: AllergySchema,
    // NOTE: allergen_type, severity and drug_classes stay plaintext — the
    // screening engine (§5.1) matches on drug_classes, so encrypting it would
    // make cross-class allergy detection impossible offline. The label and notes,
    // which are what actually name the allergy, are encrypted.
    encryptedFields: ['allergen_label', 'notes'],
  });

export const conditionsRepository: EntityRepository<Condition> =
  createEntityRepository<Condition>({
    tableName: 'conditions',
    schema: ConditionSchema,
    encryptedFields: ['condition_label', 'notes'],
  });

export const medicationsRepository: EntityRepository<Medication> =
  createEntityRepository<Medication>({
    tableName: 'medications',
    schema: MedicationSchema,
    // dose_amount and dose_unit are encrypted per §14 decision 1. `schedule`
    // is not in that list and stays plaintext — step 11's reminder scheduler
    // must read it while the store is locked to fire a notification.
    encryptedFields: ['display_name', 'notes', 'dose_amount', 'dose_unit'],
  });

/**
 * A user's saved facilities.
 *
 * DEVIATION WORTH FLAGGING: §14 decision 1 does not list any user_facilities
 * column as encrypted, so none are, and this repository stores its rows in
 * plaintext. That is implemented as specified — but "the hospital this person
 * goes to" is arguably disclosive, and `label` and `address` are content columns
 * that nothing indexes. Raised in the step 4 handoff rather than changed here,
 * since the encrypted-field list is a stated decision and not mine to widen.
 */
export const userFacilitiesRepository: EntityRepository<UserFacility> =
  createEntityRepository<UserFacility>({
    tableName: 'user_facilities',
    schema: UserFacilitySchema,
    encryptedFields: [],
  });
