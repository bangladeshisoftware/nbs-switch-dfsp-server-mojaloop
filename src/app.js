/**************************************************************************
 * Copyright © 2026 Bangladeshi Software Ltd. All rights reserved.
 * Distributed under the license terms specified in this repository.
 *
 * ORIGINAL AUTHOR: Muhammad Nasim (Developer)
 **************************************************************************/

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
  }),
);

app.use(express.json());

app.use('/api/v1', routes);

app.get('/health', (req, res) =>
  res.json({ status: 'OK', service: 'DFSP Portal API' }),
);

app.listen(PORT, () =>
  console.log(`DFSP Portal Backend running on port ${PORT}`),
);
