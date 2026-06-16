const { pool } = require('../config/db');
const axios    = require('axios');

exports.getSummary = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const [[today]] = await pool.execute(`
      SELECT
        COUNT(*)                                                      AS total,
        SUM(status = 'COMMITTED')                                     AS committed,
        SUM(status = 'FAILED')                                        AS failed,
        SUM(status = 'RESERVED')                                      AS reserved,
        SUM(CASE WHEN payer_fsp = ? AND status='COMMITTED' THEN amount ELSE 0 END) AS sent,
        SUM(CASE WHEN payee_fsp = ? AND status='COMMITTED' THEN amount ELSE 0 END) AS received
      FROM transfers
      WHERE (payer_fsp = ? OR payee_fsp = ?)
        AND DATE(created_at) = CURDATE()`,
      [dfsp_id, dfsp_id, dfsp_id, dfsp_id]
    );

    const [[yesterday]] = await pool.execute(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN payer_fsp = ? AND status='COMMITTED' THEN amount ELSE 0 END) AS sent,
        SUM(CASE WHEN payee_fsp = ? AND status='COMMITTED' THEN amount ELSE 0 END) AS received
      FROM transfers
      WHERE (payer_fsp = ? OR payee_fsp = ?)
        AND DATE(created_at) = CURDATE() - INTERVAL 1 DAY`,
      [dfsp_id, dfsp_id, dfsp_id, dfsp_id]
    );

    const [[thisMonth]] = await pool.execute(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='COMMITTED' THEN amount ELSE 0 END) AS volume
      FROM transfers
      WHERE (payer_fsp = ? OR payee_fsp = ?)
        AND MONTH(created_at) = MONTH(CURDATE())
        AND YEAR(created_at) = YEAR(CURDATE())`,
      [dfsp_id, dfsp_id]
    );

    const [[position]] = await pool.execute(`
      SELECT current_position, net_debit_cap, reserved_amount, currency
      FROM dfsp_positions WHERE dfsp_id = ? LIMIT 1`,
      [dfsp_id]
    );

    const [recent] = await pool.execute(`
      SELECT transfer_id, payer_fsp, payee_fsp, amount, currency, status, created_at
      FROM transfers
      WHERE (payer_fsp = ? OR payee_fsp = ?)
      ORDER BY created_at DESC LIMIT 10`,
      [dfsp_id, dfsp_id]
    );

    const [[merchants]] = await pool.execute(
      `SELECT COUNT(*) AS total, SUM(status='ACTIVE') AS active FROM merchants WHERE dfsp_id = ?`,
      [dfsp_id]
    );

    const [hourly] = await pool.execute(`
      SELECT
        HOUR(created_at) AS hour,
        COUNT(*) AS count,
        SUM(CASE WHEN status='COMMITTED' THEN amount ELSE 0 END) AS amount
      FROM transfers
      WHERE (payer_fsp = ? OR payee_fsp = ?)
        AND created_at >= NOW() - INTERVAL 24 HOUR
      GROUP BY HOUR(created_at)
      ORDER BY hour`,
      [dfsp_id, dfsp_id]
    );

    res.json({
      today,
      yesterday,
      this_month:  thisMonth,
      position:    position || {},
      recent,
      merchants,
      hourly,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
