const { pool } = require('../config/db');
const axios = require('axios');
const crypto = require('crypto');

const ALS_URL = process.env.ALS_URL;
const QUOTE_URL = process.env.QUOTE_URL;
const ML_URL = process.env.ML_URL;

//  helper function
async function getDfspCurrency(dfsp_id) {
  const [[dfsp]] = await pool.execute(
    `SELECT currency FROM dfsps WHERE dfsp_id = ? LIMIT 1`,
    [dfsp_id],
  );
  return dfsp?.currency || 'BDT';
}

exports.getSenderMerchants = async (req, res) => {
  const { dfsp_id } = req.user;
  try {
    const [rows] = await pool.execute(
      `SELECT id, merchant_id, business_name, id_type, id_value,
              phone, currency, daily_limit, monthly_limit, status, als_status
       FROM merchants
       WHERE dfsp_id = ? AND status = 'ACTIVE' AND als_status = 'registered'
       ORDER BY business_name`,
      [dfsp_id],
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.partyLookup = async (req, res) => {
  const { dfsp_id } = req.user;
  const { sender_id, receiver_id_type, receiver_id_value, amount } = req.body;

  if (!sender_id || !receiver_id_type || !receiver_id_value)
    return res
      .status(400)
      .json({
        error: 'sender_id, receiver_id_type, receiver_id_value required',
      });

  try {
    const [[sender]] = await pool.execute(
      `SELECT * FROM merchants WHERE id = ? AND dfsp_id = ?`,
      [sender_id, dfsp_id],
    );
    if (!sender)
      return res.status(404).json({ error: 'Sender merchant not found' });

    if (sender.status !== 'ACTIVE')
      return res
        .status(400)
        .json({ error: `Sender account is ${sender.status}` });

    if (sender.als_status !== 'registered')
      return res.status(400).json({ error: 'Sender is not registered in ALS' });

    if (amount && sender.daily_limit > 0) {
      const [[todayStats]] = await pool.execute(
        `SELECT COALESCE(SUM(amount), 0) AS today_sent
         FROM transfers
         WHERE payer_fsp = ? AND DATE(created_at) = CURDATE() AND status = 'COMMITTED'`,
        [dfsp_id],
      );
      const todaySent = parseFloat(todayStats.today_sent || 0);
      if (todaySent + parseFloat(amount) > parseFloat(sender.daily_limit)) {
        return res.status(400).json({
          error: `Daily limit exceeded. Limit: ${sender.daily_limit}, Used: ${todaySent.toFixed(2)}`,
          limit_type: 'daily',
          daily_limit: sender.daily_limit,
          today_sent: todaySent,
        });
      }
    }

    if (amount && sender.monthly_limit > 0) {
      const [[monthStats]] = await pool.execute(
        `SELECT COALESCE(SUM(amount), 0) AS month_sent
         FROM transfers
         WHERE payer_fsp = ? 
           AND MONTH(created_at) = MONTH(CURDATE())
           AND YEAR(created_at) = YEAR(CURDATE())
           AND status = 'COMMITTED'`,
        [dfsp_id],
      );
      const monthSent = parseFloat(monthStats.month_sent || 0);
      if (monthSent + parseFloat(amount) > parseFloat(sender.monthly_limit)) {
        return res.status(400).json({
          error: `Monthly limit exceeded. Limit: ${sender.monthly_limit}, Used: ${monthSent.toFixed(2)}`,
          limit_type: 'monthly',
          monthly_limit: sender.monthly_limit,
          month_sent: monthSent,
        });
      }
    }

    const currency = await getDfspCurrency(dfsp_id);
    const url = `${ALS_URL}/parties/${receiver_id_type}/${receiver_id_value}`;

    let alsResponse;
    try {
      alsResponse = await axios.get(url, {
        headers: {
          'Content-Type':
            'application/vnd.interoperability.parties+json;version=2.0',
          Accept: 'application/vnd.interoperability.parties+json;version=2.0',
          'FSPIOP-Source': dfsp_id,
          'FSPIOP-Destination': 'switch',
          Date: new Date().toUTCString(),
        },
        timeout: 15000,
      });
    } catch (alsErr) {
      const status = alsErr.response?.status;
      if (status === 404)
        return res.status(404).json({ error: 'Receiver not found in ALS' });
      return res.status(502).json({
        error: 'ALS lookup failed',
        als_error: alsErr.response?.data || alsErr.message,
      });
    }

    res.json({
      sender: {
        id: sender.id,
        merchant_id: sender.merchant_id,
        business_name: sender.business_name,
        id_type: sender.id_type,
        id_value: sender.id_value || sender.phone,
        currency: sender.currency || currency,
        daily_limit: sender.daily_limit,
        monthly_limit: sender.monthly_limit,
      },
      receiver: alsResponse.data,
      lookup_status: 'found',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.initQuote = async (req, res) => {
  const { dfsp_id } = req.user;
  const { sender_id, receiver_party, amount } = req.body;

  if (!sender_id || !receiver_party || !amount)
    return res
      .status(400)
      .json({ error: 'sender_id, receiver_party, amount required' });

  try {
    const [[sender]] = await pool.execute(
      `SELECT * FROM merchants WHERE id = ? AND dfsp_id = ? AND status = 'ACTIVE'`,
      [sender_id, dfsp_id],
    );
    if (!sender)
      return res.status(404).json({ error: 'Sender merchant not found' });

    const currency = await getDfspCurrency(dfsp_id);
    const quoteId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();

    const requestBody = {
      quoteId,
      transactionId,
      payer: {
        partyIdInfo: {
          partyIdType: sender.id_type || 'MSISDN',
          partyIdentifier: sender.id_value || sender.phone,
          fspId: dfsp_id,
        },
        personalInfo: {
          complexName: {
            firstName: sender.first_name || sender.business_name,
            lastName: sender.last_name || '',
          },
          dateOfBirth: sender.dob || null,
        },
      },
      payee: {
        partyIdInfo: {
          partyIdType: receiver_party?.party?.partyIdInfo?.partyIdType,
          partyIdentifier: receiver_party?.party?.partyIdInfo?.partyIdentifier,
          fspId: receiver_party?.party?.partyIdInfo?.fspId,
        },
      },
      amountType: 'SEND',
      amount: {
        amount: String(amount),
        currency: currency,
      },
      transactionType: {
        scenario: 'TRANSFER',
        initiator: 'PAYER',
        initiatorType: 'CONSUMER',
      },
      note: 'P2P transfer via DFSP Portal',
    };

    const payeeFspId = receiver_party?.party?.partyIdInfo?.fspId;

    const response = await axios.post(`${QUOTE_URL}/quotes`, requestBody, {
      headers: {
        'Content-Type':
          'application/vnd.interoperability.quotes+json;version=1.0',
        Accept: 'application/vnd.interoperability.quotes+json;version=1.0',
        'FSPIOP-Source': dfsp_id,
        'FSPIOP-Destination': payeeFspId || 'switch',
        Date: new Date().toUTCString(),
      },
      timeout: 15000,
    });

    res.status(response.status).json({
      quote_id: quoteId,
      transaction_id: transactionId,
      status: 'quote_initiated',
      message: 'Quote request sent — waiting for callback',
    });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data || err.message,
      quote_error: true,
    });
  }
};

exports.initTransfer = async (req, res) => {
  const { dfsp_id } = req.user;
  const {
    quote_id,
    payer_fsp,
    payee_fsp,
    currency,
    amount,
    ilp_packet,
    condition,
    expiration,
  } = req.body;

  if (
    !quote_id ||
    !payer_fsp ||
    !payee_fsp ||
    !amount ||
    !ilp_packet ||
    !condition
  )
    return res.status(400).json({ error: 'Missing required transfer fields' });

  try {
    const transferId = crypto.randomUUID();

    const requestBody = {
      transferId,
      quoteId: quote_id,
      payerFsp: payer_fsp,
      payeeFsp: payee_fsp,
      amount: {
        amount: String(amount),
        currency: currency,
      },
      expiration:
        expiration || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      ilpPacket: ilp_packet,
      condition: condition,
    };

    const response = await axios.post(`${ML_URL}/transfers`, requestBody, {
      headers: {
        'Content-Type':
          'application/vnd.interoperability.transfers+json;version=1.0',
        Accept: 'application/vnd.interoperability.transfers+json;version=1.0',
        'FSPIOP-Source': payer_fsp,
        'FSPIOP-Destination': payee_fsp,
        'FSPIOP-HTTP-Method': 'POST',
        'FSPIOP-URI': '/transfers',
        Date: new Date().toUTCString(),
      },
      timeout: 15000,
    });

    res.status(response.status).json({
      transfer_id: transferId,
      status: 'transfer_initiated',
      message: 'Transfer request sent — waiting for callback',
    });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data || err.message,
      transfer_error: true,
    });
  }
};
