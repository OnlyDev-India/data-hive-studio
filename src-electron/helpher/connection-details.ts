export const parseConnectionString = (connectionString: string) => {
  try {
    const url = new URL(connectionString);
    const protocol = url.protocol.replace(":", ""); // Remove ':' from protocol
    const user = url.username || "";
    const password = url.password || "";
    const host = url.hostname || "";
    const port = url.port ? parseInt(url.port, 10) : parseInt("");
    const database = url.pathname ? url.pathname.replace("/", "") : "";

    // Extract query parameters if any
    const queryParams = Object.fromEntries(url.searchParams.entries());

    return {
      protocol, // e.g., "postgresql"
      user,
      password,
      host,
      port,
      database,
      ssl: queryParams.sslmode === "require", // Contains `sslmode` or other parameters
    };
  } catch (error) {
    return { error: "Invalid connection string format." };
  }
};
