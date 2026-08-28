/*
http://10.60.22.62/from-oracle
http://10.60.22.62/from-mssql
http://10.60.22.62/get-users
*/

// routes/foo.js
const express = require('express');
const { getMssqlPool } = require('../db/mssql');
const { getOraclePool } = require('../db/oracle');
const { parse } = require('dotenv');
const { Client } = require('ldapts');
// const jwt = require('jsonwebtoken');
// const crypto = require('crypto');

const router = express.Router();


const algorithm = 'aes-256-gcm';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
// const JWT_SECRET = process.env.JWT_SECRET || 'your_fallback_super_secret_key';

router.post('/login-direct', async (req, res) => {
    let { username, password } = req.body;

    // 1. Check if username or password are empty strings
    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password are required'
        });
    }

    // Clean spaces and check for the domain suffix
    username = username.trim();
    const domain = '@perodua.com.my';

    if (!username.toLowerCase().endsWith(domain)) {
        username = `${username}${domain}`;
    }

    const pass_decrypt = password;

    const client = new Client({
        url: 'ldap://perodua.com.my',
        imeout: 5000,          // Prevents the request from hanging forever if LDAP is down
        connectTimeout: 5000
    });
    try {
        await client.bind(username, pass_decrypt);
        console.log(`Direct LDAP login successful for: ${username}`);

        const { searchEntries } = await client.search(
            'DC=perodua,DC=com,DC=my',
            {
                scope: 'sub',
                //filter: '(sAMAccountName=firdaus.rashid)',
                filter: `(mail=${username})`,
            }
        );

        // Close connection before sending successful response
        await client.unbind();

        return res.json({
            success: true,
            message: 'Login successful',
            user: searchEntries
        });

    } catch (err) {
        console.error('Invalid credentials or LDAP connection error:', err.message || err);

        // 5. Attempt clean unbind layout inside catch block to avoid unhandled crashes
        try {
            await client.unbind();
        } catch (unbindErr) {
            // Silently suppress if connection was already dead
        }

        return res.status(401).json({
            success: false,
            message: 'Invalid credentials',
            error: err.message || 'Unauthorized'
        });
    } /* finally {
        await client.unbind();
    } */
});


router.get('/from-mssql', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT TOP (10) [SALES_CENTER_CODE]
            ,[SALES_CENTER_NAME]
            ,[SALES_CENTER_TYPE]
            ,[BOOKING_DATE]
            ,[REG_NO]
            ,[REG_DATE]
            ,[CUSTOMER_OLD_IC_NO]
            ,[CUSTOMER_NEW_IC_NO]
            ,[CUSTOMER_NAME]
            ,[FMC_ID]
            ,[JPJ_MODEL_DESCRIPTION]
            ,[CUSTOMER_NUMBER]
            ,[EXTRACTION_DATE]
        FROM [DM_BRONZE].[CRKPI].[CRMDB_New_Car_Reg]`);
        //res.json(result.recordset);

        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/from-oracle', async (req, res) => {
    try {
        const pool = await getOraclePool();   // pool object
        const conn = await pool.getConnection();

        const result = await conn.execute(`
      select userid, username from users
      where groupid = 'ITSTF'
      and userstatus = 'ACT'
    `);

        await conn.close();
        //res.json(result.rows);
        res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error('Oracle error:', err);
        res.status(500).json({ error: err + '. Oracle query failed' });
    }
});


router.get('/test/get-users', async (req, res) => {
    try {
        const pool = await getOraclePool();   // pool object
        const conn = await pool.getConnection();

        const result = await conn.execute(`
      select userid, username from users
      where groupid = 'ITSTF'
      and userstatus = 'ACT'
    `);

        await conn.close();
        res.json(result.rows);
    } catch (err) {
        console.error('Oracle error:', err);
        res.status(500).json({ error: 'Oracle query failed' });
    }
});



// start BMA (PRIME-GO) query
router.get('/api/dashboard/year_regActual', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT COUNT(*) as 'total_reg_year'
    FROM [DM_BRONZE].[CRKPI].[CRMDB_New_Car_Reg]
    WHERE YEAR(REG_DATE) = '2025'`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/year_regActual");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] failed: /api/dashboard/year_regActual " + err.message);
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/year_regTarget', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT SUM(Target) as 'target_reg_year'
    FROM [DM_BRONZE].[CRKPI].[FlatFile_Target]
    WHERE  YEAR = '2025'
    AND Parameter = 'New Car Reg'`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/year_regTarget");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/mnt_regActual', async (req, res) => {
    try {

        // 1. Get query parameters from the request URL
        const { month, year } = req.query;

        // Fallback defaults if parameters are missing from the URL call
        // const queryMonth = month || '05';
        // const queryYear = year || '2025';
        const parsedMonth = parseInt(month, 10) || '05';
        const parsedYear = parseInt(year, 10) || '2025';

        const pool = await getMssqlPool();
        const result = await pool.request().input('monthParam', parseInt(parsedMonth))
            .input('yearParam', parseInt(parsedYear)).query(`SELECT COUNT(*) as 'total_reg_month'
    FROM [DM_BRONZE].[CRKPI].[CRMDB_New_Car_Reg]
    WHERE MONTH(REG_DATE) = @monthParam
      AND YEAR(REG_DATE) = @yearParam`);
        //res.json(result.recordset);


        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/mnt_regActual  Params: " + JSON.stringify(req.query));
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] failed: /api/dashboard/mnt_regActual " + err.message);
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/mnt_regTarget', async (req, res) => {
    try {
        const { month, year } = req.query;

        // Fallback defaults if parameters are missing from the URL call
        // const queryMonth = month || '05';
        // const queryYear = year || '2025';
        const parsedMonth = parseInt(month, 10) || '05';
        const parsedYear = parseInt(year, 10) || '2025';

        const pool = await getMssqlPool();
        const result = await pool.request().input('monthParam', parseInt(parsedMonth))
            .input('yearParam', parseInt(parsedYear)).query(`SELECT ISNULL(SUM(Target), 0) as 'target_reg_month'
FROM [DM_BRONZE].[CRKPI].[FlatFile_Target]
WHERE YEAR = @yearParam
  AND MONTH = @monthParam
  --AND REGION = 'C1'
  AND Parameter = 'New Car Reg'`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/mnt_regTarget Params: " + JSON.stringify(req.query));
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/mnt_bookActual', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT COUNT(*) as 'total_book_month'
    FROM [DM_BRONZE].[CRKPI].[CRMDB_New_Car_Reg]
    WHERE MONTH(REG_DATE) = '05'
      AND YEAR(REG_DATE) = '2025'`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/mnt_bookActual");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/mnt_bookTarget', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT SUM(Target) as 'target_book_month'
    FROM [DM_BRONZE].[CRKPI].[FlatFile_Target]
    WHERE  YEAR = '2025'
    AND MONTH = '5'
    --AND REGION = 'C1'
    AND Parameter = 'New Car Reg'`);
        //res.json(result.recordset);

        // console.log(`[] success: /api/dashboard/mnt_bookTarget`);
        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/mnt_bookTarget");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/mnt_serviceActual', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT COUNT(*) as 'total_reg_month'
    FROM [DM_BRONZE].[CRKPI].[CRMDB_New_Car_Reg]
    WHERE MONTH(REG_DATE) = '05'
      AND YEAR(REG_DATE) = '2025'`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/mnt_serviceActual");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/mnt_serviceTarget', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT SUM(Target) as 'target_reg_month'
    FROM [DM_BRONZE].[CRKPI].[FlatFile_Target]
    WHERE  YEAR = '2025'
    AND MONTH = '5'
    --AND REGION = 'C1'
    AND Parameter = 'New Car Reg'`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/mnt_serviceTarget");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/mnt_partActual', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT COUNT(*) as 'total_reg_month'
    FROM [DM_BRONZE].[CRKPI].[CRMDB_New_Car_Reg]
    WHERE MONTH(REG_DATE) = '05'
      AND YEAR(REG_DATE) = '2025'`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/mnt_partActual");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/mnt_partTarget', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT SUM(Target) as 'target_reg_month'
    FROM [DM_BRONZE].[CRKPI].[FlatFile_Target]
    WHERE  YEAR = '2025'
    AND MONTH = '5'
    --AND REGION = 'C1'
    AND Parameter = 'New Car Reg'`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/mnt_partTarget");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


// List actual monthly registration by month
router.get('/api/registration/mnt_listActual', async (req, res) => {
    try {
        const { month, year } = req.query;

        const parsedMonth = parseInt(month, 10) || '05';
        const parsedYear = parseInt(year, 10) || '2025';

        const pool = await getMssqlPool();
        const result = await pool.request().input('monthParam', parseInt(parsedMonth))
            .input('yearParam', parseInt(parsedYear)).query(`
WITH TargetData AS (
    SELECT 
        OTL2.Region_2 AS [REGION],
        SUM(TRY_CAST(TR2.Target AS INT)) AS TARGET_REG_COUNT
    FROM DM_BRONZE.crkpi.FlatFile_Target TR2 
    JOIN DM_GOLD.crkpi.OUTLET_TYPE OTL2 
        ON TR2.[Outlet Code] = OTL2.SLS_CODE 
    WHERE TR2.Parameter = 'New Car Reg' 
      AND TR2.Month = @monthParam 
      AND TR2.Year = @yearParam
    GROUP BY OTL2.Region_2
),
ActualData AS (
    SELECT 
        OTL2.Region_2 AS [REGION],
        COUNT(*) AS ACTUAL_REG_COUNT
    FROM DM_BRONZE.CRKPI.CRMDB_New_Car_Reg AC2
    JOIN DM_GOLD.crkpi.OUTLET_TYPE OTL2 
        ON AC2.SALES_CENTER_CODE = OTL2.SLS_CODE 
    WHERE MONTH(AC2.REG_DATE) = @monthParam
      AND YEAR(AC2.REG_DATE) = @yearParam
    GROUP BY OTL2.Region_2
)
SELECT 
    ISNULL(t.[REGION], a.[REGION]) AS [REGION],
    
    -- New Descriptive Region Column (Added FMD label map)
    CASE ISNULL(t.[REGION], a.[REGION])
        WHEN 'C1'  THEN 'Central 1'
        WHEN 'C2'  THEN 'Central 2'
        WHEN 'EC1' THEN 'East Coast 1'
        WHEN 'EC2' THEN 'East Coast 2'
        WHEN 'EM'  THEN 'East Malaysia'
        WHEN 'N'   THEN 'Northern'
        WHEN 'S'   THEN 'Southern'
        WHEN 'FMD' THEN 'FMD' -- Maps code to descriptive name
        ELSE ISNULL(t.[REGION], a.[REGION]) 
    END AS REGION_NAME,

    ISNULL(t.TARGET_REG_COUNT, 0) AS TARGET_REG_COUNT,
    ISNULL(a.ACTUAL_REG_COUNT, 0) AS ACTUAL_REG_COUNT,
    
    -- 1. No Decimal Places (rounded to nearest integer)
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0
        ELSE CAST(ROUND((ISNULL(a.ACTUAL_REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT, 0) AS INT)
    END AS REG_PCTG,

    -- 2. One Decimal Place
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0.0
        ELSE CAST((ISNULL(a.ACTUAL_REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT AS DECIMAL(10,1))
    END AS REG_PCTG_1,

    -- 3. Two Decimal Places
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0.00
        ELSE CAST((ISNULL(a.ACTUAL_REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT AS DECIMAL(10,2))
    END AS REG_PCTG_2

FROM TargetData t
FULL OUTER JOIN ActualData a 
    ON t.[REGION] = a.[REGION]

-- Custom Sorting Rule
ORDER BY 
    CASE WHEN ISNULL(t.[REGION], a.[REGION]) = 'FMD' THEN 1 ELSE 0 END ASC, 
    ISNULL(t.[REGION], a.[REGION]) ASC;
`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/registration/mnt_listActual");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


// List actual monthly registration by month (Model)
router.get('/api/registration/mnt_listActualModel', async (req, res) => {
    try {
        const { month, year } = req.query;

        const parsedMonth = parseInt(month, 10) || '05';
        const parsedYear = parseInt(year, 10) || '2025';

        const pool = await getMssqlPool();
        const result = await pool.request().input('monthParam', parseInt(parsedMonth))
            .input('yearParam', parseInt(parsedYear)).query(`
WITH TargetSummary AS (
    -- Step 1: Sum up targets per model first
    SELECT 
        Model,
        SUM(TRY_CAST(Target AS INT)) AS TARGET_REG_COUNT
    FROM [DM_BRONZE].[CRKPI].[FlatFile_Target]
    WHERE Parameter = 'New Car Reg'
      AND Year = @yearParam
      AND Month = @monthParam
      AND Model <> 'AXIA E'
    GROUP BY Model
),
RegistrationSummary AS (
    -- Step 2: Get total actual registrations per model using a clean JOIN condition
    SELECT 
        t.Model,
        COUNT(*) AS ACTUAL_REG_COUNT
    FROM (
        SELECT DISTINCT Model 
        FROM [DM_BRONZE].[CRKPI].[FlatFile_Target] 
        WHERE Parameter = 'New Car Reg' AND Year = 2025 AND Month = 5 AND Model <> 'AXIA E'
    ) t
    INNER JOIN [DM_BRONZE].[CRKPI].[CRMDB_New_Car_Reg] r
        ON r.JPJ_MODEL_DESCRIPTION LIKE '%' + t.Model + '%'
    WHERE MONTH(r.REG_DATE) = @monthParam
      AND YEAR(r.REG_DATE) = @yearParam
      AND r.JPJ_MODEL_DESCRIPTION <> 'AXIA - 1000 E (MANUAL)'
    GROUP BY t.Model
)
-- Step 3: Combine everything and calculate all required percentages safely
SELECT 
    t.Model,
    ISNULL(r.ACTUAL_REG_COUNT, 0) AS ACTUAL_REG_COUNT,
    ISNULL(t.TARGET_REG_COUNT, 0) AS TARGET_REG_COUNT,

    -- 1. No Decimal Places (rounded to nearest integer)
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0
        ELSE CAST(ROUND((ISNULL(r.ACTUAL_REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT, 0) AS INT)
    END AS REG_PCTG,

    -- 2. One Decimal Place
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0.0
        ELSE CAST((ISNULL(r.ACTUAL_REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT AS DECIMAL(10,1))
    END AS REG_PCTG_1,

    -- 3. Two Decimal Places
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0.00
        ELSE CAST((ISNULL(r.ACTUAL_REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT AS DECIMAL(10,2))
    END AS REG_PCTG2

FROM TargetSummary t
LEFT JOIN RegistrationSummary r ON t.Model = r.Model
ORDER BY ACTUAL_REG_COUNT DESC;
`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/registration/mnt_listActualModel");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});



// List actual monthly registration by month (Outlets)
router.get('/api/registration/mnt_listRegionOutlet', async (req, res) => {
    try {
        const { month, year, region } = req.query;

        const parsedMonth = parseInt(month, 10) || '05';
        const parsedYear = parseInt(year, 10) || '2025';
        const parsedRegion = region || 'C1';

        // console.log(parsedRegion);

        const pool = await getMssqlPool();
        const result = await pool.request().input('monthParam', parseInt(parsedMonth))
            .input('yearParam', parseInt(parsedYear)).input('regionParam', parsedRegion).query(`
WITH TargetData AS (
    SELECT 
        OTL2.Region_2 AS [REGION],
        TR2.[Outlet Code] AS OUTLET_CODE,
        SUM(TRY_CAST(TR2.Target AS INT)) AS TARGET_REG_COUNT
    FROM DM_BRONZE.crkpi.FlatFile_Target TR2 
    JOIN DM_GOLD.crkpi.OUTLET_TYPE OTL2 
        ON TR2.[Outlet Code] = OTL2.SLS_CODE 
    WHERE TR2.Parameter = 'New Car Reg' 
      AND TR2.Month = @monthParam 
      AND TR2.Year = @yearParam
      AND OTL2.OUTLET_ACTIVE = 'Active'
      AND OTL2.REGION_2 = @regionParam
    GROUP BY OTL2.Region_2, TR2.[Outlet Code]
),
ActualData AS (
    SELECT 
        OTL2.Region_2 AS [REGION], 
        AC2.SALES_CENTER_CODE AS OUTLET_CODE, 
        AC2.SALES_CENTER_NAME AS OUTLET_NAME, 
        COUNT(*) AS REG_COUNT
    FROM DM_BRONZE.CRKPI.CRMDB_New_Car_Reg AC2
    JOIN DM_GOLD.crkpi.OUTLET_TYPE OTL2 
        ON AC2.SALES_CENTER_CODE = OTL2.SLS_CODE 
    WHERE MONTH(AC2.REG_DATE) = @monthParam
      AND YEAR(AC2.REG_DATE) = @yearParam
      AND OTL2.OUTLET_ACTIVE = 'Active'
      AND OTL2.REGION_2 = @regionParam
    GROUP BY OTL2.Region_2, AC2.SALES_CENTER_CODE, AC2.SALES_CENTER_NAME
)
SELECT 
    ISNULL(a.[REGION], t.[REGION]) AS [REGION],
    ISNULL(a.OUTLET_CODE, t.OUTLET_CODE) AS OUTLET_CODE,
    ISNULL(a.OUTLET_NAME, 'No Name Registered') AS OUTLET_NAME,
    ISNULL(t.TARGET_REG_COUNT, 0) AS TARGET_REG_COUNT,
    ISNULL(a.REG_COUNT, 0) AS ACTUAL_REG_COUNT,
    
    -- 1. No Decimal Places (rounded to nearest integer)
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0
        ELSE CAST(ROUND((ISNULL(a.REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT, 0) AS INT)
    END AS REG_PCTG,

    -- 2. One Decimal Place
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0.0
        ELSE CAST((ISNULL(a.REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT AS DECIMAL(10,1))
    END AS REG_PCTG_1,

    -- 3. Two Decimal Places
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0.00
        ELSE CAST((ISNULL(a.REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT AS DECIMAL(10,2))
    END AS REG_PCTG_2

FROM TargetData t
FULL OUTER JOIN ActualData a 
    ON t.OUTLET_CODE = a.OUTLET_CODE
ORDER BY REG_PCTG_2 DESC;
`);
        //res.json(result.recordset);

        // To change 'Veh Br - ' to 'PSSB' 
        const updatedRecords = result.recordset.map(item => {
            if (item.OUTLET_NAME && item.OUTLET_NAME.startsWith('Veh Br-')) {
                return {
                    ...item,
                    OUTLET_NAME: item.OUTLET_NAME.replace('Veh Br-', 'PSSB ')
                };
            }
            return item;
        });

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/registration/mnt_listRegionOutlet Params: " + JSON.stringify(req.query));




        // Ori
        /* res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        }); */


        // Modified JSON
        res.status(200).json({
            success: true,
            count: updatedRecords.length,
            data: updatedRecords
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});



// List actual monthly registration by month (Outlets)
router.get('/api/registration/mnt_listModelOutlet', async (req, res) => {
    try {
        const { month, year, region, outletcode } = req.query;

        const parsedMonth = parseInt(month, 10) || '05';
        const parsedYear = parseInt(year, 10) || '2025';
        const parsedRegion = region || 'C1';
        const parsedOutletCode = outletcode || '522105';

        // console.log(parsedRegion);

        const pool = await getMssqlPool();
        const result = await pool.request().input('monthParam', parseInt(parsedMonth))
            .input('yearParam', parseInt(parsedYear)).input('regionParam', parsedRegion).input('outletCodeParam', parsedOutletCode).query(`
WITH TargetData AS (
    SELECT 
        OTL2.Region_2 AS [REGION],
        TR2.[Outlet Code] AS OUTLET_CODE,
        TR2.Model AS [MODEL],
        SUM(TRY_CAST(TR2.Target AS INT)) AS TARGET_REG_COUNT
    FROM DM_BRONZE.crkpi.FlatFile_Target TR2 
    JOIN DM_GOLD.crkpi.OUTLET_TYPE OTL2 
        ON TR2.[Outlet Code] = OTL2.SLS_CODE 
    WHERE TR2.Parameter = 'New Car Reg' 
      AND TR2.Month = @monthParam
      AND TR2.Year = @yearParam
      AND OTL2.OUTLET_ACTIVE = 'Active'
      AND TR2.[Outlet Code] = @outletCodeParam
      AND TR2.Model <> 'AXIA E'
    GROUP BY OTL2.Region_2, TR2.[Outlet Code], TR2.Model
),
ActualData AS (
    SELECT 
        t.[REGION],
        t.OUTLET_CODE,
        t.[MODEL],
        -- 1. Safely extract SALES_CENTER_NAME matching your criteria
        ISNULL((
            SELECT TOP 1 AC2.SALES_CENTER_NAME
            FROM DM_BRONZE.CRKPI.CRMDB_New_Car_Reg AC2
            WHERE MONTH(AC2.REG_DATE) = @monthParam 
              AND YEAR(AC2.REG_DATE) = @yearParam
              AND AC2.SALES_CENTER_CODE = t.OUTLET_CODE
              AND AC2.SALES_CENTER_NAME IS NOT NULL
        ), 'No Name Registered') AS OUTLET_NAME,
        -- 2. Safely extract execution count
        (
            SELECT COUNT(*) 
            FROM DM_BRONZE.CRKPI.CRMDB_New_Car_Reg AC2
            WHERE MONTH(AC2.REG_DATE) = @monthParam 
              AND YEAR(AC2.REG_DATE) = @yearParam
              AND AC2.SALES_CENTER_CODE = t.OUTLET_CODE
              AND AC2.JPJ_MODEL_DESCRIPTION LIKE '%' + t.[MODEL] + '%'
              AND AC2.JPJ_MODEL_DESCRIPTION <> 'AXIA - 1000 E (MANUAL)'
        ) AS REG_COUNT
    FROM TargetData t
)
SELECT 
    ISNULL(a.[REGION], t.[REGION]) AS [REGION],
    ISNULL(a.OUTLET_CODE, t.OUTLET_CODE) AS OUTLET_CODE,
    ISNULL(a.OUTLET_NAME, 'No Name Registered') AS OUTLET_NAME,
    ISNULL(t.[MODEL], a.[MODEL]) AS [MODEL],
    ISNULL(t.TARGET_REG_COUNT, 0) AS TARGET_REG_COUNT,
    ISNULL(a.REG_COUNT, 0) AS ACTUAL_REG_COUNT,
    
    -- 1. No Decimal Places (rounded to nearest integer)
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0
        ELSE CAST(ROUND((ISNULL(a.REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT, 0) AS INT)
    END AS REG_PCTG,

    -- 2. One Decimal Place
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0.0
        ELSE CAST((ISNULL(a.REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT AS DECIMAL(10,1))
    END AS REG_PCTG_1,

    -- 3. Two Decimal Places
    CASE 
        WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0.00
        ELSE CAST((ISNULL(a.REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT AS DECIMAL(10,2))
    END AS REG_PCTG_2

FROM TargetData t
FULL OUTER JOIN ActualData a 
    ON t.OUTLET_CODE = a.OUTLET_CODE AND t.[MODEL] = a.[MODEL]
ORDER BY REG_PCTG_2 DESC;
`);
        //res.json(result.recordset);

        // To change 'Veh Br - ' to 'PSSB' 
        const updatedRecords = result.recordset.map(item => {
            if (item.OUTLET_NAME && item.OUTLET_NAME.startsWith('Veh Br-')) {
                return {
                    ...item,
                    OUTLET_NAME: item.OUTLET_NAME.replace('Veh Br-', 'PSSB ')
                };
            }
            return item;
        });

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/registration/mnt_listModelOutlet Params: " + JSON.stringify(req.query));




        // Ori
        /* res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        }); */


        // Modified JSON
        res.status(200).json({
            success: true,
            count: updatedRecords.length,
            data: updatedRecords
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});



// List actual model monthly registration by month bu outlet
router.get('/api/registration/mnt_outletModelResult', async (req, res) => {
    try {

        const { month, year, region, outletcode } = req.query;

        const parsedMonth = parseInt(month, 10) || '05';
        const parsedYear = parseInt(year, 10) || '2025';
        const parsedRegion = region || 'C1';
        const parsedOutletCode = outletcode || '522105';

        // console.log(parsedRegion);

        // To calculate query time taken
        const startTime = performance.now();

        const pool = await getMssqlPool();
        const result = await pool.request().input('monthParam', parseInt(parsedMonth))
            .input('yearParam', parseInt(parsedYear)).input('regionParam', parsedRegion).input('outletCodeParam', parsedOutletCode).query(`
WITH TargetData AS (
    SELECT 
        OTL2.Region_2 AS [REGION],
        TR2.[Outlet Code] AS OUTLET_CODE,
        TR2.Model AS [MODEL],
        SUM(TRY_CAST(TR2.Target AS INT)) AS TARGET_REG_COUNT
    FROM DM_BRONZE.crkpi.FlatFile_Target TR2 
    JOIN DM_GOLD.crkpi.OUTLET_TYPE OTL2 
        ON TR2.[Outlet Code] = OTL2.SLS_CODE 
    WHERE TR2.Parameter = 'New Car Reg' 
      AND TR2.Month = @monthParam 
      AND TR2.Year = @yearParam
      AND OTL2.OUTLET_ACTIVE = 'Active'
      AND TR2.[Outlet Code] = @outletCodeParam
      AND TR2.Model <> 'AXIA E'
    GROUP BY OTL2.Region_2, TR2.[Outlet Code], TR2.Model
),
ActualData AS (
    SELECT 
        t.[REGION],
        t.OUTLET_CODE,
        t.[MODEL],
        t.TARGET_REG_COUNT,
        (
            SELECT COUNT(*) 
            FROM DM_BRONZE.CRKPI.CRMDB_New_Car_Reg AC2
            WHERE MONTH(AC2.REG_DATE) = @monthParam 
              AND YEAR(AC2.REG_DATE) = @yearParam
              AND AC2.SALES_CENTER_CODE = t.OUTLET_CODE
              AND AC2.JPJ_MODEL_DESCRIPTION LIKE '%' + t.[MODEL] + '%'
              AND AC2.JPJ_MODEL_DESCRIPTION <> 'AXIA - 1000 E (MANUAL)'
        ) AS REG_COUNT
    FROM TargetData t
),
CalculatedData AS (
    SELECT 
        OUTLET_CODE,
        [MODEL],
        TARGET_REG_COUNT,
        REG_COUNT,
        CASE 
            WHEN TARGET_REG_COUNT = 0 THEN 0.0
            ELSE (REG_COUNT * 100.0) / TARGET_REG_COUNT
        END AS REG_PCTG
    FROM ActualData
),
SummaryData AS (
    SELECT 
        OUTLET_CODE, -- Hardcoded to match your WHERE filter cleanly
        COUNT(*) AS TOTAL_ROWS,
        SUM(CASE WHEN REG_PCTG < 50 THEN 1 ELSE 0 END) AS ROWS_BELOW_50,
        
        -- 0 Decimal Places (Rounded)
        CAST(ROUND(AVG(REG_PCTG), 0) AS INT) AS AVERAGE_REG_PCTG,
        
        -- 1 Decimal Place
        CAST(AVG(REG_PCTG) AS DECIMAL(10,1)) AS AVERAGE_REG_PCTG_1,
        
        -- 2 Decimal Places
        CAST(AVG(REG_PCTG) AS DECIMAL(10,2)) AS AVERAGE_REG_PCTG_2,
        
        (SELECT TOP 1 [MODEL] FROM CalculatedData ORDER BY REG_PCTG ASC, [MODEL] ASC) AS LOWEST_MODEL
        
    FROM CalculatedData
    GROUP BY OUTLET_CODE
)
-- Fetch the name exactly once at the end to keep query cost low
SELECT 
    s.OUTLET_CODE,
    ISNULL((
        SELECT TOP 1 AC2.SALES_CENTER_NAME
        FROM DM_BRONZE.CRKPI.CRMDB_New_Car_Reg AC2
        WHERE MONTH(AC2.REG_DATE) = @monthParam  
          AND YEAR(AC2.REG_DATE) = @yearParam
          AND AC2.SALES_CENTER_CODE = s.OUTLET_CODE
          AND AC2.SALES_CENTER_NAME IS NOT NULL
    ), 'No Name Registered') AS OUTLET_NAME,
    s.TOTAL_ROWS,
    s.ROWS_BELOW_50,
    s.AVERAGE_REG_PCTG,
    s.AVERAGE_REG_PCTG_1,
    s.AVERAGE_REG_PCTG_2,
    s.LOWEST_MODEL
FROM SummaryData s;
`);
        //res.json(result.recordset);

        // Calculate the duration
        const duration = (performance.now() - startTime).toFixed(2)

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success (" + duration + "ms): /api/registration/mnt_outletModelResult Params: " + JSON.stringify(req.query));
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


// List actual monthly registration by month (Outlets)
router.get('/api/registration/mnt_RegionOutletSummary', async (req, res) => {
    try {
        const { month, year, region } = req.query;

        const parsedMonth = parseInt(month, 10) || '05';
        const parsedYear = parseInt(year, 10) || '2025';
        const parsedRegion = region || 'C1';

        // console.log(parsedRegion);

        const pool = await getMssqlPool();
        const result = await pool.request().input('monthParam', parseInt(parsedMonth))
            .input('yearParam', parseInt(parsedYear)).input('regionParam', parsedRegion).query(`
WITH TargetData AS (
    SELECT 
        OTL2.Region_2 AS [REGION],
        TR2.[Outlet Code] AS OUTLET_CODE,
        SUM(TRY_CAST(TR2.Target AS INT)) AS TARGET_REG_COUNT
    FROM DM_BRONZE.crkpi.FlatFile_Target TR2 
    JOIN DM_GOLD.crkpi.OUTLET_TYPE OTL2 
        ON TR2.[Outlet Code] = OTL2.SLS_CODE 
    WHERE TR2.Parameter = 'New Car Reg' 
      AND TR2.Month = @monthParam
      AND TR2.Year = @yearParam
      AND OTL2.OUTLET_ACTIVE = 'Active'
      AND OTL2.REGION_2 = @regionParam
    GROUP BY OTL2.Region_2, TR2.[Outlet Code]
),
ActualData AS (
    SELECT 
        OTL2.Region_2 AS [REGION], 
        AC2.SALES_CENTER_CODE AS OUTLET_CODE, 
        AC2.SALES_CENTER_NAME AS OUTLET_NAME, 
        COUNT(*) AS REG_COUNT
    FROM DM_BRONZE.CRKPI.CRMDB_New_Car_Reg AC2
    JOIN DM_GOLD.crkpi.OUTLET_TYPE OTL2 
        ON AC2.SALES_CENTER_CODE = OTL2.SLS_CODE 
    WHERE MONTH(AC2.REG_DATE) = @monthParam
      AND YEAR(AC2.REG_DATE) = @yearParam
      AND OTL2.OUTLET_ACTIVE = 'Active'
      AND OTL2.REGION_2 = @regionParam
    GROUP BY OTL2.Region_2, AC2.SALES_CENTER_CODE, AC2.SALES_CENTER_NAME
),
DetailedResults AS (
    SELECT 
        ISNULL(a.[REGION], t.[REGION]) AS [REGION],
        ISNULL(a.OUTLET_CODE, t.OUTLET_CODE) AS OUTLET_CODE,
        ISNULL(a.OUTLET_NAME, 'No Name Registered') AS OUTLET_NAME,
        ISNULL(t.TARGET_REG_COUNT, 0) AS TARGET_REG_COUNT,
        ISNULL(a.REG_COUNT, 0) AS ACTUAL_REG_COUNT,
        CASE 
            WHEN ISNULL(t.TARGET_REG_COUNT, 0) = 0 THEN 0.00
            ELSE CAST((ISNULL(a.REG_COUNT, 0) * 100.0) / t.TARGET_REG_COUNT AS DECIMAL(10,2))
        END AS REG_PCTG_2
    FROM TargetData t
    FULL OUTER JOIN ActualData a 
        ON t.OUTLET_CODE = a.OUTLET_CODE
),
RankedResults AS (
    SELECT 
        OUTLET_CODE,
        OUTLET_NAME,
        REG_PCTG_2,
        COUNT(*) OVER() AS TOTAL_ROWS,
        AVG(CAST(REG_PCTG_2 AS FLOAT)) OVER() AS AVERAGE_REG_PCTG,
        SUM(CASE WHEN REG_PCTG_2 < 80.00 THEN 1 ELSE 0 END) OVER() AS ROWS_BELOW_50,
        ROW_NUMBER() OVER(ORDER BY REG_PCTG_2 DESC, ACTUAL_REG_COUNT DESC) AS RowNum
    FROM DetailedResults
)
SELECT 
    TOTAL_ROWS,
    ROWS_BELOW_50,
    
    -- 1. No Decimal Places (Rounded to nearest integer)
    CAST(ROUND(AVERAGE_REG_PCTG, 0) AS INT) AS AVERAGE_REG_PCTG,
    
    -- 2. One Decimal Place
    CAST(AVERAGE_REG_PCTG AS DECIMAL(10,1)) AS AVERAGE_REG_PCTG_1,
    
    -- 3. Two Decimal Places
    CAST(AVERAGE_REG_PCTG AS DECIMAL(10,2)) AS AVERAGE_REG_PCTG_2,
    
    OUTLET_CODE AS HIGHEST_OUTLET_CODE,
    OUTLET_NAME AS HIGHEST_OUTLET_NAME,
    REG_PCTG_2 AS HIGHEST_REG_PCTG
FROM RankedResults
WHERE RowNum = 1;
`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/registration/mnt_RegionOutletSummary Params: " + JSON.stringify(req.query));
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


router.get('/api/dashboard/server_test', async (req, res) => {
    try {
        const pool = await getMssqlPool();
        const result = await pool.request().query(`SELECT COUNT(*) as 'total_reg_year'
    FROM [DM_BRONZE].[CRKPI].[CRMDB_New_Car_Reg]
    WHERE YEAR(REG_DATE) = '2025'`);
        //res.json(result.recordset);

        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] success: /api/dashboard/year_regActual");
        res.status(200).json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        console.log("[" + new Date().toISOString().replace('T', ' ').substring(0, 19) + "] failed: /api/dashboard/year_regActual " + err.message);
        res.status(500).json({
            success: false,
            message: 'Database query execution failed',
            error: err.message
        });
    }

});


// end BMA (PRIME-GO) query

module.exports = router;