const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');

const app = express();

app.use(helmet());
app.use(cors({ origin: env.clientOrigins, credentials: true }));
app.use(express.json({ limit: '100kb' }));
if (env.nodeEnv !== 'test') app.use(morgan('dev'));

// The client sends its Socket.IO id so broadcasts can be tagged with their origin
// (lets the sender recognise the echo of its own optimistic update).
app.use((req, _res, next) => {
  const sid = req.headers['x-socket-id'];
  req.socketId = typeof sid === 'string' ? sid.slice(0, 64) : undefined;
  next();
});

app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
