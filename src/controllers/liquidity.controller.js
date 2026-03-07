const { pool } = require('../config/db');
const axios    = require('axios');

const CL_URL = process.env.CENTRAL_LEDGER_URL || 'https://ledger.mojaloop.xyz';

// GET /liquidity/position
exports.getPosition = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    // DB থেকে position নাও
    const [[pos]] = await pool.execute(
      `SELECT * FROM dfsp_positions WHERE dfsp_id = ? LIMIT 1`, [dfsp_id]
    );

    // Central Ledger থেকে live accounts নাও
    let clAccounts = [];
    try {
      const r = await axios.get(`${CL_URL}/participants/${dfsp_id}/accounts`);
      clAccounts = r.data || [];
    } catch (e) {
      console.warn(`CL accounts unavailable: ${e.message}`);
    }

    // Position change history
    const [history] = await pool.execute(`
      SELECT * FROM position_changes WHERE dfsp_id = ?
      ORDER BY created_at DESC LIMIT 20`, [dfsp_id]
    );

    res.json({
      position:   pos || {},
      cl_accounts: clAccounts,
      history,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /liquidity/limits
exports.getLimits = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM dfsp_limits WHERE dfsp_id = ? ORDER BY created_at DESC LIMIT 20`,
      [dfsp_id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /liquidity/changes
exports.getChanges = async (req, res) => {
  const { dfsp_id } = req.user;
  const { page = 1, limit = 30 } = req.query;
  try {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM position_changes WHERE dfsp_id = ?`, [dfsp_id]
    );
    const [rows] = await pool.execute(
      `SELECT * FROM position_changes WHERE dfsp_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [dfsp_id, parseInt(limit), offset]
    );
    res.json({ data: rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
