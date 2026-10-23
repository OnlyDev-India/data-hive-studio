//! Plans the schema designer's ops as MySQL statements (spec 0025 AC-18,
//! AC-19): every change to one table folds into a single `ALTER TABLE`, so
//! each table's change is all or nothing. Trigger changes are their own
//! statements, in place. Pure: the caller reads each table's current
//! columns first ([`TableState`]), since `CHANGE COLUMN` must restate the
//! whole column.

use std::collections::HashMap;
use crate::api::{ColumnAttrs, DefaultMode, SchemaOp};
use crate::db::{DbError, DbResult};
use super::connect::Flavor;
use super::sql_text::{charset_name, q, sql_string, tq};

/// One column as `information_schema.COLUMNS` reports it.
#[derive(Debug, Clone, Default)]
pub(super) struct CurrentColumn {
    pub column_type: String,
    pub nullable: bool,
    /// `COLUMN_DEFAULT` as the server gives it (MySQL: the raw value;
    /// MariaDB: already SQL, with `NULL` spelled as text).
    pub default: Option<String>,
    pub extra: String,
    pub comment: String,
    pub collation: Option<String>,
}

/// What the planner needs to know about one table before it changes.
#[derive(Debug, Clone, Default)]
pub(super) struct TableState {
    pub columns: HashMap<String, CurrentColumn>,
    pub has_primary_key: bool,
}

const FK_ACTIONS: [&str; 5] = ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION"];

fn invalid(msg: impl Into<String>) -> DbError {
    DbError::InvalidOperation(msg.into())
}

fn is_text_type(column_type: &str) -> bool {
    let t = column_type.trim_start().to_ascii_lowercase();
    ["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"]
        .iter()
        .any(|p| t.starts_with(p) && t[p.len()..].chars().next().is_none_or(|c| c == '(' || c == ' '))
}

/// The `ON UPDATE` expression in `EXTRA`, if any.
fn on_update_of(extra: &str) -> Option<String> {
    let at = extra.to_ascii_lowercase().find("on update ")?;
    Some(extra[at + "on update ".len()..].trim().to_string()).filter(|s| !s.is_empty())
}

/// A column the server computes (`VIRTUAL` or `STORED`), as opposed to one
/// whose default is an expression (`DEFAULT_GENERATED`).
fn is_generated(extra: &str) -> bool {
    extra.split_whitespace().any(|w| w.eq_ignore_ascii_case("VIRTUAL") || w.eq_ignore_ascii_case("STORED"))
}

/// The current default as a `DEFAULT` clause body, or `None` for none.
fn current_default_sql(flavor: Flavor, col: &CurrentColumn) -> Option<String> {
    let raw = col.default.clone()?;
    if flavor == Flavor::Mariadb {
        return (raw != "NULL").then_some(raw);
    }
    if col.extra.contains("DEFAULT_GENERATED") {
        let upper = raw.to_ascii_uppercase();
        return Some(if upper.starts_with("CURRENT_TIMESTAMP") || upper.starts_with("NOW(") {
            raw
        } else {
            format!("({raw})")
        });
    }
    // A BIT default comes back as its `b'...'` literal.
    if raw.starts_with("b'") && raw.ends_with('\'') {
        return Some(raw);
    }
    Some(sql_string(&raw))
}

/// One full column definition, as `ADD COLUMN` and `CHANGE COLUMN` take it.
struct ColumnDef<'a> {
    name: &'a str,
    column_type: &'a str,
    not_null: bool,
    default: Option<String>,
    auto_increment: bool,
    on_update: Option<String>,
    comment: Option<String>,
    collation: Option<String>,
}

impl ColumnDef<'_> {
    fn sql(&self) -> String {
        let mut s = format!("{} {}", q(self.name), self.column_type.trim());
        if let Some(c) = &self.collation {
            s.push_str(&format!(" COLLATE {c}"));
        }
        s.push_str(if self.not_null { " NOT NULL" } else { " NULL" });
        if let Some(d) = &self.default {
            s.push_str(&format!(" DEFAULT {d}"));
        }
        if self.auto_increment {
            s.push_str(" AUTO_INCREMENT");
        }
        if let Some(u) = &self.on_update {
            s.push_str(&format!(" ON UPDATE {u}"));
        }
        if let Some(c) = self.comment.as_deref().filter(|c| !c.is_empty()) {
            s.push_str(&format!(" COMMENT {}", sql_string(c)));
        }
        s
    }
}

fn nonempty(v: &Option<String>) -> Option<String> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn column_list(cols: &[String]) -> String {
    cols.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ")
}

fn fk_action(word: &str, action: &Option<String>) -> DbResult<String> {
    let Some(a) = nonempty(action) else { return Ok(String::new()) };
    let a = a.to_ascii_uppercase();
    if !FK_ACTIONS.contains(&a.as_str()) {
        return Err(invalid(format!("{a} is not a foreign key action")));
    }
    Ok(format!(" {word} {a}"))
}

/// All the clauses for one table, kept in op order, and its new name.
struct TablePlan {
    table: String,
    clauses: Vec<String>,
    rename_to: Option<String>,
}

enum Step {
    Table(usize),
    Raw(String),
}

#[derive(Default)]
struct Builder {
    plans: Vec<TablePlan>,
    /// Any name a table goes by in this batch (before and after a rename)
    /// to its plan.
    by_name: HashMap<String, usize>,
    steps: Vec<Step>,
}

impl Builder {
    /// The plan for `table`, made (and placed in the run order) the first
    /// time an op names it.
    fn plan_for(&mut self, table: &str) -> usize {
        if let Some(&at) = self.by_name.get(table) {
            return at;
        }
        self.plans.push(TablePlan { table: table.to_string(), clauses: Vec::new(), rename_to: None });
        let at = self.plans.len() - 1;
        self.steps.push(Step::Table(at));
        self.by_name.insert(table.to_string(), at);
        at
    }
}

/// The tables whose current state the plan needs, by the name they have
/// before the batch runs.
pub(super) fn tables_to_read(ops: &[SchemaOp]) -> Vec<String> {
    let mut renamed: HashMap<&str, &str> = HashMap::new();
    let mut out: Vec<String> = Vec::new();
    for op in ops {
        let table = match op {
            SchemaOp::RenameTable { table, new_name } => {
                renamed.insert(new_name, table);
                Some(table.as_str())
            }
            SchemaOp::AddColumn { table, .. }
            | SchemaOp::DropColumn { table, .. }
            | SchemaOp::AlterColumn { table, .. }
            | SchemaOp::CreateIndex { table, .. }
            | SchemaOp::SetPrimaryKey { table, .. }
            | SchemaOp::AddForeignKey { table, .. }
            | SchemaOp::DropConstraint { table, .. }
            | SchemaOp::SetTableOptions { table, .. } => Some(table.as_str()),
            SchemaOp::DropIndex { table, .. } => table.as_deref(),
            SchemaOp::DropTrigger { .. } | SchemaOp::CreateTrigger { .. } => None,
        };
        if let Some(t) = table {
            let t = renamed.get(t).copied().unwrap_or(t).to_string();
            if !out.contains(&t) {
                out.push(t);
            }
        }
    }
    out
}

/// The statements `ops` turn into, in the order they run.
pub(super) fn plan(
    flavor: Flavor,
    db: Option<&str>,
    ops: &[SchemaOp],
    states: &HashMap<String, TableState>,
) -> DbResult<Vec<String>> {
    let mut b = Builder::default();
    for op in ops {
        match op {
            SchemaOp::RenameTable { table, new_name } => {
                let at = b.plan_for(table);
                b.plans[at].rename_to = Some(new_name.clone());
                // Later ops name the table by its new name.
                b.by_name.insert(new_name.clone(), at);
            }
            SchemaOp::AddColumn { table, name, data_type, not_null, default, attrs } => {
                let at = b.plan_for(table);
                let ty = data_type.trim();
                if ty.is_empty() {
                    return Err(invalid(format!("column {name} needs a type")));
                }
                let def = ColumnDef {
                    name,
                    column_type: ty,
                    not_null: *not_null,
                    default: nonempty(default),
                    auto_increment: attrs.auto_increment == Some(true),
                    on_update: nonempty(&attrs.on_update),
                    comment: nonempty(&attrs.comment),
                    collation: None,
                };
                b.plans[at].clauses.push(format!("ADD COLUMN {}", def.sql()));
            }
            SchemaOp::DropColumn { table, name } => {
                let at = b.plan_for(table);
                b.plans[at].clauses.push(format!("DROP COLUMN {}", q(name)));
            }
            SchemaOp::AlterColumn { table, column, new_name, data_type, not_null, default_mode, default_value, attrs } => {
                let at = b.plan_for(table);
                let state_table = b.plans[at].table.clone();
                let cur = states
                    .get(&state_table)
                    .and_then(|s| s.columns.get(column))
                    .ok_or_else(|| invalid(format!("column {column} was not found on {state_table}")))?;
                b.plans[at].clauses.push(change_column(flavor, column, cur, new_name, data_type, not_null, default_mode, default_value, attrs)?);
            }
            SchemaOp::CreateIndex { table, name, columns, unique, .. } => {
                if columns.is_empty() {
                    return Err(invalid(format!("index {name} needs at least one column")));
                }
                let at = b.plan_for(table);
                let kind = if *unique { "UNIQUE INDEX" } else { "INDEX" };
                b.plans[at].clauses.push(format!("ADD {kind} {} ({})", q(name), column_list(columns)));
            }
            SchemaOp::DropIndex { table, index } => {
                let table = table.as_deref().ok_or_else(|| invalid("MySQL needs the table an index belongs to"))?;
                let at = b.plan_for(table);
                b.plans[at].clauses.push(format!("DROP INDEX {}", q(index)));
            }
            SchemaOp::SetPrimaryKey { table, columns } => {
                let at = b.plan_for(table);
                if states.get(&b.plans[at].table).is_some_and(|s| s.has_primary_key) {
                    b.plans[at].clauses.push("DROP PRIMARY KEY".into());
                }
                if !columns.is_empty() {
                    b.plans[at].clauses.push(format!("ADD PRIMARY KEY ({})", column_list(columns)));
                }
            }
            SchemaOp::AddForeignKey { table, columns, ref_table, ref_columns, on_delete, on_update } => {
                let at = b.plan_for(table);
                b.plans[at].clauses.push(format!(
                    "ADD FOREIGN KEY ({}) REFERENCES {} ({}){}{}",
                    column_list(columns),
                    q(ref_table),
                    column_list(ref_columns),
                    fk_action("ON DELETE", on_delete)?,
                    fk_action("ON UPDATE", on_update)?,
                ));
            }
            SchemaOp::DropConstraint { table, name } => {
                let at = b.plan_for(table);
                b.plans[at].clauses.push(format!("DROP FOREIGN KEY {}", q(name)));
            }
            SchemaOp::SetTableOptions { table, charset, collation, comment } => {
                let at = b.plan_for(table);
                for (word, value) in [("CHARACTER SET", charset), ("COLLATE", collation)] {
                    if let Some(v) = nonempty(value) {
                        let v = charset_name(&v).ok_or_else(|| invalid(format!("{v:?} is not a charset or collation name")))?;
                        b.plans[at].clauses.push(format!("{word} {v}"));
                    }
                }
                if let Some(c) = comment {
                    b.plans[at].clauses.push(format!("COMMENT = {}", sql_string(c)));
                }
            }
            SchemaOp::DropTrigger { name } => b.steps.push(Step::Raw(format!("DROP TRIGGER {}", tq(db, name)))),
            SchemaOp::CreateTrigger { sql } => {
                let sql = sql.trim().trim_end_matches(';').trim_end();
                if sql.is_empty() {
                    return Err(invalid("a trigger needs its CREATE TRIGGER statement"));
                }
                b.steps.push(Step::Raw(sql.to_string()));
            }
        }
    }

    let Builder { plans, steps, .. } = b;
    Ok(steps
        .into_iter()
        .filter_map(|step| match step {
            Step::Raw(sql) => Some(sql),
            Step::Table(at) => {
                let p = &plans[at];
                let mut clauses = p.clauses.clone();
                if let Some(to) = &p.rename_to {
                    clauses.push(format!("RENAME TO {}", tq(db, to)));
                }
                (!clauses.is_empty()).then(|| format!("ALTER TABLE {} {}", tq(db, &p.table), clauses.join(", ")))
            }
        })
        .collect())
}

/// `CHANGE COLUMN` restating the whole column: what changed, and the rest
/// as it is now, so nothing (a comment, `ON UPDATE`, a collation) is lost.
#[allow(clippy::too_many_arguments)]
fn change_column(
    flavor: Flavor,
    column: &str,
    cur: &CurrentColumn,
    new_name: &Option<String>,
    data_type: &Option<String>,
    not_null: &Option<bool>,
    default_mode: &Option<DefaultMode>,
    default_value: &Option<String>,
    attrs: &ColumnAttrs,
) -> DbResult<String> {
    if is_generated(&cur.extra) {
        return Err(invalid(format!(
            "{column} is a generated column. Change it in a SQL tab with its expression."
        )));
    }
    let column_type = data_type.as_deref().map(str::trim).filter(|t| !t.is_empty()).unwrap_or(&cur.column_type);
    let type_changed = column_type != cur.column_type;
    let default = match default_mode {
        Some(DefaultMode::Drop) => None,
        Some(DefaultMode::Set) => nonempty(default_value),
        Some(DefaultMode::Keep) | None => current_default_sql(flavor, cur),
    };
    let on_update = match &attrs.on_update {
        Some(u) => nonempty(&Some(u.clone())),
        None => on_update_of(&cur.extra),
    };
    let comment = match &attrs.comment {
        Some(c) => Some(c.clone()),
        None => Some(cur.comment.clone()),
    };
    // A changed type takes the table's collation, like a new column; an
    // unchanged text column keeps its own.
    let collation = (!type_changed && is_text_type(column_type)).then(|| cur.collation.clone()).flatten();
    let def = ColumnDef {
        name: new_name.as_deref().map(str::trim).filter(|n| !n.is_empty()).unwrap_or(column),
        column_type,
        not_null: not_null.unwrap_or(!cur.nullable),
        default,
        auto_increment: attrs.auto_increment.unwrap_or_else(|| cur.extra.to_ascii_lowercase().contains("auto_increment")),
        on_update,
        comment,
        collation,
    };
    Ok(format!("CHANGE COLUMN {} {}", q(column), def.sql()))
}

#[cfg(test)]
#[path = "schema_plan_tests.rs"]
mod tests;
