import sqlite3 from "sqlite3";
import { open } from "sqlite";

const seedData = `CREATE TABLE IF NOT EXISTS connections(
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    connection_type TEXT,
    host TEXT,
    port INTEGER,
    password TEXT,
    connection_string TEXT,
    save_password INTEGER,
    color TEXT
);
`

const testData = `
CREATE TABLE connections(
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT,
        connection_type TEXT,
        host TEXT,
        port INTEGER,
        password TEXT,
        connection_string TEXT,
        save_password INTEGER,
        color TEXT
    );
    INSERT INTO connections(name,connection_type, connection_string, color) VALUES('test1','pgSql', 'test1','#15db95');
    INSERT INTO connections(name,connection_type, connection_string, color) VALUES('test2','sqlite', 'test2','#ff5d59');
    INSERT INTO connections(name,connection_type, connection_string, color) VALUES('test3','pgSql', 'tes3','#fad83b');
    INSERT INTO connections(name,connection_type, connection_string, color) VALUES('test4','sqlite', 'test4','#15db95');

    `
export const seedDataIntoDB = async (filePath:string) => {
    const db = await open({
        filename: filePath,
        driver: sqlite3.Database,
    });
    await db.exec(seedData);
    // await db.exec(testData);
}