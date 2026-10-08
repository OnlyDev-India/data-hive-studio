/** Failures that mean the server can't be reached, not that a stage is
 *  wrong: no session for the connection, no server to select, a dropped
 *  socket, a pool that gave up waiting, or (on the web) no team server. */
const LOST =
  /no open connection for id|pool timed out|on a closed pool|server selection timeout|no available servers|connection (refused|reset|closed)|broken pipe|network ?error|failed to fetch|load failed|i\/o error/i;

export function isConnectionLost(message: string | null | undefined): boolean {
  return !!message && LOST.test(message);
}
