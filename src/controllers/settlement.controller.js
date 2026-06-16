const { pool } = require('../config/db');

exports.getFinalizeRecords = async (req, res) => {
  try {
    const { dfsp_id } = req.user;
    const {
      type,
      window_id,
      settlement_id,
      date_from,
      date_to,
      status,
      page     = 1,
      limit    = 50,
    } = req.query;

    const conditions = ['dfsp_name = ?'];
    const params     = [dfsp_id];

    if (type)          { conditions.push('type = ?');              params.push(type); }
    if (window_id)     { conditions.push('window_id = ?');         params.push(String(window_id)); }
    if (settlement_id) { conditions.push('settlement_id = ?');     params.push(String(settlement_id)); }
    if (status)        { conditions.push('status = ?');            params.push(status); }
    if (date_from)     { conditions.push('DATE(created_at) >= ?'); params.push(date_from); }
    if (date_to)       { conditions.push('DATE(created_at) <= ?'); params.push(date_to); }

    const where  = `WHERE ${conditions.join(' AND ')}`;
    const lim    = Math.min(parseInt(limit) || 50, 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM settlement_finalize_records ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT
         id, window_id, settlement_id, dfsp_name,
         type, action, status,
         amount, before_amount, after_amount,
         currency, position_value, reason, created_at
       FROM settlement_finalize_records
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, lim, offset]
    );

    // Summary of this DFSP
    const [[summary]] = await pool.execute(
      `SELECT
         SUM(CASE WHEN type = 'credit' AND status NOT IN ('failed') THEN amount ELSE 0 END) AS total_credit,
         SUM(CASE WHEN type = 'debit'  AND status IN ('commit','ok') THEN amount ELSE 0 END) AS total_debit,
         COUNT(DISTINCT window_id) AS total_windows
       FROM settlement_finalize_records ${where}`,
      params
    );

    return res.json({
      data: rows,
      summary: {
        total_credit:  parseFloat(summary.total_credit  || 0),
        total_debit:   parseFloat(summary.total_debit   || 0),
        total_windows: parseInt(summary.total_windows   || 0),
      },
      pagination: {
        total,
        pages:       Math.ceil(total / lim),
        page:        parseInt(page),
        limit:       lim,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getCompletedRecords = async (req, res) => {
  try {
    const { dfsp_id } = req.user;
    const {
      window_id,
      settlement_id,
      date_from,
      date_to,
      page  = 1,
      limit = 50,
    } = req.query;

    const conditions = ['dfsp_name = ?'];
    const params     = [dfsp_id];

    if (window_id)     { conditions.push('window_id = ?');         params.push(String(window_id)); }
    if (settlement_id) { conditions.push('settlement_id = ?');     params.push(String(settlement_id)); }
    if (date_from)     { conditions.push('DATE(created_at) >= ?'); params.push(date_from); }
    if (date_to)       { conditions.push('DATE(created_at) <= ?'); params.push(date_to); }

    const where  = `WHERE ${conditions.join(' AND ')}`;
    const lim    = Math.min(parseInt(limit) || 50, 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM settlement_completed_records ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT
         id, window_id, settlement_id, dfsp_name,
         before_position, after_position,
         net_amount, currency, created_at
       FROM settlement_completed_records
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, lim, offset]
    );

    const [[summary]] = await pool.execute(
      `SELECT
         COUNT(DISTINCT window_id) AS total_windows,
         SUM(ABS(net_amount))      AS total_volume
       FROM settlement_completed_records ${where}`,
      params
    );

    return res.json({
      data: rows,
      summary: {
        total_windows: parseInt(summary.total_windows || 0),
        total_volume:  parseFloat(summary.total_volume || 0),
      },
      pagination: {
        total,
        pages: Math.ceil(total / lim),
        page:  parseInt(page),
        limit: lim,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
