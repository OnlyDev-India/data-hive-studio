// `sqlx::migrate!` embeds the migration files at compile time, but cargo does
// not know it read them. Without this, adding a new numbered migration would
// not trigger a rebuild.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
