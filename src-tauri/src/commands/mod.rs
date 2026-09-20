/// Forwards args by reference into the matching `crate::db::` function and
/// maps any `DbError` to a plain string for the IPC boundary — the shape
/// shared by most commands below. Commands that also log, wrap/transform
/// their result, pass a fixed extra argument, or set up a streaming channel
/// stay hand-written since forcing them into this shape would either lose
/// behavior or make the macro itself the thing that needs untangling.
macro_rules! forward_cmd {
    ($(#[$doc:meta])* $cmd_name:ident($($arg:ident: $ty:ty),* $(,)?) -> $ret:ty => $db_fn:ident) => {
        $(#[$doc])*
        #[tauri::command]
        pub async fn $cmd_name($($arg: $ty),*) -> Result<$ret, String> {
            crate::db::$db_fn($(&$arg),*).await.map_err(to_err)
        }
    };
}

mod connect;
mod browse;
mod query;
mod ddl;
mod system;

pub use connect::*;
pub use browse::*;
pub use query::*;
pub use ddl::*;
pub use system::*;

fn to_err(e: crate::db::DbError) -> String {
    e.to_string()
}
