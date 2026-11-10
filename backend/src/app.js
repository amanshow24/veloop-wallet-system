const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { apiPrefix, frontendOrigin, trustProxyHops } = require('./config/env');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

app.set('trust proxy', trustProxyHops);
app.use(helmet());
app.use(cors({ origin: frontendOrigin }));
app.use(express.json({ limit: '32kb' }));
app.use(apiPrefix, routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
