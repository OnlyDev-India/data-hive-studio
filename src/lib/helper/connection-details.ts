export const parseConnectionString = (connectionString: string) => {
  try {
    const url = new URL(connectionString);
    const protocol = url.protocol.replace(":", ""); // Remove ':' from protocol
    const user = url.username || "";
    const password = url.password || "";
    const host = url.hostname || "";
    const port = url.port ? parseInt(url.port, 10) : undefined;
    const database = url.pathname ? url.pathname.replace("/", "") : "";

    // Extract query parameters if any
    const queryParams = Object.fromEntries(url.searchParams.entries());

    // Determine SSL based on protocol and parameters
    let ssl = false;
    if (protocol === "postgresql") {
      ssl = queryParams.sslmode === "require" || queryParams.sslmode === "prefer";
    } else if (protocol === "mongodb" || protocol === "mongodb+srv") {
      ssl = queryParams.ssl === "true" || queryParams.tls === "true";
    }

    return {
      protocol, // e.g., "postgresql", "mongodb"
      user,
      password,
      host,
      port,
      database,
      ssl,
      queryParams, // Include all query parameters for advanced usage
    };
  } catch (error) {
    return { error: "Invalid connection string format." };
  }
};
