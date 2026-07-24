// db/oracle.js
const oracledb = require('oracledb');

let pool;

async function getOraclePool() {
    if (pool) return pool;

    pool = await oracledb.createPool({
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
        connectString: process.env.ORACLE_CONNECTION_STRING,
        poolMin: 1,
        poolMax: 10
    });

    return pool;
}

module.exports = { getOraclePool };