const { pool } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const ALS_URL = process.env.ALS_URL || 'https://your-als-domain.com';

// ALS Helper function.
async function alsRegisterParty({ dfspId, currency, idType, idValue }) {
  const url = `${ALS_URL}/participants/${idType}/${idValue}`;
  const res = await axios.post(
    url,
    { fspId: dfspId, currency },
    {
      headers: {
        'FSPIOP-Source': dfspId,
        Accept:
          'application/vnd.interoperability.participants+json;version=1.1',
        'Content-Type':
          'application/vnd.interoperability.participants+json;version=1.1',
        Date: new Date().toUTCString(),
      },
    },
  );
  return res;
}

// ALS Helper
async function alsDeleteParty({ dfspId, idType, idValue }) {
  const url = `${ALS_URL}/participants/${idType}/${idValue}`;
  await axios.delete(url, {
    headers: {
      'FSPIOP-Source': dfspId,
      Date: new Date().toUTCString(),
    },
  });
}

exports.getMerchants = async (req, res) => {
  const { dfsp_id } = req.user;
  const { status, search, page = 1, limit = 20 } = req.query;
  try {
    const conditions = [`dfsp_id = ?`];
    const values = [dfsp_id];

    if (status && status !== 'ALL') {
      conditions.push(`status = ?`);
      values.push(status);
    }
    if (search) {
      conditions.push(
        `(business_name LIKE ? OR merchant_id LIKE ? OR phone LIKE ?)`,
      );
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM merchants ${where}`,
      values,
    );
    const [rows] = await pool.execute(
      `SELECT * FROM merchants ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...values, parseInt(limit), offset],
    );

    res.json({
      data: rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getById = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM merchants WHERE id = ? AND dfsp_id = ?`,
      [req.params.id, dfsp_id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Merchant not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// register
exports.create = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const {
      business_name,
      business_type,
      owner_name,
      phone,
      email,
      address,
      nid,
      tin,
      account_number,
      category,
      daily_limit,
      monthly_limit,
      id_type = 'MSISDN',
      id_value,
      first_name,
      middle_name,
      last_name,
      dob,
    } = req.body;

    if (!business_name || !phone)
      return res
        .status(400)
        .json({ error: 'business_name and phone are required' });

    const alsIdValue = id_value || phone;

    //  Step 1: Duplicate check
    const [existing] = await pool.execute(
      `SELECT id FROM merchants WHERE dfsp_id = ? AND id_type = ? AND id_value = ?`,
      [dfsp_id, id_type, alsIdValue],
    );
    if (existing.length > 0) {
      return res.status(400).json({
        error: `Merchant with ${id_type}=${alsIdValue} already exists`,
      });
    }

    // Step 2: ALS এ Party register
    const [[dfsp]] = await pool.execute(
      `SELECT currency FROM dfsps WHERE dfsp_id = ? LIMIT 1`,
      [dfsp_id],
    );
    const currency = dfsp?.currency || process.env.DEFAULT_CURRENCY || 'BDT';

    let alsStatus = 'pending';
    try {
      const alsRes = await alsRegisterParty({
        dfspId: dfsp_id,
        currency,
        idType: id_type,
        idValue: alsIdValue,
      });

      // ALS async — 202 Accepted
      if (alsRes.status >= 200 && alsRes.status < 300) {
        alsStatus = 'registered';
        console.log(
          `[MERCHANT] ALS party registered: ${id_type}/${alsIdValue} for ${dfsp_id}`,
        );
      } else {
        alsStatus = 'failed';
        console.warn(`[MERCHANT] ALS unexpected status ${alsRes.status}`);
      }
    } catch (alsErr) {
      // ALS 400 = duplicate
      if (alsErr.response?.status === 400) {
        return res.status(400).json({
          error: `ALS: Party ${id_type}/${alsIdValue} already registered`,
          als_error: alsErr.response?.data,
        });
      }
      // ALS unavailable হলে warning
      alsStatus = 'failed';
      console.error(`[MERCHANT] ALS registration failed: ${alsErr.message}`);

      if (process.env.ALS_STRICT !== 'false') {
        return res.status(502).json({
          error: 'Failed to register with ALS Account Lookup Service',
          als_error: alsErr.response?.data || alsErr.message,
        });
      }
    }

    // Step 3: DB Save
    const merchantId = `MRC-${dfsp_id}-${Date.now()}`;
    const id = uuidv4();

    await pool.execute(
      `
      INSERT INTO merchants
        (id, dfsp_id, merchant_id, business_name, business_type, owner_name,
         phone, email, address, nid, tin, account_number, category,
         daily_limit, monthly_limit,
         id_type, id_value, first_name, middle_name, last_name, dob,
         als_status, currency)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        dfsp_id,
        merchantId,
        business_name,
        business_type,
        owner_name,
        phone,
        email,
        address,
        nid,
        tin,
        account_number,
        category,
        daily_limit || 0,
        monthly_limit || 0,
        id_type,
        alsIdValue,
        first_name || owner_name || business_name,
        middle_name || null,
        last_name || null,
        dob || null,
        alsStatus,
        currency,
      ],
    );

    res.status(201).json({
      message: 'Merchant registered successfully',
      merchant_id: merchantId,
      id,
      als_status: alsStatus,
      party: { id_type, id_value: alsIdValue },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const {
      business_name,
      business_type,
      owner_name,
      phone,
      email,
      address,
      nid,
      tin,
      account_number,
      category,
      daily_limit,
      monthly_limit,
      notes,
    } = req.body;

    await pool.execute(
      `
      UPDATE merchants SET
        business_name=?, business_type=?, owner_name=?, phone=?, email=?,
        address=?, nid=?, tin=?, account_number=?, category=?,
        daily_limit=?, monthly_limit=?, notes=?, updated_at=NOW()
      WHERE id = ? AND dfsp_id = ?`,
      [
        business_name,
        business_type,
        owner_name,
        phone,
        email,
        address,
        nid,
        tin,
        account_number,
        category,
        daily_limit,
        monthly_limit,
        notes,
        req.params.id,
        dfsp_id,
      ],
    );

    res.json({ message: 'Merchant updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  const { dfsp_id } = req.user;
  if (req.user.role === 'VIEWER')
    return res.status(403).json({ error: 'Insufficient permissions' });
  try {
    const { status, notes } = req.body;
    const validStatuses = ['ACTIVE', 'SUSPENDED', 'REJECTED', 'PENDING'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    await pool.execute(
      `
      UPDATE merchants SET
        status = ?, notes = ?,
        approved_by = ?, approved_at = NOW(), updated_at = NOW()
      WHERE id = ? AND dfsp_id = ?`,
      [status, notes, req.user.id, req.params.id, dfsp_id],
    );

    res.json({ message: `Merchant ${status.toLowerCase()}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getStats = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const [[stats]] = await pool.execute(
      `
      SELECT
        COUNT(*)                     AS total,
        SUM(status = 'ACTIVE')       AS active,
        SUM(status = 'PENDING')      AS pending,
        SUM(status = 'SUSPENDED')    AS suspended,
        SUM(status = 'REJECTED')     AS rejected
      FROM merchants WHERE dfsp_id = ?`,
      [dfsp_id],
    );

    const [byCategory] = await pool.execute(
      `
      SELECT category, COUNT(*) AS count
      FROM merchants WHERE dfsp_id = ? AND category IS NOT NULL
      GROUP BY category ORDER BY count DESC LIMIT 10`,
      [dfsp_id],
    );

    res.json({ stats, by_category: byCategory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteMerchant = async (req, res) => {
  const { dfsp_id } = req.user;

  if (req.user.role === 'VIEWER')
    return res.status(403).json({ error: 'Insufficient permissions' });

  try {
    // Step 1: Merchant
    const [[merchant]] = await pool.execute(
      `SELECT * FROM merchants WHERE id = ? AND dfsp_id = ?`,
      [req.params.id, dfsp_id],
    );

    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

    const idType = merchant.id_type || 'MSISDN';
    const idValue = merchant.id_value || merchant.phone;

    // Step 2: ALS party delete
    let alsStatus = 'skipped';
    if (merchant.als_status === 'registered' && idValue) {
      try {
        await alsDeleteParty({ dfspId: dfsp_id, idType, idValue });
        alsStatus = 'deleted';
        console.log(`[MERCHANT] ALS party deleted: ${idType}/${idValue}`);
      } catch (alsErr) {
        // ALS 404
        if (alsErr.response?.status === 404) {
          alsStatus = 'not_found';
          console.warn(`MERCHANT ALS party already gone: ${idType}/${idValue}`);
        } else {
          alsStatus = 'failed';
          // ALS fail
        }
      }
    }

    // Step 3: delete merchant from DB
    await pool.execute(`DELETE FROM merchants WHERE id = ? AND dfsp_id = ?`, [
      req.params.id,
      dfsp_id,
    ]);

    res.json({
      message: 'Merchant deleted successfully',
      merchant_id: merchant.merchant_id,
      als_status: alsStatus,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
