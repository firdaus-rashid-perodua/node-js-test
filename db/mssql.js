// db/mssql.js
const sql = require('mssql');

let pool;

async function getMssqlPool() {
    if (pool) return pool;

    pool = await sql.connect({
        server: process.env.MSSQL_SERVER,
        database: process.env.MSSQL_DB,
        user: process.env.MSSQL_USER,
        password: process.env.MSSQL_PASSWORD,
        options: { encrypt: false } // adjust for your environment
    });

    return pool;
}

module.exports = { getMssqlPool };