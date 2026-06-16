const { pool } = require('../config/db');

exports.getTransfers = async (req, res) => {
  const { dfsp_id } = req.user;
  const { status, direction, from, to, search, page = 1, limit = 50 } = req.query;

  try {
    const conditions = [`(t.payer_fsp = ? OR t.payee_fsp = ?)`];
    const values     = [dfsp_id, dfsp_id];

    if (status && status !== 'ALL') { conditions.push(`t.status = ?`);           values.push(status); }
    if (direction === 'SEND')       { conditions.splice(0, 1); conditions.unshift(`t.payer_fsp = ?`); values.splice(0, 2, dfsp_id); }
    if (direction === 'RECEIVE')    { conditions.splice(0, 1); conditions.unshift(`t.payee_fsp = ?`); values.splice(0, 2, dfsp_id); }
    if (from)                       { conditions.push(`DATE(t.created_at) >= ?`); values.push(from); }
    if (to)                         { conditions.push(`DATE(t.created_at) <= ?`); values.push(to); }
    if (search)                     { conditions.push(`t.transfer_id LIKE ?`);    values.push(`%${search}%`); }

    const where  = `WHERE ${conditions.join(' AND ')}`;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM transfers t ${where}`, values
    );

    const [rows] = await pool.execute(
      `SELECT t.transfer_id, t.payer_fsp, t.payee_fsp, t.amount, t.currency,
              t.status, t.created_at, t.completed_at,
              TIMESTAMPDIFF(SECOND, t.created_at, t.completed_at) AS duration_sec
       FROM transfers t ${where}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [...values, parseInt(limit), offset]
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getById = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM transfers
       WHERE transfer_id = ? AND (payer_fsp = ? OR payee_fsp = ?)`,
      [req.params.id, dfsp_id, dfsp_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Transfer not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getStats = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const [daily] = await pool.execute(`
      SELECT
        DATE(created_at)                                                AS date,
        COUNT(*)                                                        AS total,
        SUM(status = 'COMMITTED')                                       AS committed,
        SUM(status = 'FAILED')                                          AS failed,
        SUM(CASE WHEN payer_fsp = ? AND status='COMMITTED' THEN amount ELSE 0 END) AS sent,
        SUM(CASE WHEN payee_fsp = ? AND status='COMMITTED' THEN amount ELSE 0 END) AS received
      FROM transfers
      WHERE (payer_fsp = ? OR payee_fsp = ?)
        AND created_at >= NOW() - INTERVAL 7 DAY
      GROUP BY DATE(created_at)
      ORDER BY date`,
      [dfsp_id, dfsp_id, dfsp_id, dfsp_id]
    );

    // by currency
    const [byCurrency] = await pool.execute(`
      SELECT currency, COUNT(*) AS count, SUM(amount) AS total_amount
      FROM transfers
      WHERE (payer_fsp = ? OR payee_fsp = ?) AND status = 'COMMITTED'
      GROUP BY currency`,
      [dfsp_id, dfsp_id]
    );

    res.json({ daily, by_currency: byCurrency });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
