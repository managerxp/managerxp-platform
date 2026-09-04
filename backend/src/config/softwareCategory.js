/*
 * Resolving a title's category for one branch.
 *
 * The category a branch sees is its own override if it set one, otherwise the
 * published default on software_master. That rule is used in six different
 * queries — the catalogue list, the category list, a single title, the price
 * master, the session pricing engine and the rate preview — and if any one of
 * them resolved it differently, a station would be offered prices that the
 * engine then refused as the wrong category for that station.
 *
 * So it lives here once, as SQL both sides share, rather than as six
 * hand-written COALESCEs that drift.
 */

/**
 * A LEFT JOIN onto this branch's overrides.
 *
 * `$${n}` is the cafe_id parameter position in the caller's query. Joining on
 * the parameter rather than filtering afterwards keeps it a true LEFT JOIN:
 * titles this branch has never re-filed still come back, carrying the
 * published default.
 */
export const categoryJoin = (paramIndex, softwareAlias = 'sm') =>
  `LEFT JOIN software_category_overrides sco
     ON sco.software_id = ${softwareAlias}.software_id
    AND sco.cafe_id = $${paramIndex}`;

/** The resolved category expression to select. */
export const categoryExpr = (softwareAlias = 'sm') =>
  `COALESCE(NULLIF(sco.category, ''), ${softwareAlias}.category)`;

/** True when this branch has filed the title somewhere of its own. */
export const categoryIsOverridden = () => `(NULLIF(sco.category, '') IS NOT NULL)`;

export default { categoryJoin, categoryExpr, categoryIsOverridden };
