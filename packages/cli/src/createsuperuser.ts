import { columnFor } from "@clango/core";

/** Options for {@link buildSuperuserSql}. */
export interface SuperuserSqlOptions {
  /** Table name of the framework user model. */
  readonly table: string;
  readonly id: string;
  readonly email: string;
  readonly now: Date;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Builds the statement that appoints a superuser by email.
 *
 * Addressed by email rather than by an identity id so the appointment can be made before the person
 * has ever signed in: the authorization layer links the row to the provider's id on first
 * authenticated request (D-035). Upserting keeps the command idempotent.
 */
export function buildSuperuserSql(options: SuperuserSqlOptions): string {
  const table = `"${options.table}"`;
  const email = columnFor("email");
  const isStaff = columnFor("isStaff");
  const isSuperuser = columnFor("isSuperuser");
  const now = options.now.getTime();

  return (
    `INSERT INTO ${table} ("id", "created_at", "updated_at", "${email}", "${isStaff}", "${isSuperuser}") ` +
    `VALUES (${quote(options.id)}, ${now}, ${now}, ${quote(options.email)}, 1, 1) ` +
    `ON CONFLICT("${email}") DO UPDATE SET "${isStaff}" = 1, "${isSuperuser}" = 1, "updated_at" = ${now};`
  );
}
