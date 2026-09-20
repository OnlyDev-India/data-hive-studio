use crate::api::{
    MongoDocumentsResult,
    MongoExtDocumentsResult,
    MongoRunResult,
    QueryOp,
    QueryResult,
    SchemaOp,
};
use crate::server::auth::AuthCtx;
use super::{Gateway, op_action};

impl Gateway {
    pub async fn run_sql(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
    ) -> Result<QueryResult, String> {
        // SQL console can contain anything → requires readwrite.
        self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id)
            .await?
            .run_sql(database, schema, sql)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn execute_op(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
    ) -> Result<QueryResult, String> {
        let (_, org_id) = self.authorize(ctx, conn_id, !op.is_read()).await?;
        let outcome = self
            .adapter(conn_id)
            .await?
            .execute_op(database, schema, op)
            .await
            .map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), op_action(op), conn_id, outcome.sql.as_deref()).await?;
        Ok(outcome.result)
    }

    // ---- MongoDB surface -----------------------------------------------
    //
    // Every method below is engine-agnostic on the `Gateway`/`DbAdapter`
    // side (same authorize→adapter→map-err shape as `run_sql`/`execute_op`
    // above) — a non-Mongo adapter just returns its own `InvalidOperation`.
    // These exist so the desktop app's Mongo features (document grid,
    // console, index manager, collection create/drop/rename/duplicate,
    // database switcher) work identically against a shared team-server
    // connection, not just a local one.
    pub async fn list_documents(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> Result<MongoDocumentsResult, String> {
        self.authorize(ctx, conn_id, false).await?;
        let (documents, total) = self
            .adapter(conn_id)
            .await?
            .list_documents(collection, filter, skip, limit)
            .await
            .map_err(|e| e.to_string())?;
        Ok(MongoDocumentsResult { documents, total })
    }

    pub async fn list_documents_ext(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> Result<MongoExtDocumentsResult, String> {
        self.authorize(ctx, conn_id, false).await?;
        let (documents, total) = self
            .adapter(conn_id)
            .await?
            .list_documents_ext(collection, filter, skip, limit)
            .await
            .map_err(|e| e.to_string())?;
        Ok(MongoExtDocumentsResult { documents, total })
    }

    pub async fn save_document(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        collection: &str,
        id: &str,
        document_text: &str,
    ) -> Result<bool, String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        let saved = self
            .adapter(conn_id)
            .await?
            .save_document(collection, id, document_text)
            .await
            .map_err(|e| e.to_string())?;
        self.store
            .audit(ctx, Some(&org_id), "doc.save", conn_id, Some(&format!("{collection}/{id}")))
            .await?;
        Ok(saved)
    }

    pub async fn insert_document(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        collection: &str,
        document_text: &str,
    ) -> Result<(), String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id)
            .await?
            .insert_document(collection, document_text)
            .await
            .map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), "doc.insert", conn_id, Some(collection)).await?;
        Ok(())
    }

    /// Mongo console. Requires readwrite, same reasoning as `run_sql`: the
    /// script is arbitrary free text, so it's treated as a potential write.
    pub async fn run_mongo(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        db: &str,
        collection: Option<&str>,
        script: &str,
    ) -> Result<MongoRunResult, String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        let result = self
            .adapter(conn_id)
            .await?
            .run_mongo(db, collection, script, None)
            .await
            .map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), "mongo.run", conn_id, Some(&result.command)).await?;
        Ok(result)
    }

    pub async fn create_collection(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: Option<&str>,
        name: &str,
    ) -> Result<(), String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id)
            .await?
            .create_collection(database, name)
            .await
            .map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), "collection.create", conn_id, Some(name)).await?;
        Ok(())
    }

    /// Duplicate a table/collection. `copy_data` is Mongo-specific (see the
    /// `DbAdapter::duplicate_table` doc comment) but the op itself is
    /// generic — this is the same method Postgres's future "duplicate with
    /// data" UI will call too.
    pub async fn duplicate_table(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> Result<Vec<String>, String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        let stmts = self
            .adapter(conn_id)
            .await?
            .duplicate_table(database, schema, source, target, copy_data)
            .await
            .map_err(|e| e.to_string())?;
        self.store
            .audit(ctx, Some(&org_id), "collection.duplicate", conn_id, Some(&format!("{source} → {target}")))
            .await?;
        Ok(stmts)
    }

    /// Closes ONE sibling database's own connection right now — the
    /// sidebar's per-database "Disconnect". Shared adapter state (like
    /// `set_active_schema` below), so treated as a write: another caller
    /// currently browsing that same sibling database would have its pool
    /// closed out from under it too (harmless — `pool_for` just reopens it
    /// lazily on the next query — but still a real effect on a shared
    /// resource, not just this caller's own view).
    pub async fn disconnect_database(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: &str,
    ) -> Result<(), String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id)
            .await?
            .disconnect_database(database)
            .await
            .map_err(|e| e.to_string())?;
        self.store
            .audit(ctx, Some(&org_id), "database.disconnect", conn_id, Some(database))
            .await?;
        Ok(())
    }

    /// Switches which database/schema UNQUALIFIED operations on this shared
    /// connection target. This is per-adapter-instance state, not per-caller
    /// — since the gateway pools one adapter per connection id for every
    /// caller, switching it affects every other user of this same shared
    /// connection until someone switches it back. Treated as a write for
    /// that reason (requires update access, same as any other mutation).
    pub async fn set_active_schema(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        schema: &str,
    ) -> Result<(), String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id).await?.set_active_schema(schema).await.map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), "schema.switch", conn_id, Some(schema)).await?;
        Ok(())
    }

    /// Apply staged schema (DDL) ops — collection rename and the full index
    /// manager (create/drop, including TTL/sparse/partial/direction) for
    /// Mongo; the generic SQL DDL surface for other engines.
    pub async fn apply_schema_ops_batch(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> Result<Vec<String>, String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        let stmts = self
            .adapter(conn_id)
            .await?
            .apply_schema_ops_batch(database, schema, ops)
            .await
            .map_err(|e| e.to_string())?;
        if !stmts.is_empty() {
            self.store.audit(ctx, Some(&org_id), "schema_ops", conn_id, Some(&stmts.join(";\n"))).await?;
        }
        Ok(stmts)
    }
}
