import { maskComments } from "@/shared/lib/utils";
import { wordAt, type DocEntry, type DocResolver } from "./doc-hover";

/** Keywords and built-in functions common to both SQL dialects this app
 *  connects to (see `DIALECTS` in `sql-lint.ts`) — SQLite and Postgres.
 *  Keyed uppercase; lookup uppercases the hovered word, since SQL keywords
 *  are case-insensitive. Not exhaustive of either dialect's full grammar —
 *  covers the clauses/functions someone writing everyday queries in this
 *  console actually runs into, same "useful, not complete" scope as the
 *  rest of this editor's lint/completion helpers. */
export const SQL_DOCS: Record<string, DocEntry> = {
  SELECT: {
    name: "SELECT",
    signature: "SELECT [DISTINCT] column, ... FROM table",
    summary: "Chooses which columns (or expressions) a query returns.",
    description:
      "Starts every read query. Lists the columns or expressions to return — `*` for all columns, or a comma-separated list. Combine with `FROM` to pick the table, `WHERE` to filter rows, and `DISTINCT` to drop duplicate result rows.",
    examples: [
      "SELECT * FROM users;",
      "SELECT id, email FROM users WHERE active = true;",
      "SELECT DISTINCT country FROM users;",
    ],
  },
  FROM: {
    name: "FROM",
    signature: "SELECT ... FROM table [alias]",
    summary: "Names the table (or joined tables) a query reads from.",
    description:
      "Follows the column list in a `SELECT`, and precedes any `JOIN`s. An alias given here (`FROM users u`) can then be used to qualify column names elsewhere in the same statement.",
    examples: [
      "SELECT u.id FROM users u WHERE u.active = true;",
      "SELECT * FROM orders;",
    ],
  },
  WHERE: {
    name: "WHERE",
    signature: "... WHERE condition",
    summary: "Filters rows before they're returned/updated/deleted.",
    description:
      "Applies a boolean condition to each row; only rows where it evaluates true are kept. Works the same way in `SELECT`, `UPDATE`, and `DELETE`. Combine conditions with `AND`/`OR`, and use `IN`/`BETWEEN`/`LIKE`/`IS NULL` for common comparisons.",
    examples: [
      "SELECT * FROM orders WHERE status = 'pending';",
      "DELETE FROM sessions WHERE expires_at < now();",
      "SELECT * FROM users WHERE age BETWEEN 18 AND 30;",
    ],
  },
  JOIN: {
    name: "JOIN",
    signature: "... JOIN other_table ON condition",
    summary: "Combines rows from two tables that satisfy a condition.",
    description:
      "Shorthand for `INNER JOIN` — only rows with a match on both sides survive. Use `LEFT JOIN` to also keep unmatched rows from the left table (with NULLs for the right side's columns).",
    examples: [
      "SELECT o.id, u.email\nFROM orders o\nJOIN users u ON u.id = o.user_id;",
      "SELECT p.name, c.name AS category\nFROM products p\nJOIN categories c ON c.id = p.category_id;",
    ],
  },
  INNER: {
    name: "INNER JOIN",
    signature: "... INNER JOIN other_table ON condition",
    summary: "Explicit form of JOIN — only rows matching on both sides.",
    description:
      "Identical to a bare `JOIN`; spelling it out is purely a style choice some teams prefer for clarity next to `LEFT`/`RIGHT` joins in the same query.",
    examples: [
      "SELECT o.id\nFROM orders o\nINNER JOIN users u ON u.id = o.user_id;",
    ],
  },
  LEFT: {
    name: "LEFT JOIN",
    signature: "... LEFT JOIN other_table ON condition",
    summary: "Keeps every row from the left table, matched or not.",
    description:
      'Like `JOIN`, but rows from the left (first) table with no match on the right are still included — the right table\'s columns come back as NULL for those rows. Common for "all X, with their Y if any" queries.',
    examples: [
      "SELECT u.email, o.id AS order_id\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id;",
    ],
  },
  GROUP: {
    name: "GROUP BY",
    signature: "... GROUP BY column, ...",
    summary: "Collapses rows sharing the same value(s) into one row each.",
    description:
      "Used with aggregate functions (`COUNT`, `SUM`, `AVG`, ...) — every non-aggregated column in `SELECT` must appear in `GROUP BY`. Filter the resulting groups with `HAVING`, not `WHERE` (which filters rows before grouping).",
    examples: [
      "SELECT status, COUNT(*) FROM orders GROUP BY status;",
      "SELECT user_id, SUM(total) AS spent\nFROM orders\nGROUP BY user_id\nHAVING SUM(total) > 100;",
    ],
  },
  ORDER: {
    name: "ORDER BY",
    signature: "... ORDER BY column [ASC|DESC], ...",
    summary: "Sorts the result set.",
    description:
      "Sorts by one or more columns/expressions, ascending by default (`ASC`); use `DESC` for descending. Multiple keys break ties in the order listed.",
    examples: [
      "SELECT * FROM users ORDER BY created_at DESC;",
      "SELECT * FROM orders ORDER BY status ASC, created_at DESC;",
    ],
  },
  HAVING: {
    name: "HAVING",
    signature: "... GROUP BY ... HAVING condition",
    summary: "Filters grouped rows, after aggregation (unlike WHERE).",
    description:
      "Runs after `GROUP BY` has collapsed rows and aggregate functions have been computed, so it can reference `COUNT(*)`, `SUM(...)`, etc. directly — `WHERE` can't, since those values don't exist yet at that stage.",
    examples: [
      "SELECT user_id, COUNT(*) FROM orders\nGROUP BY user_id\nHAVING COUNT(*) > 5;",
    ],
  },
  LIMIT: {
    name: "LIMIT",
    signature: "... LIMIT n [OFFSET m]",
    summary: "Caps how many rows a query returns.",
    description:
      "Truncates the result set to at most `n` rows, applied after sorting. Pair with `OFFSET` to skip the first `m` rows — the usual way to paginate a result set.",
    examples: [
      "SELECT * FROM users ORDER BY id LIMIT 20;",
      "SELECT * FROM users ORDER BY id LIMIT 20 OFFSET 40;",
    ],
  },
  OFFSET: {
    name: "OFFSET",
    signature: "... LIMIT n OFFSET m",
    summary: "Skips the first m rows of the (sorted) result set.",
    description:
      "Almost always paired with `LIMIT` for pagination — without an `ORDER BY`, which rows get skipped is not guaranteed to be stable across runs.",
    examples: ["SELECT * FROM users ORDER BY id LIMIT 20 OFFSET 40;"],
  },
  INSERT: {
    name: "INSERT INTO",
    signature: "INSERT INTO table (col, ...) VALUES (val, ...)",
    summary: "Adds one or more new rows to a table.",
    description:
      "Column list is optional (defaults to the table's full column order) but recommended — it keeps the statement correct if the table's shape ever changes. Provide several parenthesized value groups to insert multiple rows in one statement.",
    examples: [
      "INSERT INTO users (name, email) VALUES ('Ada', 'ada@example.com');",
      "INSERT INTO users (name, email) VALUES\n  ('Ada', 'ada@example.com'),\n  ('Grace', 'grace@example.com');",
    ],
  },
  VALUES: {
    name: "VALUES",
    signature: "INSERT INTO table (...) VALUES (val, ...), ...",
    summary: "Supplies the literal row(s) an INSERT writes.",
    description:
      "One parenthesized, comma-separated list of values per row, in the same order as the column list before it.",
    examples: ["INSERT INTO tags (name) VALUES ('urgent'), ('follow-up');"],
  },
  UPDATE: {
    name: "UPDATE",
    signature: "UPDATE table SET col = val, ... [WHERE condition]",
    summary: "Modifies existing rows in a table.",
    description:
      "Without a `WHERE` clause this updates every row in the table — almost always meant to be paired with one. `SET` can reference the row's own current values (`SET count = count + 1`).",
    examples: [
      "UPDATE users SET active = false WHERE last_login < '2024-01-01';",
      "UPDATE products SET stock = stock - 1 WHERE id = 42;",
    ],
  },
  SET: {
    name: "SET",
    signature: "UPDATE table SET col = val, ...",
    summary: "Lists the column assignments an UPDATE applies.",
    description:
      "Comma-separated `column = expression` pairs; each expression can reference other columns on the same row, including the column being assigned.",
    examples: [
      "UPDATE orders SET status = 'shipped', shipped_at = now()\nWHERE id = 1;",
    ],
  },
  DELETE: {
    name: "DELETE FROM",
    signature: "DELETE FROM table [WHERE condition]",
    summary: "Removes rows from a table.",
    description:
      "Without a `WHERE` clause this deletes every row in the table. There's no undo once it commits, so double-check the filter (or run the equivalent `SELECT` first) before running it.",
    examples: ["DELETE FROM sessions WHERE expires_at < now();"],
  },
  CREATE: {
    name: "CREATE TABLE",
    signature: "CREATE TABLE [IF NOT EXISTS] table (col type, ...)",
    summary: "Defines a new table and its columns.",
    description:
      "Each column gets a name, a type, and optional constraints (`PRIMARY KEY`, `NOT NULL`, `UNIQUE`, `DEFAULT ...`, `REFERENCES other_table(col)`). `IF NOT EXISTS` makes the statement a no-op instead of erroring when the table's already there.",
    examples: [
      "CREATE TABLE IF NOT EXISTS users (\n  id INTEGER PRIMARY KEY,\n  email TEXT NOT NULL UNIQUE,\n  created_at TIMESTAMP DEFAULT now()\n);",
    ],
  },
  ALTER: {
    name: "ALTER TABLE",
    signature: "ALTER TABLE table ADD COLUMN col type",
    summary: "Changes an existing table's structure.",
    description:
      "Most commonly `ADD COLUMN`, `DROP COLUMN`, or `RENAME COLUMN ... TO ...`. Exactly which forms are supported (and how well large tables handle it) varies by dialect/engine.",
    examples: ["ALTER TABLE users ADD COLUMN last_login TIMESTAMP;"],
  },
  DROP: {
    name: "DROP TABLE",
    signature: "DROP TABLE [IF EXISTS] table",
    summary: "Permanently deletes a table and all its data.",
    description:
      "Irreversible — every row and the table definition itself are gone once this commits. `IF EXISTS` avoids an error when the table's already absent.",
    examples: ["DROP TABLE IF EXISTS temp_import;"],
  },
  DISTINCT: {
    name: "DISTINCT",
    signature: "SELECT DISTINCT column, ...",
    summary: "Removes duplicate rows from the result set.",
    description:
      "Applies to the whole selected row, not a single column — `SELECT DISTINCT a, b` keeps unique `(a, b)` pairs, not unique `a` values with an arbitrary `b`.",
    examples: ["SELECT DISTINCT country FROM users;"],
  },
  UNION: {
    name: "UNION",
    signature: "query1 UNION [ALL] query2",
    summary: "Stacks the results of two queries into one result set.",
    description:
      "Both queries need the same number of columns with compatible types. Plain `UNION` also de-duplicates rows across the combined set (an implicit `DISTINCT`) — use `UNION ALL` to keep every row, including duplicates, which is also faster since it skips that de-duplication pass.",
    examples: [
      "SELECT email FROM users\nUNION ALL\nSELECT email FROM archived_users;",
    ],
  },
  WITH: {
    name: "WITH (CTE)",
    signature: "WITH name AS (query) SELECT ... FROM name",
    summary: "Names a subquery so it can be referenced like a table.",
    description:
      "A Common Table Expression — runs the inner query once and lets the rest of the statement refer to it by name, which is often clearer than nesting the same subquery inline (or repeating it).",
    examples: [
      "WITH big_spenders AS (\n  SELECT user_id, SUM(total) AS spent FROM orders GROUP BY user_id\n)\nSELECT * FROM big_spenders WHERE spent > 500;",
    ],
  },
  CASE: {
    name: "CASE",
    signature: "CASE WHEN cond THEN val ... [ELSE val] END",
    summary: "Inline if/else branching inside an expression.",
    description:
      "Evaluates each `WHEN` in order and returns the first matching `THEN` value; `ELSE` covers everything else (defaults to NULL if omitted). Usable anywhere an expression is — a `SELECT` column, a `WHERE` condition, an `ORDER BY` key.",
    examples: [
      "SELECT id,\n  CASE WHEN total > 100 THEN 'large' ELSE 'small' END AS size\nFROM orders;",
    ],
  },
  AND: {
    name: "AND",
    signature: "condition1 AND condition2",
    summary: "Both conditions must be true.",
    description:
      "Standard boolean AND — combines two conditions in a `WHERE`/`HAVING`/`ON` clause; the row only matches if both sides are true.",
    examples: ["SELECT * FROM users WHERE active = true AND age >= 18;"],
  },
  OR: {
    name: "OR",
    signature: "condition1 OR condition2",
    summary: "Either condition may be true.",
    description:
      "Standard boolean OR. Lower precedence than `AND` — `a AND b OR c` means `(a AND b) OR c`, so wrap in parentheses whenever mixing the two to make the intended grouping explicit.",
    examples: [
      "SELECT * FROM orders WHERE status = 'pending' OR status = 'failed';",
    ],
  },
  IN: {
    name: "IN",
    signature: "column IN (val, ...) — or IN (subquery)",
    summary: "Matches if the value is one of a set.",
    description:
      "Shorthand for a chain of `= ... OR = ...`. The set can be a literal list or a subquery that returns one column.",
    examples: [
      "SELECT * FROM orders WHERE status IN ('pending', 'processing');",
      "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 1000);",
    ],
  },
  BETWEEN: {
    name: "BETWEEN",
    signature: "column BETWEEN low AND high",
    summary: "Matches if the value falls in an inclusive range.",
    description:
      "Equivalent to `column >= low AND column <= high` — both endpoints are included.",
    examples: [
      "SELECT * FROM orders WHERE created_at BETWEEN '2024-01-01' AND '2024-01-31';",
    ],
  },
  LIKE: {
    name: "LIKE",
    signature: "column LIKE 'pattern'",
    summary: "Pattern-matches text — % for any run of characters, _ for one.",
    description:
      "Case sensitivity depends on the engine/collation. `%` matches zero or more characters, `_` matches exactly one — so `'A%'` means \"starts with A\" and `'%foo%'` means \"contains foo\".",
    examples: ["SELECT * FROM users WHERE email LIKE '%@gmail.com';"],
  },
  NULL: {
    name: "IS NULL / IS NOT NULL",
    signature: "column IS [NOT] NULL",
    summary: "Tests for a missing value — never use = NULL.",
    description:
      "NULL isn't equal to anything, including itself, so `column = NULL` never matches (in any dialect) — `IS NULL`/`IS NOT NULL` are the only correct way to test for it.",
    examples: ["SELECT * FROM users WHERE deleted_at IS NULL;"],
  },
  AS: {
    name: "AS",
    signature: "expression AS alias",
    summary: "Names a column, expression, or table for the rest of the query.",
    description:
      "Optional in most dialects (`SELECT count(*) total` works the same as `SELECT count(*) AS total`), but spelling it out is usually clearer, especially next to a table alias.",
    examples: [
      "SELECT COUNT(*) AS total FROM orders;",
      "SELECT * FROM users AS u;",
    ],
  },
  ON: {
    name: "ON",
    signature: "... JOIN table ON condition",
    summary: "The condition a JOIN matches rows by.",
    description:
      "Almost always an equality between a column on each side (`u.id = o.user_id`), but can be any boolean expression.",
    examples: ["... JOIN orders o ON o.user_id = u.id AND o.status = 'paid'"],
  },

  // ---- functions -----------------------------------------------------------
  COUNT: {
    name: "COUNT()",
    signature: "COUNT(*) — or COUNT(column)",
    summary: "Counts rows (or non-NULL values in a column).",
    description:
      "`COUNT(*)` counts every row in the group; `COUNT(column)` counts only rows where that column isn't NULL. Add `DISTINCT` inside to count unique values: `COUNT(DISTINCT column)`.",
    examples: [
      "SELECT COUNT(*) FROM orders;",
      "SELECT status, COUNT(*) FROM orders GROUP BY status;",
    ],
  },
  SUM: {
    name: "SUM()",
    signature: "SUM(column)",
    summary: "Adds up a numeric column across the group.",
    description:
      "NULLs are ignored, not treated as zero. Returns NULL (not 0) if every input value was NULL or the group is empty.",
    examples: ["SELECT user_id, SUM(total) FROM orders GROUP BY user_id;"],
  },
  AVG: {
    name: "AVG()",
    signature: "AVG(column)",
    summary: "Averages a numeric column across the group.",
    description:
      "NULLs are excluded from both the sum and the count used to compute the average.",
    examples: ["SELECT AVG(total) FROM orders WHERE status = 'completed';"],
  },
  MIN: {
    name: "MIN()",
    signature: "MIN(column)",
    summary: "Smallest value in the group — works on numbers, text, and dates.",
    description:
      'For text, "smallest" follows the collation\'s sort order; for dates, the earliest.',
    examples: ["SELECT MIN(created_at) FROM users;"],
  },
  MAX: {
    name: "MAX()",
    signature: "MAX(column)",
    summary: "Largest value in the group — works on numbers, text, and dates.",
    description:
      'For text, "largest" follows the collation\'s sort order; for dates, the latest.',
    examples: ["SELECT MAX(created_at) FROM users;"],
  },
  COALESCE: {
    name: "COALESCE()",
    signature: "COALESCE(val1, val2, ...)",
    summary: "Returns the first argument that isn't NULL.",
    description:
      "Common for supplying a fallback/default value in place of a NULL column.",
    examples: [
      "SELECT COALESCE(nickname, name, 'Anonymous') AS display_name FROM users;",
    ],
  },
  CAST: {
    name: "CAST()",
    signature: "CAST(expression AS type)",
    summary: "Converts a value to a different type.",
    description:
      "Fails (or produces NULL, depending on the engine) if the value can't be meaningfully converted, e.g. casting non-numeric text to an integer.",
    examples: ["SELECT CAST(id AS TEXT) FROM users;"],
  },
  UPPER: {
    name: "UPPER()",
    signature: "UPPER(text)",
    summary: "Converts text to uppercase.",
    description:
      "Useful for case-insensitive comparisons: `WHERE UPPER(email) = UPPER($1)`.",
    examples: ["SELECT UPPER(name) FROM users;"],
  },
  LOWER: {
    name: "LOWER()",
    signature: "LOWER(text)",
    summary: "Converts text to lowercase.",
    description:
      "Useful for case-insensitive comparisons: `WHERE LOWER(email) = LOWER($1)`.",
    examples: ["SELECT * FROM users WHERE LOWER(email) = 'ada@example.com';"],
  },
  LENGTH: {
    name: "LENGTH()",
    signature: "LENGTH(text)",
    summary:
      "Number of characters (or bytes, depending on dialect) in a string.",
    description:
      "Also works on binary/blob columns in some dialects, where it reports byte length rather than character count.",
    examples: ["SELECT * FROM users WHERE LENGTH(password_hash) < 20;"],
  },
  TRIM: {
    name: "TRIM()",
    signature: "TRIM(text)",
    summary: "Strips leading and trailing whitespace.",
    description:
      "Some dialects accept a second argument naming a different character to strip instead of whitespace.",
    examples: ["UPDATE users SET name = TRIM(name);"],
  },
  ROUND: {
    name: "ROUND()",
    signature: "ROUND(number, decimals?)",
    summary: "Rounds a number to the given number of decimal places.",
    description:
      "`decimals` defaults to 0 (round to the nearest whole number) when omitted.",
    examples: ["SELECT ROUND(AVG(total), 2) FROM orders;"],
  },
  CONCAT: {
    name: "CONCAT() / ||",
    signature: "CONCAT(a, b, ...) — or a || b",
    summary: "Joins strings together.",
    description:
      "Postgres and SQLite both also support the `||` operator for the same thing; `CONCAT()` is the more portable spelling across engines.",
    examples: [
      "SELECT first_name || ' ' || last_name AS full_name FROM users;",
    ],
  },
};

/** Resolves a hover position to a documented SQL keyword/function — matches
 *  a whole `[\w$]` word (case-insensitively) against `SQL_DOCS`. Runs
 *  against a comment-masked copy of the text (see `maskComments`) so
 *  hovering a keyword mentioned inside a commented-out line doesn't pop up
 *  a tooltip for it. */
export const resolveSqlDoc: DocResolver = (doc, pos) => {
  const masked = maskComments(doc);
  const w = wordAt(masked, pos);
  if (!w) return null;
  const entry = SQL_DOCS[w.text.toUpperCase()];
  if (!entry) return null;
  return { entry, from: w.from, to: w.to };
};
