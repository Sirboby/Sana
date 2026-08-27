import type {
  AllergyCrossReference,
  ConditionContraindication,
  DrugCatalog,
  DrugInteraction,
  Facility,
  RulepackDocument,
} from '../../schemas';
import { db } from '../schema';

/**
 * Public reference data (PRD §6.3, §6.4).
 *
 * Three things make this repository different from the entity ones:
 *
 * 1. NOT ENCRYPTED. This data is identical for every user and discloses nothing
 *    about this one. Encrypting it would break offline search — the §6.4 indexes
 *    on `generic_name`, `*brand_names` and `*drug_classes` are what make the
 *    drug picker usable without a connection, and an encrypted column cannot be
 *    indexed.
 *
 * 2. NO OUTBOX. Reference data flows server -> device only (§7.4). There is no
 *    user mutation to queue, and no write path from here to the server.
 *
 * 3. READABLE WHILE LOCKED. Nothing here needs the data key, so the drug catalog
 *    and rulepack stay available before unlock. Step 7's red-flag engine depends
 *    on that: it must work on a device whose store has not been unlocked.
 */

export const referenceRepository = {
  async replaceDrugCatalog(rows: DrugCatalog[]): Promise<void> {
    await db.drug_catalog.bulkPut(rows);
  },

  async replaceInteractions(rows: DrugInteraction[]): Promise<void> {
    await db.interactions.bulkPut(rows);
  },

  async replaceCrossReference(rows: AllergyCrossReference[]): Promise<void> {
    await db.cross_reference.bulkPut(rows);
  },

  async replaceContraindications(
    rows: ConditionContraindication[],
  ): Promise<void> {
    await db.contraindications.bulkPut(rows);
  },

  async replaceFacilities(rows: Facility[]): Promise<void> {
    await db.facilities.bulkPut(rows);
  },

  /** Stored by version; §6.4 keys this table on `version`. */
  async putRulepack(document: RulepackDocument): Promise<void> {
    await db.rulepack.put(document);
  },

  async getRulepack(version: string): Promise<RulepackDocument | null> {
    return (await db.rulepack.get(version)) ?? null;
  },

  async searchDrugsByGenericName(
    prefix: string,
    limit = 20,
  ): Promise<DrugCatalog[]> {
    return db.drug_catalog
      .where('generic_name')
      .startsWithIgnoreCase(prefix)
      .limit(limit)
      .toArray();
  },

  async searchDrugsByBrand(brand: string, limit = 20): Promise<DrugCatalog[]> {
    return db.drug_catalog
      .where('brand_names')
      .equalsIgnoreCase(brand)
      .limit(limit)
      .toArray();
  },

  async getDrugById(id: string): Promise<DrugCatalog | null> {
    return (await db.drug_catalog.get(id)) ?? null;
  },

  async countDrugs(): Promise<number> {
    return db.drug_catalog.count();
  },
};
